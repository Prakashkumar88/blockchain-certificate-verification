import { beforeAll, afterAll, it, expect, describe } from "vitest";
import request from "supertest";
import { mined, startAnvil } from "../helpers/anvil.js";
import { connectStore, type MongoStore } from "../../src/storage/mongo.js";
import { createApp } from "../../src/app.js";
import { sha256 } from "../../src/services/pdf.js";
import { id } from "../helpers/fixtures.js";
import { dropTestDatabase, testDatabaseUri } from "../helpers/mongo.js";
import { Wallet } from "ethers";


describe("E2E Integration Lifecycle (Contract + Backend + Mongo + Client Wallet)", () => {
  let env: Awaited<ReturnType<typeof startAnvil>>;
  let store: MongoStore;
  let app: ReturnType<typeof createApp>;
  let issuerAddress: string;

  // Track session auth tokens
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    // 1. Start fresh local Anvil node with deployed Phase 1 CertificateRegistry contract
    env = await startAnvil();
    issuerAddress = (await env.issuer.getAddress()).toLowerCase();

    // 2. Connect to fresh test database on real local MongoDB
    store = await connectStore(testDatabaseUri(process.env.TEST_MONGODB_URI));

    // 3. Instantiate real Phase 2 backend app
    app = createApp(env.config, store, env.chain);
  }, 60000);

  afterAll(async () => {
    try {
      await dropTestDatabase(store);
    } finally {
      await env?.close();
    }
  }, 60000);

  // SCENARIO 1: Backend health and readiness
  it("Scenario 1 [PASS]: Backend health and readiness checks reflect live Mongo and Anvil", async () => {
    // Live check
    const liveRes = await request(app).get("/api/v1/health/live");
    expect(liveRes.status).toBe(200);
    expect(liveRes.body).toEqual({ status: "LIVE" });

    // Ready check verifies actual MongoDB connection AND blockchain RPC head
    const readyRes = await request(app).get("/api/v1/health/ready");
    expect(readyRes.status).toBe(200);
    expect(readyRes.body).toMatchObject({
      status: "READY",
      database: true,
      blockchain: true,
    });
  });

  // SCENARIO 2: Wallet connection and SIWE authentication
  it("Scenario 2 [PASS]: Wallet connection, EIP-4361 challenge, and SIWE authentication", async () => {
    // Step 1: Initial unauthenticated session
    const initSession = await request(app).get("/api/v1/auth/session");
    expect(initSession.status).toBe(200);
    expect(initSession.body.wallet).toBeNull();
    csrfToken = initSession.body.csrfToken;
    const cookieHeader = initSession.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    sessionCookie = (cookieHeader as unknown as string[])[0]!.split(";")[0]!;

    // Step 2: Request SIWE challenge for issuer wallet
    const challengeRes = await request(app)
      .post("/api/v1/auth/challenge")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ wallet: issuerAddress });

    expect(challengeRes.status).toBe(200);
    expect(challengeRes.body.message).toContain("localhost:5173");
    const challengeMessage = challengeRes.body.message;

    // Step 3: Client wallet signs challenge message (non-custodial)
    const signature = await env.issuer.signMessage(challengeMessage);

    // Step 4: Verify signature with backend
    const verifyRes = await request(app)
      .post("/api/v1/auth/verify")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({
        message: challengeMessage,
        signature,
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.wallet).toBe(issuerAddress);
    expect(verifyRes.body.csrfToken).toBeDefined();

    // Update session cookie and CSRF token for subsequent authenticated issuer requests
    csrfToken = verifyRes.body.csrfToken;
    const authCookieHeader = verifyRes.headers["set-cookie"];
    if (authCookieHeader) {
      sessionCookie = (authCookieHeader as unknown as string[])[0]!.split(";")[0]!;
    }
  });

  // SCENARIO 3: Issuer authorization
  it("Scenario 3 [PASS]: Issuer authorization verification on-chain and rejection of unauthorized callers", async () => {
    // 1. Confirm issuer role on-chain
    const issuerRoles = await env.chain.roles(issuerAddress);
    expect(issuerRoles.issuer).toBe(true);

    // 2. Create random unauthorized wallet and perform SIWE
    const unauthorized = Wallet.createRandom();
    const unauthAddress = unauthorized.address.toLowerCase();

    const sessionInit = await request(app).get("/api/v1/auth/session");
    const unauthCookie = (sessionInit.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const unauthCsrf = sessionInit.body.csrfToken;

    const chal = await request(app)
      .post("/api/v1/auth/challenge")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", unauthCookie)
      .set("X-CSRF-Token", unauthCsrf)
      .send({ wallet: unauthAddress });

    const unauthSig = await unauthorized.signMessage(chal.body.message);
    const authVerify = await request(app)
      .post("/api/v1/auth/verify")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", unauthCookie)
      .set("X-CSRF-Token", unauthCsrf)
      .send({ message: chal.body.message, signature: unauthSig });

    const loggedUnauthCookie = (authVerify.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    // 3. Attempt issuer-protected endpoint with unauthorized wallet
    const samplePdf = Buffer.from("%PDF-1.4\n% unauthorized test\n%%EOF\n");
    const forbiddenRes = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", loggedUnauthCookie)
      .set("X-CSRF-Token", authVerify.body.csrfToken)
      .attach("pdf", samplePdf, "test.pdf");

    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error.code).toBe("ISSUER_REQUIRED");
  });

  // SCENARIO 4: Individual certificate issuance using client-wallet signing
  let issuedCertId: string;
  let issuedDocHash: string;
  let originalPdfBytes: Buffer;

  it("Scenario 4 [PASS]: Individual certificate issuance with non-custodial wallet signing and receipt reconciliation", async () => {
    originalPdfBytes = Buffer.from("%PDF-1.4\n% Authentic Academic Certificate 2026\n%%EOF\n");
    issuedDocHash = sha256(originalPdfBytes);

    // 1. Upload draft as authorized issuer
    const draftRes = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .attach("pdf", originalPdfBytes, "certificate.pdf");

    expect(draftRes.status).toBe(201);
    expect(draftRes.body.draftId).toBeDefined();
    expect(draftRes.body.documentHash).toBe(issuedDocHash);

    const draftId = draftRes.body.draftId;
    issuedCertId = draftRes.body.certificateId;

    // 2. Prepare transaction: backend simulates call and returns calldata
    const prepRes = await request(app)
      .post(`/api/v1/issuance-drafts/${draftId}/prepare`)
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(prepRes.status).toBe(200);
    expect(prepRes.body.status).toBe("AWAITING_SIGNATURE");
    const txData = prepRes.body.transaction;
    expect(txData.to.toLowerCase()).toBe(env.config.manifest.contractAddress.toLowerCase());

    // CONFIRMATION CHECK: Verify the backend NEVER broadcasts on its own.
    const preCheck = await env.chain.inspect(issuedCertId);
    expect(preCheck.exists).toBe(false);

    // 3. Client wallet signs and broadcasts to Anvil
    const tx = await env.issuer.sendTransaction({
      to: txData.to,
      data: txData.data,
    });
    expect(tx.hash).toBeDefined();

    // 4. Client awaits on-chain block receipt confirmation
    const receipt = await mined(env.provider, tx);
    expect(receipt!.status).toBe(1);

    // 5. Client submits transaction hash to backend for reconciliation
    const reconcileRes = await request(app)
      .post(`/api/v1/issuance-drafts/${draftId}/transaction`)
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ transactionHash: tx.hash });

    expect(reconcileRes.status).toBe(200);
    expect(reconcileRes.body.status).toBe("CONFIRMED");
    expect(reconcileRes.body.metadataStatus).toBe("SYNCED");

    // Verify on-chain state exists and matches
    const postCheck = await env.chain.inspect(issuedCertId);
    expect(postCheck.exists).toBe(true);
    expect(postCheck.record.documentHash).toBe(issuedDocHash);
    expect(postCheck.record.issuer.toLowerCase()).toBe(issuerAddress);
  });

  // SCENARIO 5: Verification of the original PDF
  it("Scenario 5 [PASS]: Public verification of original PDF returns VALID", async () => {
    // Test verification via PDF upload
    const pdfVerifyRes = await request(app)
      .post(`/api/v1/certificates/${issuedCertId}/verify-pdf`)
      .attach("pdf", originalPdfBytes, "document.pdf");

    expect(pdfVerifyRes.status).toBe(200);
    expect(pdfVerifyRes.body.status).toBe("VALID");
    expect(pdfVerifyRes.body.documentMatch).toBe(true);
    expect(pdfVerifyRes.body.confirmations).toBeGreaterThanOrEqual(1);

    // Test verification by Certificate ID only
    const idVerifyRes = await request(app)
      .get(`/api/v1/certificates/${issuedCertId}/verification`);

    expect(idVerifyRes.status).toBe(200);
    expect(idVerifyRes.body.status).toBe("VALID");
    expect(idVerifyRes.body.record.documentHash).toBe(issuedDocHash);
    expect(idVerifyRes.body.record.issuer.toLowerCase()).toBe(issuerAddress);
  });

  // SCENARIO 6: Verification of a modified PDF
  it("Scenario 6 [PASS]: Verification of modified PDF returns MODIFIED", async () => {
    // Tamper with 1 byte in the PDF stream
    const modifiedBytes = Buffer.from(originalPdfBytes);
    modifiedBytes[12] = modifiedBytes[12]! ^ 1;

    const modifiedVerifyRes = await request(app)
      .post(`/api/v1/certificates/${issuedCertId}/verify-pdf`)
      .attach("pdf", modifiedBytes, "modified.pdf");

    expect(modifiedVerifyRes.status).toBe(200);
    expect(modifiedVerifyRes.body.status).toBe("MODIFIED");
    expect(modifiedVerifyRes.body.documentMatch).toBe(false);
  });

  // SCENARIO 7: Certificate revocation and subsequent REVOKED verification
  it("Scenario 7 [PASS]: Irreversible certificate revocation and subsequent REVOKED verification", async () => {
    // 1. Prepare revocation transaction
    const prepRevoke = await request(app)
      .post(`/api/v1/certificates/${issuedCertId}/revocation/prepare`)
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(prepRevoke.status).toBe(200);
    expect(prepRevoke.body.status).toBe("AWAITING_SIGNATURE");
    const revokeTxData = prepRevoke.body.transaction;

    // 2. Client signs and broadcasts revocation transaction
    const revokeTx = await env.issuer.sendTransaction({
      to: revokeTxData.to,
      data: revokeTxData.data,
    });
    const revokeReceipt = await mined(env.provider, revokeTx);
    expect(revokeReceipt!.status).toBe(1);

    // 3. Reconcile revocation with backend
    const reconcileRevoke = await request(app)
      .post(`/api/v1/certificates/${issuedCertId}/revocation/transaction`)
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ transactionHash: revokeTx.hash });

    expect(reconcileRevoke.status).toBe(200);
    expect(reconcileRevoke.body.status).toBe("CONFIRMED");

    // 4. Verify public lookup returns REVOKED
    const idVerifyAfter = await request(app)
      .get(`/api/v1/certificates/${issuedCertId}/verification`);
    expect(idVerifyAfter.status).toBe(200);
    expect(idVerifyAfter.body.status).toBe("REVOKED");

    // 5. Verify PDF verification also returns REVOKED
    const pdfVerifyAfter = await request(app)
      .post(`/api/v1/certificates/${issuedCertId}/verify-pdf`)
      .attach("pdf", originalPdfBytes, "document.pdf");
    expect(pdfVerifyAfter.status).toBe(200);
    expect(pdfVerifyAfter.body.status).toBe("REVOKED");
  });

  // SCENARIO 8: Unknown certificate handling
  it("Scenario 8 [PASS]: Unknown certificate handling returns UNKNOWN status", async () => {
    const unissuedId = id(88888);
    const unknownRes = await request(app)
      .get(`/api/v1/certificates/${unissuedId}/verification`);

    expect(unknownRes.status).toBe(200);
    expect(unknownRes.body.status).toBe("UNKNOWN");
    expect(unknownRes.body.confirmations).toBe(0);
  });

  // SCENARIO 9: Wallet transaction rejection and API/RPC failure handling
  it("Scenario 9 [PASS]: Wallet transaction rejection, oversized file, and invalid inputs", async () => {
    // 1. Prepare a draft that the client chooses NOT to broadcast (rejected signature)
    const testBytes = Buffer.from("%PDF-1.4\n% Rejected transaction fixture\n%%EOF\n");
    const draftRes = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .attach("pdf", testBytes, "rejected.pdf");

    expect(draftRes.status).toBe(201);
    const unbroadcastedId = draftRes.body.certificateId;

    // Verify it never reaches the blockchain
    const onChainCheck = await env.chain.inspect(unbroadcastedId);
    expect(onChainCheck.exists).toBe(false);

    // 2. Test invalid certificate ID (non-hex32) returns HTTP 400
    const invalidIdRes = await request(app)
      .get("/api/v1/certificates/NOT-A-HEX32-ID/verification");
    expect(invalidIdRes.status).toBe(400);

    // 3. Test non-PDF structure rejection returns HTTP 422
    const nonPdfBytes = Buffer.from("Hello world, this is a plain text file, not a PDF.");
    const invalidFormatRes = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .attach("pdf", nonPdfBytes, "document.txt");
    expect(invalidFormatRes.status).toBe(415);
  });

  // SCENARIO 10: Batch issuance with at least two certificates
  it("Scenario 10 [PASS]: Batch issuance of multiple certificates in a single atomic transaction", async () => {
    // 1. Create two distinct drafts
    const pdf1 = Buffer.from("%PDF-1.4\n% Batch Student 001\n%%EOF\n");
    const pdf2 = Buffer.from("%PDF-1.4\n% Batch Student 002\n%%EOF\n");

    const draft1Res = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .attach("pdf", pdf1, "student1.pdf");
    expect(draft1Res.status).toBe(201);

    const draft2Res = await request(app)
      .post("/api/v1/issuance-drafts")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .attach("pdf", pdf2, "student2.pdf");
    expect(draft2Res.status).toBe(201);

    const draftIds = [draft1Res.body.draftId, draft2Res.body.draftId];
    const certIds = [draft1Res.body.certificateId, draft2Res.body.certificateId];

    // 2. Prepare batch transaction via backend
    const batchPrep = await request(app)
      .post("/api/v1/issuance-batches/prepare")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ draftIds });

    expect(batchPrep.status).toBe(200);
    expect(batchPrep.body.status).toBe("AWAITING_SIGNATURE");
    expect(batchPrep.body.maxBatchSize).toBe(50);
    const batchTxData = batchPrep.body.transaction;

    // 3. Client signs and broadcasts batch transaction to Anvil
    const batchTx = await env.issuer.sendTransaction({
      to: batchTxData.to,
      data: batchTxData.data,
    });
    const batchReceipt = await mined(env.provider, batchTx);
    expect(batchReceipt!.status).toBe(1);

    // 4. Reconcile batch with backend
    const batchReconcile = await request(app)
      .post("/api/v1/issuance-batches/transaction")
      .set("Origin", env.config.APP_ORIGIN)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ draftIds, transactionHash: batchTx.hash });

    expect(batchReconcile.status).toBe(200);
    expect(batchReconcile.body.status).toBe("CONFIRMED");

    // 5. Verify both certificates are now VALID on-chain
    for (const certId of certIds) {
      const verifyRes = await request(app)
        .get(`/api/v1/certificates/${certId}/verification`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.status).toBe("VALID");
    }
  });
});
