import { it, expect, vi } from "vitest";
import request from "supertest";
import { Wallet } from "ethers";
import { createApp, READINESS_CACHE_MS } from "../../src/app.js";
import { AuthService } from "../../src/services/auth.js";
import { ApiError } from "../../src/errors.js";
import {
  config,
  MemoryStore,
  mockChain,
  id,
  wallet,
  other,
  pdf,
  record,
} from "../helpers/fixtures.js";
function setup() {
  const c = config(),
    store = new MemoryStore(),
    chain = mockChain(),
    app = createApp(c, store, chain);
  return { c, store, chain, app };
}
async function logged(s: ReturnType<typeof setup>, as = wallet) {
  const auth = new AuthService(s.c, s.store, s.chain);
  const session = await auth.create(as);
  return {
    Cookie: "cert_session=" + session.raw,
    Origin: s.c.APP_ORIGIN,
    "X-CSRF-Token": session.csrfToken,
  };
}
it("liveness survives dependencies; readiness accurately reports failures", async () => {
  const { app, store, chain } = setup();
  store.available = false;
  chain.head.mockRejectedValue(new ApiError(503, "RPC_UNAVAILABLE"));
  expect((await request(app).get("/api/v1/health/live")).status).toBe(200);
  expect((await request(app).get("/api/v1/health/ready")).body).toEqual({
    status: "UNAVAILABLE",
    database: false,
    blockchain: false,
  });
});
it("public verification works while Mongo is unavailable and returns no private data", async () => {
  const { app, store } = setup();
  store.available = false;
  const r = await request(app).get(
    `/api/v1/certificates/${id(1)}/verification`,
  );
  expect(r.status).toBe(200);
  expect(r.body.status).toBe("UNKNOWN");
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["x-powered-by"]).toBeUndefined();
});
it("invalid IDs and unexpected parameters fail validation", async () => {
  const { app } = setup();
  expect(
    (await request(app).get("/api/v1/certificates/123/verification")).status,
  ).toBe(400);
  expect(
    (await request(app).get(`/api/v1/certificates/${id(0)}/verification`))
      .status,
  ).toBe(400);
});
it("hashes uploaded bytes and detects tampered PDF, ignoring caller digest claims", async () => {
  const { app, chain } = setup();
  chain.inspect.mockResolvedValue({
    exists: true,
    record: record(),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  const r = await request(app)
    .post(`/api/v1/certificates/${id(1)}/verify-pdf`)
    .attach("pdf", pdf, {
      filename: "synthetic.pdf",
      contentType: "application/pdf",
    });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe("MODIFIED");
  expect(chain.inspect.mock.calls[0]?.[1]).toMatch(/^0x[0-9a-f]{64}$/);
  const bad = await request(app)
    .post(`/api/v1/certificates/${id(1)}/verify-pdf`)
    .field("documentHash", id(2))
    .attach("pdf", pdf, "synthetic.pdf");
  expect(bad.status).toBe(400);
});
it.each([
  ["wrong.txt", "application/pdf", pdf, 415],
  ["wrong.pdf", "text/plain", pdf, 415],
  ["fake.pdf", "application/pdf", Buffer.from("fake"), 422],
  ["truncated.pdf", "application/pdf", Buffer.from("%PDF-1.4"), 422],
] as const)(
  "rejects invalid PDF %s %s",
  async (filename, contentType, bytes, status) => {
    const { app } = setup();
    const r = await request(app)
      .post(`/api/v1/certificates/${id(1)}/verify-pdf`)
      .attach("pdf", bytes, { filename, contentType });
    expect(r.status).toBe(status);
  },
);
it("rejects missing file, multiple files, malformed multipart and excessive body size", async () => {
  const { app } = setup();
  const path = `/api/v1/certificates/${id(1)}/verify-pdf`;
  expect((await request(app).post(path).send({})).status).toBe(400);
  expect(
    (
      await request(app)
        .post(path)
        .attach("pdf", pdf, "a.pdf")
        .attach("pdf", pdf, "b.pdf")
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post(path)
        .set("Content-Type", "multipart/form-data; boundary=bad")
        .send("malformed")
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post(path)
        .attach("pdf", Buffer.alloc(10485761, 32), "a.pdf")
    ).status,
  ).toBe(413);
});
it("denies unauthenticated, CSRF-less, foreign-origin and removed-issuer writes", async () => {
  const s = setup();
  const path = "/api/v1/issuance-drafts";
  expect(
    (await request(s.app).post(path).set("Origin", s.c.APP_ORIGIN)).status,
  ).toBe(401);
  const headers = await logged(s);
  expect(
    (
      await request(s.app)
        .post(path)
        .set({ Cookie: headers.Cookie, Origin: s.c.APP_ORIGIN })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(s.app)
        .post(path)
        .set({ ...headers, Origin: "https://evil.example" })
    ).status,
  ).toBe(403);
  s.chain.roles.mockResolvedValue({ issuer: false, admin: false });
  expect((await request(s.app).post(path).set(headers)).status).toBe(403);
});
it("RPC authorization failure denies privileged operations without leaking provider details", async () => {
  const s = setup(),
    headers = await logged(s);
  s.chain.roles.mockRejectedValue(new ApiError(503, "RPC_UNAVAILABLE"));
  const r = await request(s.app).post("/api/v1/issuance-drafts").set(headers);
  expect(r.status).toBe(503);
  expect(r.body).toEqual({ error: { code: "RPC_UNAVAILABLE" } });
});
it("creates hash-only draft and prepares an unsigned transaction", async () => {
  const s = setup(),
    headers = await logged(s);
  const r = await request(s.app)
    .post("/api/v1/issuance-drafts")
    .set(headers)
    .field("certificateId", id(1))
    .attach("pdf", pdf, "synthetic.pdf");
  expect(r.status).toBe(201);
  expect(s.store.rows.drafts).toHaveLength(1);
  expect(JSON.stringify(s.store.rows.drafts)).not.toContain("%PDF");
  const prepared = await request(s.app)
    .post(`/api/v1/issuance-drafts/${r.body.draftId}/prepare`)
    .set(headers)
    .send({});
  expect(prepared.body.status).toBe("AWAITING_SIGNATURE");
  expect(s.chain.prepare).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "issue", wallet, ids: [id(1)] }),
  );
});
it.each([[], [id(1), id(1)], Array.from({ length: 51 }, (_, n) => id(n + 1))])(
  "rejects invalid batch %#",
  async (draftIds) => {
    const s = setup();
    const r = await request(s.app)
      .post("/api/v1/issuance-batches/prepare")
      .set(await logged(s))
      .send({ draftIds });
    expect(r.status).toBe(400);
    expect(s.chain.prepare).not.toHaveBeenCalled();
  },
);
it("protects private metadata from another issuer and admin without ownership", async () => {
  const s = setup();
  s.chain.inspect.mockResolvedValue({
    exists: true,
    record: record(),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  expect(
    (
      await request(s.app)
        .get(`/api/v1/certificates/${id(1)}/metadata`)
        .set(await logged(s, other))
    ).status,
  ).toBe(403);
  s.chain.roles.mockResolvedValue({ issuer: false, admin: true });
  expect(
    (
      await request(s.app)
        .get(`/api/v1/certificates/${id(1)}/metadata`)
        .set(await logged(s))
    ).status,
  ).toBe(403);
});
it("rejects academic/private fields and Mongo operators", async () => {
  const s = setup(),
    headers = await logged(s);
  for (const body of [
    { studentName: "x" },
    { displayLabel: "a", $set: { issuer: other } },
  ])
    expect(
      (
        await request(s.app)
          .patch(`/api/v1/certificates/${id(1)}/metadata`)
          .set(headers)
          .send(body)
      ).status,
    ).toBe(400);
});
it("rejects admin revocation without being the original issuer", async () => {
  const s = setup();
  s.chain.roles.mockResolvedValue({ issuer: false, admin: true });
  s.chain.inspect.mockResolvedValue({
    exists: true,
    record: record({ issuer: other }),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  const r = await request(s.app)
    .post(`/api/v1/certificates/${id(1)}/revocation/prepare`)
    .set(await logged(s))
    .send({});
  expect(r.status).toBe(403);
  expect(r.body.error.code).toBe("REVOCATION_FORBIDDEN");
  expect(s.chain.prepare).not.toHaveBeenCalled();
});
it("returns 503 for unavailable history, not an authoritative empty list", async () => {
  const s = setup();
  const r = await request(s.app).get(`/api/v1/certificates/${id(1)}/history`);
  expect(r.status).toBe(503);
  expect(r.body.error.code).toBe("HISTORY_UNAVAILABLE");
});
it("runs full SIWE HTTP cookie/CSRF flow and logout", async () => {
  const s = setup(),
    agent = request.agent(s.app),
    signer = Wallet.createRandom();
  const initial = await agent.get("/api/v1/auth/session");
  expect(initial.headers["set-cookie"]![0]).toContain("HttpOnly");
  const headers = {
    Origin: s.c.APP_ORIGIN,
    "X-CSRF-Token": initial.body.csrfToken,
  };
  const challenge = await agent
    .post("/api/v1/auth/challenge")
    .set(headers)
    .send({ wallet: signer.address });
  const verified = await agent
    .post("/api/v1/auth/verify")
    .set(headers)
    .send({
      message: challenge.body.message,
      signature: await signer.signMessage(challenge.body.message),
    });
  expect(verified.status).toBe(200);
  expect(verified.body.wallet).toBe(signer.address.toLowerCase());
  expect(verified.body.csrfToken).not.toBe(initial.body.csrfToken);
  expect(
    (
      await agent.delete("/api/v1/auth/session").set({
        Origin: s.c.APP_ORIGIN,
        "X-CSRF-Token": verified.body.csrfToken,
      })
    ).status,
  ).toBe(204);
});
it("readiness shares one recent dependency check across callers", async () => {
  const { app, chain } = setup();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => request(app).get("/api/v1/health/ready")),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  expect(chain.head).toHaveBeenCalledTimes(1);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + READINESS_CACHE_MS);
    chain.head.mockRejectedValueOnce(new ApiError(503, "RPC_UNAVAILABLE"));
    const stale = await request(app).get("/api/v1/health/ready");
    expect(stale.status).toBe(503);
    expect(chain.head).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("rate-limits readiness before dependency checks, separately from public reads", async () => {
  const c = config();
  c.READ_RATE_PER_MIN = 2;
  const chain = mockChain();
  const app = createApp(c, new MemoryStore(), chain);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    for (let n = 0; n < 2; n++) {
      expect((await request(app).get("/api/v1/health/ready")).status).toBe(200);
      vi.setSystemTime(Date.now() + READINESS_CACHE_MS);
    }
    const limited = await request(app).get("/api/v1/health/ready");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(chain.head).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
  // Liveness stays unlimited; public reads keep their own budget.
  expect((await request(app).get("/api/v1/health/live")).status).toBe(200);
  expect(
    (await request(app).get(`/api/v1/certificates/${id(1)}/verification`))
      .status,
  ).toBe(200);
});
it("enforces public rate limits", async () => {
  const c = config();
  c.READ_RATE_PER_MIN = 1;
  const app = createApp(c, new MemoryStore(), mockChain());
  await request(app).get(`/api/v1/certificates/${id(1)}/verification`);
  expect(
    (await request(app).get(`/api/v1/certificates/${id(1)}/verification`))
      .status,
  ).toBe(429);
});
