import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { connectStore, type MongoStore } from "../../src/storage/mongo.js";
import { AuthService } from "../../src/services/auth.js";
import { config, id, mockChain, wallet } from "../helpers/fixtures.js";
import { dropTestDatabase, testDatabaseUri } from "../helpers/mongo.js";
import { Wallet } from "ethers";
const uri = process.env.TEST_MONGODB_URI;
// Explicit opt-in; absence is SKIPPED, never represented as a successful integration check.
describe.skipIf(!uri)("real MongoDB atomicity and indexes", () => {
  let store: MongoStore;
  beforeAll(async () => {
    store = await connectStore(testDatabaseUri(uri));
  });
  afterAll(async () => {
    await dropTestDatabase(store);
  });
  it("enforces unique metadata and idempotent upserts", async () => {
    const dep = config().manifest.deploymentId,
      doc = {
        key: dep + ":" + id(1),
        deploymentId: dep,
        certificateId: id(1),
        issuer: wallet,
        documentHash: id(2),
        updatedAt: new Date(),
      };
    await store.insert("metadata", doc);
    await expect(store.insert("metadata", doc)).rejects.toThrow(
      "DUPLICATE_METADATA",
    );
    await store.upsert("metadata", { key: doc.key }, doc);
    expect(
      await store.list("metadata", { key: doc.key }, { key: 1 }, 10),
    ).toHaveLength(1);
  });
  it("atomically consumes SIWE challenges during concurrent verification", async () => {
    const c = config(),
      auth = new AuthService(c, store, mockChain()),
      signer = Wallet.createRandom(),
      pre = await auth.create(),
      challenge = await auth.challenge(
        pre.session,
        signer.address.toLowerCase(),
      ),
      signature = await signer.signMessage(challenge.message);
    const results = await Promise.allSettled([
      auth.verify(pre.session, challenge.message, signature),
      auth.verify(pre.session, challenge.message, signature),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("checks expiry independently of TTL cleanup and rejects unknown fields", async () => {
    const c = config(),
      auth = new AuthService(c, store, mockChain()),
      session = await auth.create();
    await store.upsert(
      "sessions",
      { key: session.session.key },
      { expiresAt: new Date(0) },
    );
    expect(await auth.session(session.raw)).toBeNull();
    await expect(
      store.upsert(
        "metadata",
        { key: "invalid" },
        { displayLabel: "a".repeat(121) },
      ),
    ).rejects.toThrow();
  });
});
