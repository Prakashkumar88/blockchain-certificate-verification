import { it, expect } from "vitest";
import { EventIndexer } from "../../src/indexer/indexer.js";
import {
  MemoryStore,
  config,
  id,
  mockChain,
  wallet,
} from "../helpers/fixtures.js";
it("replays idempotently, resumes checkpoints and exposes lag", async () => {
  const c = config(),
    store = new MemoryStore(),
    chain = mockChain(),
    indexer = new EventIndexer(c, store, chain);
  chain.events.mockImplementation(async (n) =>
    n === 5
      ? [
          {
            name: "CertificateIssued",
            id: id(1),
            issuer: wallet,
            digest: id(2),
            blockNumber: 5,
            blockHash: id(5),
            transactionHash: id(55),
            logIndex: 0,
          },
        ]
      : [],
  );
  await indexer.tick();
  await indexer.tick();
  expect(store.rows.events).toHaveLength(1);
  expect(await indexer.history(id(1), 0, 25)).toMatchObject({
    indexedThroughBlock: 10,
    lag: 0,
    authoritative: false,
  });
});
it("rolls back reorgs deeper than the overlap, removing orphan events", async () => {
  const c = config();
  c.INDEXER_REORG_OVERLAP = 2;
  const store = new MemoryStore(),
    chain = mockChain(),
    indexer = new EventIndexer(c, store, chain);
  chain.events.mockImplementation(async (n) =>
    n === 5
      ? [
          {
            name: "CertificateIssued",
            id: id(1),
            issuer: wallet,
            digest: id(2),
            blockNumber: 5,
            blockHash: id(5),
            transactionHash: id(55),
            logIndex: 0,
          },
        ]
      : [],
  );
  await indexer.tick();
  chain.block.mockImplementation(async (n) => ({
    number: n,
    hash: id(n >= 4 ? n + 100 : n),
    timestamp: 1000,
  }));
  await expect(indexer.history(id(1), 0, 25)).rejects.toThrow(
    "HISTORY_UNAVAILABLE",
  );
  chain.events.mockResolvedValue([]);
  await indexer.tick();
  expect(store.rows.events).toHaveLength(0);
  expect(await indexer.history(id(1), 0, 25)).toMatchObject({
    events: [],
    indexedThroughBlock: 10,
  });
});
it("leaves no checkpoint for an unverified RPC range", async () => {
  const c = config(),
    store = new MemoryStore(),
    chain = mockChain(),
    indexer = new EventIndexer(c, store, chain);
  chain.events.mockRejectedValue(new Error("offline"));
  await expect(indexer.tick()).rejects.toThrow("offline");
  expect(store.rows.checkpoints).toHaveLength(0);
});

