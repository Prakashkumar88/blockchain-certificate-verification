import { randomBytes } from "node:crypto";
import type { Config } from "../config/index.js";
import { ApiError, fail } from "../errors.js";
import type { Store, Draft, Metadata } from "../storage/store.js";
import type { Chain, Intent, TxResult } from "./chain.js";
export class CertificateService {
  readonly deploymentId: string;
  constructor(
    private config: Config,
    private store: Store,
    private chain: Chain,
  ) {
    this.deploymentId = config.manifest.deploymentId;
  }
  private key(id: string) {
    return `${this.deploymentId}:${id}`;
  }
  async requireIssuer(wallet: string) {
    if (!(await this.chain.roles(wallet)).issuer) fail(403, "ISSUER_REQUIRED");
  }
  async requireAdmin(wallet: string) {
    if (!(await this.chain.roles(wallet)).admin) fail(403, "ADMIN_REQUIRED");
  }
  async requireOwner(wallet: string, id: string) {
    await this.requireIssuer(wallet);
    const read = await this.chain.inspect(id);
    if (!read.exists) fail(404, "CERTIFICATE_UNKNOWN");
    if (read.record.issuer !== wallet) fail(403, "CERTIFICATE_OWNER_REQUIRED");
    return read.record;
  }
  async createDraft(
    wallet: string,
    id: string | undefined,
    documentHash: string,
  ) {
    await this.requireIssuer(wallet);
    const certificateId = id ?? "0x" + randomBytes(32).toString("hex");
    if ((await this.chain.inspect(certificateId)).exists)
      fail(409, "CERTIFICATE_ALREADY_EXISTS");
    const draft: Draft = {
      key: "0x" + randomBytes(32).toString("hex"),
      deploymentId: this.deploymentId,
      owner: wallet,
      certificateId,
      documentHash,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.DRAFT_TTL_SECONDS * 1000),
    };
    await this.store.insert("drafts", draft);
    return draft;
  }
  async draft(wallet: string, id: string) {
    await this.requireIssuer(wallet);
    const draft = await this.store.one("drafts", {
      key: id,
      owner: wallet,
      deploymentId: this.deploymentId,
      expiresAt: { $gt: new Date() },
    });
    if (!draft) fail(404, "DRAFT_NOT_FOUND");
    return draft;
  }
  async issuanceIntent(
    wallet: string,
    draftIds: string[],
    batch: boolean,
  ): Promise<Intent> {
    await this.requireIssuer(wallet);
    const cap = await this.chain.maxBatch();
    if (
      !draftIds.length ||
      draftIds.length > cap ||
      new Set(draftIds).size !== draftIds.length
    )
      fail(400, "INVALID_BATCH");
    const drafts: Draft[] = [];
    for (const id of draftIds) drafts.push(await this.draft(wallet, id));
    const ids = drafts.map((d) => d.certificateId);
    if (new Set(ids).size !== ids.length) fail(400, "DUPLICATE_CERTIFICATE_ID");
    return {
      kind: batch ? "batch" : "issue",
      wallet,
      ids,
      digests: drafts.map((d) => d.documentHash),
    };
  }
  async revocationIntent(wallet: string, id: string): Promise<Intent> {
    const roles = await this.chain.roles(wallet);
    const read = await this.chain.inspect(id);
    if (!read.exists) fail(404, "CERTIFICATE_UNKNOWN");
    // Mirrors the contract: only the active original issuer may revoke (admin has no power).
    if (!roles.issuer || read.record.issuer !== wallet)
      fail(403, "REVOCATION_FORBIDDEN");
    return { kind: "revoke", wallet, ids: [id], digests: [] };
  }
  async reconcile(hash: string, intent: Intent) {
    const result = await this.chain.transaction(hash, intent);
    if (
      result.status === "UNRESOLVED" &&
      result.reason === "NOT_FOUND_OR_DROPPED"
    )
      return { ...result, metadataStatus: "NOT_UPDATED" };
    try {
      await this.store.upsert(
        "transactions",
        { key: this.key(hash) },
        {
          key: this.key(hash),
          deploymentId: this.deploymentId,
          owner: intent.wallet,
          intent,
          transactionHash: hash,
          result,
          updatedAt: new Date(),
        },
      );
      if (result.status === "CONFIRMED") {
        for (const id of intent.ids) {
          const read = await this.chain.inspect(id);
          if (!read.exists) fail(503, "CHAIN_REORG");
          const metadata: Partial<Metadata> = {
            key: this.key(id),
            deploymentId: this.deploymentId,
            certificateId: id,
            issuer: read.record.issuer,
            documentHash: read.record.documentHash,
            updatedAt: new Date(),
            ...(intent.kind === "revoke"
              ? { revocationTransactionHash: hash }
              : { issuanceTransactionHash: hash }),
          };
          await this.store.upsert("metadata", { key: this.key(id) }, metadata);
        }
      }
      return {
        ...result,
        metadataStatus:
          result.status === "CONFIRMED" ? "SYNCED" : "NOT_UPDATED",
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["DATABASE_UNAVAILABLE", "DUPLICATE_METADATA"].includes(error.code)
      )
        return {
          ...result,
          metadataStatus: "RECONCILIATION_REQUIRED",
          reason: "DATABASE_UNAVAILABLE",
          retry: { transactionHash: hash },
        };
      throw error;
    }
  }
  async transaction(wallet: string, hash: string) {
    const roles = await this.chain.roles(wallet);
    if (!roles.issuer && !roles.admin) fail(403, "ROLE_REQUIRED");
    const saved = await this.store.one("transactions", {
      key: this.key(hash),
      owner: wallet,
      deploymentId: this.deploymentId,
    });
    if (!saved) fail(404, "TRANSACTION_NOT_TRACKED");
    return this.reconcile(hash, saved.intent);
  }
  async metadata(wallet: string, id: string) {
    const record = await this.requireOwner(wallet, id);
    const saved = await this.store.one("metadata", {
      key: this.key(id),
      issuer: wallet,
      deploymentId: this.deploymentId,
    });
    if (!saved) fail(404, "METADATA_NOT_FOUND");
    if (saved.documentHash !== record.documentHash)
      fail(503, "METADATA_MISMATCH");
    return {
      certificateId: id,
      issuer: record.issuer,
      documentHash: record.documentHash,
      displayLabel: saved.displayLabel ?? "",
      issuanceTransactionHash: saved.issuanceTransactionHash,
      revocationTransactionHash: saved.revocationTransactionHash,
      updatedAt: saved.updatedAt,
      supplementary: true,
    };
  }
  async patchMetadata(wallet: string, id: string, displayLabel: string) {
    const r = await this.requireOwner(wallet, id);
    await this.store.upsert(
      "metadata",
      { key: this.key(id) },
      {
        key: this.key(id),
        deploymentId: this.deploymentId,
        certificateId: id,
        issuer: wallet,
        documentHash: r.documentHash,
        displayLabel,
        updatedAt: new Date(),
      },
    );
    return this.metadata(wallet, id);
  }
  async deleteMetadata(wallet: string, id: string) {
    await this.requireOwner(wallet, id);
    await this.store.remove("metadata", { key: this.key(id), issuer: wallet });
  }
  async drafts(wallet: string, cursor: number, limit: number) {
    await this.requireIssuer(wallet);
    return this.store.list(
      "drafts",
      {
        deploymentId: this.deploymentId,
        owner: wallet,
        expiresAt: { $gt: new Date() },
      },
      { createdAt: -1, key: 1 },
      limit,
      cursor,
    );
  }
}
export function transactionHttpStatus(
  result: TxResult & { metadataStatus: string },
) {
  if (result.metadataStatus === "RECONCILIATION_REQUIRED") return 503;
  if (result.status === "REVERTED") return 409;
  return result.status === "CONFIRMED" ? 200 : 202;
}
