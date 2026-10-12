// Failure paths through real Express + real MongoDB + real Anvil (Finding 7).
// Scope: everything from the HTTP API down. The browser wallet is NOT exercised here:
// "wallet rejection" means the client never broadcasts; the client signer is an Anvil
// account. Browser wallet error handling is covered by frontend tests (see the report).
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { freePort, mined, startAnvil } from "../helpers/anvil.js";
import { connectStore, type MongoStore } from "../../src/storage/mongo.js";
import type { Store } from "../../src/storage/store.js";
import { createApp } from "../../src/app.js";
import { ApiError } from "../../src/errors.js";
import { createProvider, RegistryChain } from "../../src/services/chain.js";
import { dropTestDatabase, testDatabaseUri } from "../helpers/mongo.js";

describe("E2E failure paths (Backend + Mongo + Anvil, programmatic client signer)", () => {
  let env: Awaited<ReturnType<typeof startAnvil>>;
  let store: MongoStore;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  let csrf: string;
  let pdfCounter = 0;

  async function login(target: ReturnType<typeof createApp>) {
    const init = await request(target).get("/api/v1/auth/session");
    let c = (init.headers["set-cookie"] as unknown as string[])[0]!.split(
      ";",
    )[0]!;
    const challenge = await request(target)
      .post("/api/v1/auth/challenge")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", c)
      .set("X-CSRF-Token", init.body.csrfToken)
      .send({ wallet: (await env.issuer.getAddress()).toLowerCase() });
    const verify = await request(target)
      .post("/api/v1/auth/verify")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", c)
      .set("X-CSRF-Token", init.body.csrfToken)
      .send({
        message: challenge.body.message,
        signature: await env.issuer.signMessage(challenge.body.message),
      });
    expect(verify.status).toBe(200);
    const next = verify.headers["set-cookie"] as unknown as
      string[] | undefined;
    if (next) c = next[0]!.split(";")[0]!;
    return { cookie: c, csrf: verify.body.csrfToken as string };
  }
  const post = (target: ReturnType<typeof createApp>, path: string) =>
    request(target)
      .post(path)
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf);

  async function preparedDraft() {
    const pdf = Buffer.from(
      `%PDF-1.4\n% failure path ${++pdfCounter}\n%%EOF\n`,
    );
    const draft = await post(app, "/api/v1/issuance-drafts").attach(
      "pdf",
      pdf,
      "c.pdf",
    );
    expect(draft.status).toBe(201);
    const prep = await post(
      app,
      `/api/v1/issuance-drafts/${draft.body.draftId}/prepare`,
    ).send({});
    expect(prep.status).toBe(200);
    return {
      draftId: draft.body.draftId as string,
      certificateId: draft.body.certificateId as string,
      transaction: prep.body.transaction as {
        to: string;
        data: string;
        chainId: number;
      },
    };
  }
  const reconcile = (
    target: ReturnType<typeof createApp>,
    draftId: string,
    hash: string,
  ) =>
    post(target, `/api/v1/issuance-drafts/${draftId}/transaction`).send({
      transactionHash: hash,
    });
  const verification = (target: ReturnType<typeof createApp>, certId: string) =>
    request(target).get(`/api/v1/certificates/${certId}/verification`);

  beforeAll(async () => {
    env = await startAnvil();
    store = await connectStore(testDatabaseUri(process.env.TEST_MONGODB_URI));
    app = createApp(env.config, store, env.chain);
    ({ cookie, csrf } = await login(app));
  }, 60000);

  afterAll(async () => {
    try {
      await dropTestDatabase(store);
    } finally {
      await env?.close();
    }
  }, 60000);

  it("wallet rejection (client never broadcasts): no chain state, draft stays re-preparable", async () => {
    const { draftId, certificateId } = await preparedDraft();
    // The client declines to sign, so no hash exists and nothing is reconciled.
    expect((await env.chain.inspect(certificateId)).exists).toBe(false);
    expect((await verification(app, certificateId)).body.status).toBe(
      "UNKNOWN",
    );
    const again = await post(
      app,
      `/api/v1/issuance-drafts/${draftId}/prepare`,
    ).send({});
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("AWAITING_SIGNATURE");
  });

  it("unknown/dropped transaction hash is UNRESOLVED (202) and writes no metadata", async () => {
    const { draftId, certificateId } = await preparedDraft();
    const res = await reconcile(
      app,
      draftId,
      "0x" + randomBytes(32).toString("hex"),
    );
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: "UNRESOLVED",
      reason: "NOT_FOUND_OR_DROPPED",
      metadataStatus: "NOT_UPDATED",
    });
    expect(await store.one("metadata", { certificateId })).toBeNull();
  });

  it("pending transaction is 202 PENDING, then CONFIRMED after mining", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    await env.provider.send("evm_setAutomine", [false]);
    try {
      const tx = await env.issuer.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        gasLimit: 200000,
      });
      const pending = await reconcile(app, draftId, tx.hash);
      expect(pending.status).toBe(202);
      expect(pending.body).toMatchObject({
        status: "PENDING",
        metadataStatus: "NOT_UPDATED",
      });
      expect((await verification(app, certificateId)).body.status).toBe(
        "UNKNOWN",
      );
      expect(await store.one("metadata", { certificateId })).toBeNull();
      await env.provider.send("evm_mine", []);
      const mined = await reconcile(app, draftId, tx.hash);
      expect(mined.status).toBe(200);
      expect(mined.body).toMatchObject({
        status: "CONFIRMED",
        metadataStatus: "SYNCED",
      });
    } finally {
      await env.provider.send("evm_setAutomine", [true]);
    }
  });

  it("CONFIRMATION_PENDING below the confirmation threshold is 202, not success", async () => {
    const { draftId, transaction } = await preparedDraft();
    env.config.MIN_ISSUANCE_CONFIRMATIONS = 3;
    try {
      const tx = await env.issuer.sendTransaction({
        to: transaction.to,
        data: transaction.data,
      });
      await mined(env.provider, tx);
      const res = await reconcile(app, draftId, tx.hash);
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        status: "CONFIRMATION_PENDING",
        metadataStatus: "NOT_UPDATED",
      });
    } finally {
      env.config.MIN_ISSUANCE_CONFIRMATIONS = 1;
    }
  });

  it("mined reverted transaction is 409 REVERTED and does not alter the confirmed record", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    const first = await env.issuer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
    });
    await mined(env.provider, first);
    expect((await reconcile(app, draftId, first.hash)).body.status).toBe(
      "CONFIRMED",
    );
    // Re-broadcasting identical calldata reverts on-chain (certificate already exists).
    // An explicit gas limit skips estimation so the revert is mined, as a wallet could do.
    const dupHash: string = await env.provider.send("eth_sendTransaction", [
      {
        from: (await env.issuer.getAddress()).toLowerCase(),
        to: transaction.to,
        data: transaction.data,
        gas: "0x30d40",
      },
    ]);
    expect((await mined(env.provider, dupHash)).status).toBe(0);
    const res = await reconcile(app, draftId, dupHash);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      status: "REVERTED",
      metadataStatus: "NOT_UPDATED",
    });
    const saved = await store.one("metadata", { certificateId });
    expect(saved?.issuanceTransactionHash).toBe(first.hash.toLowerCase());
    expect((await verification(app, certificateId)).body.status).toBe("VALID");
  });

  it("resumed draft: issued=false until confirmed, then issued=true and re-prepare is a 409", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    const lookup = () =>
      request(app)
        .get(`/api/v1/issuance-drafts/${draftId}`)
        .set("Cookie", cookie);
    const listed = async () =>
      (
        await request(app).get("/api/v1/issuer/drafts").set("Cookie", cookie)
      ).body.drafts.find((d: { draftId: string }) => d.draftId === draftId);
    expect((await lookup()).body).toMatchObject({
      draftId,
      certificateId,
      issued: false,
    });
    expect((await listed()).issued).toBe(false);
    // Resuming a valid draft prepares the same transaction again (no re-upload).
    const again = await post(
      app,
      `/api/v1/issuance-drafts/${draftId}/prepare`,
    ).send({});
    expect(again.status).toBe(200);
    expect(again.body.transaction.data).toBe(transaction.data);
    const tx = await env.issuer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
    });
    await mined(env.provider, tx);
    expect((await reconcile(app, draftId, tx.hash)).body.status).toBe(
      "CONFIRMED",
    );
    expect((await lookup()).body.issued).toBe(true);
    expect((await listed()).issued).toBe(true);
    const dup = await post(
      app,
      `/api/v1/issuance-drafts/${draftId}/prepare`,
    ).send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({
      code: "TRANSACTION_WOULD_REVERT",
      contractError: "CertificateAlreadyExists",
    });
  });

  it("transaction from another sender is rejected as TRANSACTION_MISMATCH", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    const hash: string = await env.provider.send("eth_sendTransaction", [
      {
        from: (await env.other.getAddress()).toLowerCase(),
        to: transaction.to,
        data: transaction.data,
        gas: "0x30d40",
      },
    ]);
    expect((await mined(env.provider, hash)).status).toBe(0);
    const res = await reconcile(app, draftId, hash);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TRANSACTION_MISMATCH");
    expect((await env.chain.inspect(certificateId)).exists).toBe(false);
  });

  it("database write failure after on-chain success returns RECONCILIATION_REQUIRED (503); retry syncs", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    const tx = await env.issuer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
    });
    await mined(env.provider, tx);
    // Fault injection: real Mongo reads succeed, but writes fail as if the DB went away.
    const failingWrites = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "upsert")
          return async () => {
            throw new ApiError(503, "DATABASE_UNAVAILABLE");
          };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Store;
    const degraded = createApp(env.config, failingWrites, env.chain);
    const res = await reconcile(degraded, draftId, tx.hash);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "CONFIRMED",
      metadataStatus: "RECONCILIATION_REQUIRED",
      retry: { transactionHash: tx.hash },
    });
    // Blockchain stays authoritative: verification is VALID despite missing metadata.
    expect(await store.one("metadata", { certificateId })).toBeNull();
    expect((await verification(app, certificateId)).body.status).toBe("VALID");
    const retried = await reconcile(app, draftId, tx.hash);
    expect(retried.status).toBe(200);
    expect(retried.body.metadataStatus).toBe("SYNCED");
  });

  it("RPC outage: readiness, verification, prepare and reconcile fail as 503, never UNKNOWN/INVALID", async () => {
    const { draftId, certificateId, transaction } = await preparedDraft();
    const tx = await env.issuer.sendTransaction({
      to: transaction.to,
      data: transaction.data,
    });
    await mined(env.provider, tx);
    // Production provider factory pointed at a port with no RPC server (connection refused).
    const deadConfig = {
      ...env.config,
      RPC_URL: `http://127.0.0.1:${await freePort()}`,
    };
    const deadProvider = createProvider(deadConfig);
    try {
      const outage = createApp(
        deadConfig,
        store,
        new RegistryChain(deadConfig, deadProvider),
      );
      const ready = await request(outage).get("/api/v1/health/ready");
      expect(ready.status).toBe(503);
      expect(ready.body).toMatchObject({ database: true, blockchain: false });
      const verify = await verification(outage, certificateId);
      expect(verify.status).toBe(503);
      expect(verify.body.status).not.toMatch(/^(UNKNOWN|INVALID|MODIFIED)$/);
      const prep = await post(
        outage,
        `/api/v1/issuance-drafts/${draftId}/prepare`,
      ).send({});
      expect(prep.status).toBe(503);
      expect(prep.body.error.code).toBe("RPC_UNAVAILABLE");
      const rec = await reconcile(outage, draftId, tx.hash);
      expect(rec.status).toBe(503);
      expect(rec.body.error.code).toBe("RPC_UNAVAILABLE");
      expect(await store.one("metadata", { certificateId })).toBeNull();
    } finally {
      deadProvider.destroy();
    }
    // After the RPC recovers, reconciling the same hash succeeds without a new transaction.
    const recovered = await reconcile(app, draftId, tx.hash);
    expect(recovered.status).toBe(200);
    expect(recovered.body.status).toBe("CONFIRMED");
  }, 30000);

  it("wrong network: backend configured for another chain refuses to serve chain state", async () => {
    const { certificateId } = await preparedDraft();
    const wrongConfig = { ...env.config, CHAIN_ID: 11155111 };
    const wrong = createApp(
      wrongConfig,
      store,
      new RegistryChain(wrongConfig, env.provider),
    );
    const verify = await verification(wrong, certificateId);
    expect(verify.status).toBe(503);
    const ready = await request(wrong).get("/api/v1/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body.blockchain).toBe(false);
    // Prepared transactions pin the configured chain so the frontend can refuse a mismatch.
    const { transaction } = await preparedDraft();
    expect(transaction.chainId).toBe(31337);
  });
});