it("preserves published history and avoids false zero lag when storage fails during overlap replay", async () => {
  const c = config();
  c.INDEXER_REORG_OVERLAP = 6;
  const store = new MemoryStore(),
    chain = mockChain(),
    indexer = new EventIndexer(c, store, chain);

  chain.events.mockImplementation(async (n) =>
    n === 5
      ? [
          {
            name: "CertificateIssued",
            id: id(1),
            issuer: wallet,
            digest: id(2),
            blockNumber: 5,
            blockHash: id(5),
            transactionHash: id(55),
            logIndex: 0,
          },
        ]
      : [],
  );

  // Initial tick: safely indexes blocks 1..10
  await indexer.tick();
  expect(store.rows.events).toHaveLength(1);
  const initial = await indexer.history(id(1), 0, 25);
  expect(initial).toMatchObject({
    events: [{ id: id(1), blockNumber: 5 }],
    indexedThroughBlock: 10,
    lag: 0,
  });

  // Advance chain head to 11
  chain.head.mockResolvedValue({ number: 11, hash: id(11), timestamp: 1000 });
  chain.block.mockImplementation(async (n) => ({
    number: n,
    hash: id(n),
    timestamp: 1000,
  }));

  // Inject storage failure during overlap replay (when upserting events)
  const origUpsert = store.upsert.bind(store);
  let failUpsert = true;
  store.upsert = async (table, filter, patch) => {
    if (failUpsert && table === "events") {
      throw new Error("STORAGE_FAILURE_DURING_REPLAY");
    }
    return origUpsert(table, filter, patch);
  };

  await expect(indexer.tick()).rejects.toThrow("STORAGE_FAILURE_DURING_REPLAY");

  // Previously published history remains readable and complete; events were not prematurely removed
  const duringFailure = await indexer.history(id(1), 0, 25);
  expect(duringFailure.events).toHaveLength(1);
  expect(duringFailure.events[0]).toMatchObject({
    id: id(1),
    blockNumber: 5,
  });

  // Checkpoint was not incorrectly advanced to 11
  expect(duringFailure.indexedThroughBlock).toBe(10);

  // Lag reporting accurately reflects that the indexer is behind head (11 - 10 = 1), not zero lag
  expect(duringFailure.lag).toBe(1);

  // Restore storage: subsequent retry succeeds idempotently without duplicate events
  failUpsert = false;
  await indexer.tick();

  expect(store.rows.events).toHaveLength(1);
  const recovered = await indexer.history(id(1), 0, 25);
  expect(recovered).toMatchObject({
    events: [{ id: id(1), blockNumber: 5 }],
    indexedThroughBlock: 11,
    lag: 0,
  });
});

it("regresses checkpoint and reports non-zero lag if storage fails during reorg replay", async () => {
  const c = config();
  c.INDEXER_REORG_OVERLAP = 2;
  const store = new MemoryStore(),
    chain = mockChain(),
    indexer = new EventIndexer(c, store, chain);

  chain.events.mockImplementation(async (n) =>
    n === 5
      ? [
          {
            name: "CertificateIssued",
            id: id(1),
            issuer: wallet,
            digest: id(2),
            blockNumber: 5,
            blockHash: id(5),
            transactionHash: id(55),
            logIndex: 0,
          },
        ]
      : [],
  );

  await indexer.tick();
  expect(store.rows.events).toHaveLength(1);

  // Reorg blocks 5..10 on chain
  chain.block.mockImplementation(async (n) => ({
    number: n,
    hash: id(n >= 5 ? n + 100 : n),
    timestamp: 1000,
  }));
  chain.events.mockImplementation(async (n) =>
    n === 5
      ? [
          {
            name: "CertificateIssued",
            id: id(1),
            issuer: wallet,
            digest: id(2),
            blockNumber: 5,
            blockHash: id(105),
            transactionHash: id(155),
            logIndex: 0,
          },
        ]
      : [],
  );

  // Inject failure when persisting replacement events on new fork
  const origUpsert = store.upsert.bind(store);
  let failUpsert = true;
  store.upsert = async (table, filter, patch) => {
    if (failUpsert && table === "events") {
      throw new Error("STORAGE_FAILURE_ON_REORG");
    }
    return origUpsert(table, filter, patch);
  };

  await expect(indexer.tick()).rejects.toThrow("STORAGE_FAILURE_ON_REORG");

  // Published checkpoint was regressed to common ancestor (block 4)
  const checkpoint = await store.one("checkpoints", {
    key: c.manifest.deploymentId,
  });
  expect(checkpoint?.blockNumber).toBe(4);

  // History query reports regressed block height with lag 6 (10 - 4), not 0
  const historyDuringFailure = await indexer.history(id(1), 0, 25);
  expect(historyDuringFailure.indexedThroughBlock).toBe(4);
  expect(historyDuringFailure.lag).toBe(6);

  // Restore storage and complete reorg replay
  failUpsert = false;
  chain.events.mockResolvedValue([]);
  await indexer.tick();

  expect(store.rows.events).toHaveLength(0);
  const recovered = await indexer.history(id(1), 0, 25);
  expect(recovered.indexedThroughBlock).toBe(10);
  expect(recovered.lag).toBe(0);
});

