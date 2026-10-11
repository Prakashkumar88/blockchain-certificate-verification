import { beforeAll, afterAll, it, expect } from "vitest";
import request from "supertest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mined, startAnvil, freePort, stopChild } from "../helpers/anvil.js";
import { id, pdf, MemoryStore } from "../helpers/fixtures.js";
import { sha256 } from "../../src/services/pdf.js";
import { VerificationService } from "../../src/services/verification.js";
import { CertificateService } from "../../src/services/certificates.js";
import { createApp } from "../../src/app.js";
import { EventIndexer } from "../../src/indexer/indexer.js";
import type { Intent } from "../../src/services/chain.js";
let env: Awaited<ReturnType<typeof startAnvil>>;
beforeAll(async () => {
  env = await startAnvil();
});
afterAll(async () => {
  await env?.close();
});
it("round-trips exact Node SHA-256 bytes through Ethers calldata, storage and events", async () => {
  let bytes: Buffer, digest: string;
  for (let n = 0; ; n++) {
    bytes = Buffer.from(`%PDF-1.4\n% ${n}\n%%EOF\n`);
    digest = sha256(bytes);
    if (digest.startsWith("0x00")) break;
  }
  const tx = await env.contract
    .connect(env.issuer)
    .getFunction("issueCertificate")(id(101), digest);
  const receipt = await mined(env.provider, tx);
  expect((await env.chain.inspect(id(101), digest)).record.documentHash).toBe(
    digest,
  );
  const result = await env.chain.transaction(receipt.hash, {
    kind: "issue",
    wallet: (await env.issuer.getAddress()).toLowerCase(),
    ids: [id(101)],
    digests: [digest],
  });
  expect(result.status).toBe("CONFIRMED");
  expect(result.events?.[0]?.digest).toBe(digest);
  const api = createApp(env.config, new MemoryStore(), env.chain);
  expect(
    (
      await request(api)
        .post(`/api/v1/certificates/${id(101)}/verify-pdf`)
        .attach("pdf", bytes, "fixture.pdf")
    ).body.status,
  ).toBe("VALID");
  const modified = Buffer.from(bytes);
  modified[12] = modified[12]! ^ 1;
  expect(
    (
      await request(api)
        .post(`/api/v1/certificates/${id(101)}/verify-pdf`)
        .attach("pdf", modified, "fixture.pdf")
    ).body.status,
  ).toBe("MODIFIED");
});
it("keeps pending issuance unknown and pending revocation valid until mined", async () => {
  const wallet = (await env.issuer.getAddress()).toLowerCase(),
    digest = sha256(pdf),
    intent: Intent = {
      kind: "issue",
      wallet,
      ids: [id(102)],
      digests: [digest],
    };
  await env.provider.send("evm_setAutomine", [false]);
  try {
    const tx = await env.issuer.sendTransaction({
      to: env.config.manifest.contractAddress,
      data: env.chain.data(intent),
      gasLimit: 200000,
    });
    expect((await env.chain.transaction(tx.hash, intent)).status).toBe(
      "PENDING",
    );
    expect(
      (await new VerificationService(env.config, env.chain).verify(id(102)))
        .status,
    ).toBe("UNKNOWN");
    await env.provider.send("evm_mine", []);
    env.config.MIN_ISSUANCE_CONFIRMATIONS = 2;
    expect(
      await new VerificationService(env.config, env.chain).verify(id(102)),
    ).toMatchObject({ status: "UNAVAILABLE", reason: "CONFIRMATION_PENDING" });
    expect((await env.chain.transaction(tx.hash, intent)).status).toBe(
      "CONFIRMATION_PENDING",
    );
    await env.provider.send("evm_mine", []);
    env.config.MIN_ISSUANCE_CONFIRMATIONS = 1;
    const revoke: Intent = {
      kind: "revoke",
      wallet,
      ids: [id(102)],
      digests: [],
    };
    const pending = await env.issuer.sendTransaction({
      to: env.config.manifest.contractAddress,
      data: env.chain.data(revoke),
      gasLimit: 150000,
    });
    expect((await env.chain.transaction(pending.hash, revoke)).status).toBe(
      "PENDING",
    );
    expect(
      (await new VerificationService(env.config, env.chain).verify(id(102)))
        .status,
    ).toBe("VALID");
    await env.provider.send("evm_mine", []);
    expect(
      (
        await new VerificationService(env.config, env.chain).verify(
          id(102),
          id(999),
        )
      ).status,
    ).toBe("REVOKED");
  } finally {
    env.config.MIN_ISSUANCE_CONFIRMATIONS = 1;
    await env.provider.send("evm_setAutomine", [true]);
  }
});
it("supports a real 50-record batch and distinguishes a mined reverting receipt", async () => {
  const wallet = (await env.issuer.getAddress()).toLowerCase(),
    ids = Array.from({ length: 50 }, (_, n) => id(200 + n)),
    digests = ids.map(() => sha256(pdf));
  const intent: Intent = { kind: "batch", wallet, ids, digests };
  expect(await env.chain.maxBatch()).toBe(50);
  const prepared = await env.chain.prepare(intent);
  const tx = await env.issuer.sendTransaction({
    ...prepared,
    gasLimit: 5000000,
  });
  await mined(env.provider, tx);
  expect((await env.chain.transaction(tx.hash, intent)).events).toHaveLength(
    50,
  );
  const bad: Intent = {
    kind: "batch",
    wallet,
    ids: [id(999), ids[0]!],
    digests: [digests[0]!, digests[0]!],
  };
  const hash = await env.provider.send("eth_sendTransaction", [
    {
      from: wallet,
      to: env.config.manifest.contractAddress,
      data: env.chain.data(bad),
      gas: "0x7a120",
    },
  ]);
  await mined(env.provider, hash);
  expect((await env.chain.transaction(hash, bad)).status).toBe("REVERTED");
  expect((await env.chain.inspect(id(999))).exists).toBe(false);
});
it("rejects forged transaction hints and preserves records after issuer removal", async () => {
  const issuer = (await env.issuer.getAddress()).toLowerCase(),
    admin = (await env.admin.getAddress()).toLowerCase();
  await mined(
    env.provider,
    await env.contract.getFunction("revokeRole")(
      await env.contract.getFunction("ISSUER_ROLE")(),
      issuer,
    ),
  );
  expect((await env.chain.roles(issuer)).issuer).toBe(false);
  expect(
    (await new VerificationService(env.config, env.chain).verify(id(101)))
      .status,
  ).toBe("VALID");
  const service = new CertificateService(
    env.config,
    new MemoryStore(),
    env.chain,
  );
  await expect(service.revocationIntent(issuer, id(101))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  // The admin has no revocation power: rejected off-chain and by the contract itself.
  await expect(service.revocationIntent(admin, id(101))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  await expect(
    env.chain.prepare({
      kind: "revoke",
      wallet: admin,
      ids: [id(101)],
      digests: [],
    }),
  ).rejects.toThrow("TRANSACTION_WOULD_REVERT");
  expect(
    (await new VerificationService(env.config, env.chain).verify(id(101)))
      .status,
  ).toBe("VALID");
  await mined(
    env.provider,
    await env.contract.getFunction("grantRole")(
      await env.contract.getFunction("ISSUER_ROLE")(),
      issuer,
    ),
  );
  const intent = await service.revocationIntent(issuer, id(101));
  const prepared = await env.chain.prepare(intent);
  const tx = await env.issuer.sendTransaction(prepared);
  await mined(env.provider, tx);
  expect((await env.chain.transaction(tx.hash, intent)).status).toBe(
    "CONFIRMED",
  );
  await expect(
    env.chain.transaction(tx.hash, { ...intent, wallet: admin }),
  ).rejects.toThrow("TRANSACTION_MISMATCH");
  expect(
    (
      await new VerificationService(env.config, env.chain).verify(
        id(101),
        id(1),
      )
    ).status,
  ).toBe("REVOKED");
});
it("indexes real registry events with idempotent replay (in-memory store)", async () => {
  const store = new MemoryStore(),
    indexer = new EventIndexer(env.config, store, env.chain);
  await indexer.tick();
  await indexer.tick();
  const history = await indexer.history(id(101), 0, 25);
  expect(history.events.map((e) => e.name)).toEqual([
    "CertificateIssued",
    "CertificateRevoked",
  ]);
  expect(history.lag).toBe(0);
});
it("starts the actual server with local manifest and keeps verification available when Mongo is offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cert-server-")),
    path = join(directory, "manifest.json");
  const port = await freePort(),
    mongoPort = await freePort();
  await writeFile(path, JSON.stringify(env.config.manifest));
  const variables = Object.fromEntries(
    Object.entries(env.config)
      .filter(([k]) => k !== "manifest")
      .map(([k, v]) => [k, String(v)]),
  );
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...variables,
      PORT: String(port),
      DEPLOYMENT_MANIFEST_PATH: path,
      MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/certificates_test_offline`,
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout?.on("data", (b) => {
    output += String(b);
  });
  child.stderr?.on("data", (b) => {
    output += String(b);
  });
  try {
    let started = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw new Error("Server exited: " + output);
      try {
        started =
          (await fetch(`http://127.0.0.1:${port}/api/v1/health/live`))
            .status === 200;
      } catch {
        /* Wait for bounded initial DB connection failure. */
      }
      if (started) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(started).toBe(true);
    expect(
      (await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).status,
    ).toBe(503);
    const verdict = await (
      await fetch(
        `http://127.0.0.1:${port}/api/v1/certificates/${id(101)}/verification`,
      )
    ).json();
    expect(verdict).toMatchObject({ status: "REVOKED" });
    expect(output).not.toContain(env.config.SESSION_SECRET);
  } finally {
    await stopChild(child);
    await rm(directory, { recursive: true, force: true });
  }
});
