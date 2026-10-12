import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import type { Config } from "./config/index.js";
import { ApiError, fail } from "./errors.js";
import {
  address,
  certificateId,
  draftList,
  hex32,
  metadataPatch,
  pagination,
} from "./schemas.js";
import type { Store, Session } from "./storage/store.js";
import { ISSUER_ROLE, type Chain } from "./services/chain.js";
import { AuthService } from "./services/auth.js";
import {
  CertificateService,
  transactionHttpStatus,
} from "./services/certificates.js";
import { VerificationService } from "./services/verification.js";
import { UploadService } from "./services/pdf.js";
import { EventIndexer } from "./indexer/indexer.js";

export const READINESS_CACHE_MS = 1000;
export function createApp(
  config: Config,
  store: Store,
  chain: Chain,
  diagnostic: (code: string) => void = () => {},
) {
  const app = express(),
    auth = new AuthService(config, store, chain),
    certificates = new CertificateService(config, store, chain),
    verification = new VerificationService(config, chain),
    uploads = new UploadService(config),
    indexer = new EventIndexer(config, store, chain);
  const cookieName = config.COOKIE_SECURE
    ? "__Host-cert_session"
    : "cert_session";
  const cookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.SESSION_TTL_SECONDS * 1000,
  };
  const rawCookie = (req: Request) => {
    const matches = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(cookieName + "="));
    return matches.length === 1
      ? matches[0]!.slice(cookieName.length + 1)
      : undefined;
  };
  const session = async (req: Request) => {
    const s = await auth.session(rawCookie(req));
    if (!s) fail(401, "SESSION_REQUIRED");
    return s;
  };
  const logged = async (req: Request) => {
    const s = await session(req);
    if (!s.wallet) fail(401, "AUTHENTICATION_REQUIRED");
    return { ...s, wallet: s.wallet };
  };
  const mutation = async (req: Request) => {
    if (req.headers.origin !== config.APP_ORIGIN) fail(403, "ORIGIN_FORBIDDEN");
    const s = await session(req);
    auth.checkCsrf(rawCookie(req)!, req.headers["x-csrf-token"]);
    return s;
  };
  const authenticatedMutation = async (req: Request) => {
    const s = await mutation(req);
    if (!s.wallet) fail(401, "AUTHENTICATION_REQUIRED");
    return { ...s, wallet: s.wallet };
  };
  const limit = (max: number) =>
    rateLimit({
      windowMs: 60000,
      limit: max,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED" } },
    });
  const walletLimits = new Map<string, { count: number; reset: number }>();
  function limitWallet(s: Session) {
    const now = Date.now();
    for (const [k, v] of walletLimits)
      if (v.reset <= now) walletLimits.delete(k);
    const key = s.wallet!;
    const item = walletLimits.get(key) ?? { count: 0, reset: now + 60000 };
    if (++item.count > config.UPLOAD_RATE_PER_MIN)
      fail(429, "WALLET_RATE_LIMITED");
    walletLimits.set(key, item);
  }
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== config.APP_ORIGIN)
      return next(new ApiError(403, "ORIGIN_FORBIDDEN"));
    if (origin) {
      res.set("Access-Control-Allow-Origin", config.APP_ORIGIN);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
      res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "64kb", strict: true }));
  const router = express.Router();
  app.use("/api/v1", router);
  router.get("/health/live", (_req, res) => res.json({ status: "LIVE" }));
  // Readiness hits Mongo and several RPC calls: limit it separately (so public traffic
  // cannot starve probes) and share one in-flight/recent check across all callers.
  let readiness:
    | { at: number; check: Promise<{ database: boolean; blockchain: boolean }> }
    | undefined;
  router.get(
    "/health/ready",
    limit(config.READ_RATE_PER_MIN),
    async (_req, res) => {
      if (!readiness || Date.now() - readiness.at >= READINESS_CACHE_MS)
        readiness = {
          at: Date.now(),
          check: Promise.allSettled([store.ready(), chain.head()]).then(
            ([db, rpc]) => ({
              database: db.status === "fulfilled" && db.value,
              blockchain: rpc.status === "fulfilled",
            }),
          ),
        };
      const { database, blockchain } = await readiness.check;
      res.status(database && blockchain ? 200 : 503).json({
        status: database && blockchain ? "READY" : "UNAVAILABLE",
        database,
        blockchain,
      });
    },
  );
  router.use(limit(config.READ_RATE_PER_MIN));
  router.use("/auth", limit(config.AUTH_RATE_PER_MIN));
  router.get("/auth/session", async (req, res) => {
    const current = await auth.session(rawCookie(req));
    if (current) {
      res.json({
        wallet: current.wallet ?? null,
        expiresAt: current.expiresAt,
        csrfToken: auth.csrf(rawCookie(req)!),
      });
      return;
    }
    const created = await auth.create();
    res.cookie(cookieName, created.raw, cookieOptions);
    res.json({
      wallet: null,
      expiresAt: created.session.expiresAt,
      csrfToken: created.csrfToken,
    });
  });
  router.post("/auth/challenge", async (req, res) => {
    const s = await mutation(req);
    const body = z.object({ wallet: address }).strict().parse(req.body);
    res.json(await auth.challenge(s, body.wallet));
  });
  router.post("/auth/verify", async (req, res) => {
    const s = await mutation(req);
    const body = z
      .object({
        message: z.string().max(4096),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .strict()
      .parse(req.body);
    const result = await auth.verify(s, body.message, body.signature);
    res.cookie(cookieName, result.raw, cookieOptions);
    res.json({
      wallet: result.session.wallet,
      expiresAt: result.session.expiresAt,
      csrfToken: result.csrfToken,
    });
  });
  router.delete("/auth/session", async (req, res) => {
    const s = await mutation(req);
    await auth.logout(s);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    res.sendStatus(204);
  });
  router.get("/certificates/:id/verification", async (req, res) => {
    const id = certificateId.parse(req.params.id);
    const result = await verification.verify(id);
    res.status(result.status === "UNAVAILABLE" ? 503 : 200).json(result);
  });
  router.post(
    "/certificates/:id/verify-pdf",
    limit(config.UPLOAD_RATE_PER_MIN),
    async (req, res) => {
      const id = certificateId.parse(req.params.id);
      const pdf = await uploads.read(req, req.ip ?? "unknown");
      const result = await verification.verify(id, pdf.documentHash);
      res.status(result.status === "UNAVAILABLE" ? 503 : 200).json(result);
    },
  );
  router.post(
    "/issuance-drafts",
    limit(config.UPLOAD_RATE_PER_MIN),
    async (req, res) => {
      const s = await authenticatedMutation(req);
      limitWallet(s);
      await certificates.requireIssuer(s.wallet);
      const pdf = await uploads.read(req, s.wallet, true);
      const draft = await certificates.createDraft(
        s.wallet,
        pdf.certificateId === undefined
          ? undefined
          : certificateId.parse(pdf.certificateId),
        pdf.documentHash,
      );
      res.status(201).json({
        draftId: draft.key,
        certificateId: draft.certificateId,
        documentHash: draft.documentHash,
        expiresAt: draft.expiresAt,
      });
    },
  );
  router.get("/issuance-drafts/:draftId", async (req, res) => {
    const s = await logged(req);
    const d = await certificates.draft(
      s.wallet,
      hex32.parse(req.params.draftId),
    );
    // Drafts are never consumed in storage; the chain says whether the certificate already exists.
    const issued = await chain.existing([d.certificateId]);
    res.json({
      draftId: d.key,
      certificateId: d.certificateId,
      documentHash: d.documentHash,
      expiresAt: d.expiresAt,
      issued: issued.has(d.certificateId),
    });
  });
  router.post("/issuance-drafts/:draftId/prepare", async (req, res) => {
    const s = await authenticatedMutation(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const intent = await certificates.issuanceIntent(
      s.wallet,
      [hex32.parse(req.params.draftId)],
      false,
    );
    res.json({
      status: "AWAITING_SIGNATURE",
      transaction: await chain.prepare(intent),
    });
  });
  router.post("/issuance-batches/prepare", async (req, res) => {
    const s = await authenticatedMutation(req);
    const body = draftList.parse(req.body);
    const intent = await certificates.issuanceIntent(
      s.wallet,
      body.draftIds,
      true,
    );
    res.json({
      status: "AWAITING_SIGNATURE",
      transaction: await chain.prepare(intent),
      maxBatchSize: await chain.maxBatch(),
    });
  });
  router.post("/issuance-drafts/:draftId/transaction", async (req, res) => {
    const s = await authenticatedMutation(req);
    const body = z.object({ transactionHash: hex32 }).strict().parse(req.body);
    const intent = await certificates.issuanceIntent(
      s.wallet,
      [hex32.parse(req.params.draftId)],
      false,
    );
    const result = await certificates.reconcile(body.transactionHash, intent);
    res.status(transactionHttpStatus(result)).json(result);
  });
  router.post("/issuance-batches/transaction", async (req, res) => {
    const s = await authenticatedMutation(req);
    const body = draftList.extend({ transactionHash: hex32 }).parse(req.body);
    const intent = await certificates.issuanceIntent(
      s.wallet,
      body.draftIds,
      true,
    );
    const result = await certificates.reconcile(body.transactionHash, intent);
    res.status(transactionHttpStatus(result)).json(result);
  });
  router.post("/certificates/:id/revocation/prepare", async (req, res) => {
    const s = await authenticatedMutation(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const intent = await certificates.revocationIntent(
      s.wallet,
      certificateId.parse(req.params.id),
    );
    res.json({
      status: "AWAITING_SIGNATURE",
      transaction: await chain.prepare(intent),
    });
  });
  router.post("/certificates/:id/revocation/transaction", async (req, res) => {
    const s = await authenticatedMutation(req);
    const body = z.object({ transactionHash: hex32 }).strict().parse(req.body);
    const intent = await certificates.revocationIntent(
      s.wallet,
      certificateId.parse(req.params.id),
    );
    const result = await certificates.reconcile(body.transactionHash, intent);
    res.status(transactionHttpStatus(result)).json(result);
  });
  router.get("/transactions/:hash", async (req, res) => {
    const s = await logged(req);
    const result = await certificates.transaction(
      s.wallet,
      hex32.parse(req.params.hash),
    );
    res.status(transactionHttpStatus(result)).json(result);
  });
  router.get("/certificates/:id/metadata", async (req, res) => {
    const s = await logged(req);
    res.json(
      await certificates.metadata(s.wallet, certificateId.parse(req.params.id)),
    );
  });
  router.patch("/certificates/:id/metadata", async (req, res) => {
    const s = await authenticatedMutation(req);
    const body = metadataPatch.parse(req.body);
    res.json(
      await certificates.patchMetadata(
        s.wallet,
        certificateId.parse(req.params.id),
        body.displayLabel,
      ),
    );
  });
  router.delete("/certificates/:id/metadata", async (req, res) => {
    const s = await authenticatedMutation(req);
    await certificates.deleteMetadata(
      s.wallet,
      certificateId.parse(req.params.id),
    );
    res.sendStatus(204);
  });
  router.get("/issuer/drafts", async (req, res) => {
    const s = await logged(req),
      p = pagination.parse(req.query);
    const drafts = await certificates.drafts(s.wallet, p.cursor, p.limit);
    const issued = drafts.length
      ? await chain.existing(drafts.map((d) => d.certificateId))
      : new Set<string>();
    res.json({
      drafts: drafts.map((d) => ({
        draftId: d.key,
        certificateId: d.certificateId,
        documentHash: d.documentHash,
        expiresAt: d.expiresAt,
        issued: issued.has(d.certificateId),
      })),
      nextCursor: drafts.length === p.limit ? p.cursor + p.limit : null,
    });
  });
  router.get("/certificates/:id/history", async (req, res) => {
    const p = pagination.parse(req.query);
    res.json(
      await indexer.history(
        certificateId.parse(req.params.id),
        p.cursor,
        p.limit,
      ),
    );
  });
  router.get("/issuer/certificates", async (req, res) => {
    const s = await logged(req);
    await certificates.requireIssuer(s.wallet);
    const p = pagination.parse(req.query);
    const head = await chain.head();
    const cp = await store.one("checkpoints", {
      key: config.manifest.deploymentId,
    });
    if (
      !cp ||
      cp.blockNumber > head.number ||
      (await chain.block(cp.blockNumber)).hash !== cp.blockHash
    )
      fail(503, "HISTORY_UNAVAILABLE");
    const events = await store.list(
      "events",
      {
        deploymentId: config.manifest.deploymentId,
        issuer: s.wallet,
        name: "CertificateIssued",
        blockNumber: { $lte: cp.blockNumber },
      },
      { blockNumber: 1, logIndex: 1 },
      p.limit,
      p.cursor,
    );
    res.json({
      certificates: events.map((e) => ({
        certificateId: e.id,
        transactionHash: e.transactionHash,
        blockNumber: e.blockNumber,
      })),
      indexedThroughBlock: cp.blockNumber,
      lag: head.number - cp.blockNumber,
      nextCursor: events.length === p.limit ? p.cursor + p.limit : null,
      authoritative: false,
    });
  });
  router.get("/admin/issuers", async (req, res) => {
    const s = await logged(req);
    await certificates.requireAdmin(s.wallet);
    const p = pagination.parse(req.query),
      dep = config.manifest.deploymentId,
      head = await chain.head();
    const cp = await store.one("checkpoints", { key: dep });
    if (
      !cp ||
      cp.blockNumber > head.number ||
      (await chain.block(cp.blockNumber)).hash !== cp.blockHash
    )
      fail(503, "HISTORY_UNAVAILABLE");
    const changes = await store.list(
      "events",
      {
        deploymentId: dep,
        role: ISSUER_ROLE,
        blockNumber: { $lte: cp.blockNumber },
      },
      { blockNumber: 1, logIndex: 1 },
      p.limit,
      p.cursor,
    );
    const wallets = [
      ...new Set(changes.map((e) => e.account).filter((v): v is string => !!v)),
    ];
    const issuers = [];
    for (const wallet of wallets)
      issuers.push({ wallet, active: (await chain.roles(wallet)).issuer });
    if ((await chain.block(cp.blockNumber)).hash !== cp.blockHash)
      fail(503, "HISTORY_UNAVAILABLE");
    res.json({
      issuers,
      indexedThroughBlock: cp.blockNumber,
      lag: head.number - cp.blockNumber,
      nextCursor: changes.length === p.limit ? p.cursor + p.limit : null,
      cursorUnit: "roleEvents",
    });
  });
  router.get("/admin/issuers/:wallet/profile", async (req, res) => {
    const s = await logged(req);
    await certificates.requireAdmin(s.wallet);
    const wallet = address.parse(req.params.wallet);
    const profile = await store.one("profiles", {
      deploymentId: config.manifest.deploymentId,
      wallet,
    });
    if (!profile) fail(404, "PROFILE_NOT_FOUND");
    res.json({ wallet, institutionName: profile.institutionName });
  });
  router.put("/admin/issuers/:wallet/profile", async (req, res) => {
    const s = await authenticatedMutation(req);
    await certificates.requireAdmin(s.wallet);
    const wallet = address.parse(req.params.wallet);
    const body = z
      .object({ institutionName: z.string().trim().min(1).max(120) })
      .strict()
      .parse(req.body);
    await store.upsert(
      "profiles",
      { key: config.manifest.deploymentId + ":" + wallet },
      {
        key: config.manifest.deploymentId + ":" + wallet,
        deploymentId: config.manifest.deploymentId,
        wallet,
        institutionName: body.institutionName,
        updatedAt: new Date(),
      },
    );
    res.json({ wallet, ...body });
  });
  app.use((_req, res) =>
    res.status(404).json({ error: { code: "NOT_FOUND" } }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e =
        error instanceof ApiError
          ? error
          : error instanceof ZodError
            ? new ApiError(400, "VALIDATION_ERROR")
            : (error as { type?: string })?.type === "entity.too.large"
              ? new ApiError(413, "REQUEST_TOO_LARGE")
              : error instanceof SyntaxError
                ? new ApiError(400, "JSON_INVALID")
                : new ApiError(500, "INTERNAL_ERROR");
      if (e.status >= 500) diagnostic(e.code);
      if (!res.headersSent)
        res.status(e.status).json({
          error: {
            code: e.code,
            ...(e.contractError ? { contractError: e.contractError } : {}),
          },
        });
    },
  );
  return app;
}
