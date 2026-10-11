import type { Config } from "../config/index.js";
import { fail } from "../errors.js";
import type { Chain } from "../services/chain.js";
import type { Store } from "../storage/store.js";
export class EventIndexer {
  private busy = false;
  constructor(
    private config: Config,
    private store: Store,
    private chain: Chain,
  ) {}
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const dep = this.config.manifest.deploymentId,
        start = this.config.manifest.deploymentBlock;
      const head = await this.chain.head();
      const checkpoint = await this.store.one("checkpoints", { key: dep });
      let cursor = checkpoint?.blockNumber ?? start - 1;
      // Walk back across arbitrarily deep reorgs, bounded to 100 blocks per tick.
      let walking = 0;
      while (cursor >= start) {
        const saved = await this.store.one("checkpoints", {
          key: `${dep}:${cursor}`,
        });
        if (
          cursor <= head.number &&
          saved &&
          (await this.chain.block(cursor)).hash === saved.blockHash
        )
          break;
        cursor--;
        walking++;
        if (walking === 100) break;
      }
      if (checkpoint && cursor < checkpoint.blockNumber) {
        // Regress the published checkpoint first so readers never see unverified or orphaned blocks.
        if (cursor >= start) {
          const ancestor = await this.store.one("checkpoints", {
            key: `${dep}:${cursor}`,
          });
          if (ancestor)
            await this.store.upsert(
              "checkpoints",
              { key: dep },
              { ...ancestor, key: dep },
            );
        } else {
          await this.store.remove("checkpoints", { key: dep });
        }
        await this.store.remove("events", {
          deploymentId: dep,
          blockNumber: { $gt: cursor },
        });
        await this.store.remove("checkpoints", {
          deploymentId: dep,
          blockNumber: { $gt: cursor },
        });
        if (walking === 100) return;
      }
      const from = Math.max(
        start,
        cursor - this.config.INDEXER_REORG_OVERLAP + 1,
      );
      const to = Math.min(head.number, from + 99);
      for (let number = from; number <= to; number++) {
        const block = await this.chain.block(number);
        const events = await this.chain.events(number, number);
        if (
          events.some((e) => e.blockHash !== block.hash) ||
          (await this.chain.block(number)).hash !== block.hash
        )
          fail(503, "CHAIN_REORG");
        // Upsert events first so previously published events are not deleted before replacement events are stored.
        for (const event of events)
          await this.store.upsert(
            "events",
            { key: `${dep}:${event.transactionHash}:${event.logIndex}` },
            {
              ...event,
              key: `${dep}:${event.transactionHash}:${event.logIndex}`,
              deploymentId: dep,
            },
          );
        // Prune any stale events for this block that are no longer present on the canonical chain.
        const currentKeys = new Set(
          events.map((e) => `${dep}:${e.transactionHash}:${e.logIndex}`),
        );
        const existing = await this.store.list(
          "events",
          { deploymentId: dep, blockNumber: number },
          { logIndex: 1 },
          1000,
        );
        for (const old of existing) {
          if (!currentKeys.has(old.key)) {
            await this.store.remove("events", { key: old.key });
          }
        }
        const next = {
          key: `${dep}:${number}`,
          deploymentId: dep,
          blockNumber: number,
          blockHash: block.hash,
        };
        await this.store.upsert("checkpoints", { key: next.key }, next);
        // During overlap replay, don't regress the publicly visible checkpoint.
        if (number >= cursor)
          await this.store.upsert(
            "checkpoints",
            { key: dep },
            { ...next, key: dep },
          );
      }
    } finally {
      this.busy = false;
    }
  }
  async history(id: string, cursor: number, limit: number) {
    const dep = this.config.manifest.deploymentId,
      head = await this.chain.head();
    const checkpoint = await this.store.one("checkpoints", { key: dep });
    if (
      !checkpoint ||
      checkpoint.blockNumber > head.number ||
      (await this.chain.block(checkpoint.blockNumber)).hash !==
        checkpoint.blockHash
    )
      fail(503, "HISTORY_UNAVAILABLE");
    const events = await this.store.list(
      "events",
      { deploymentId: dep, id, blockNumber: { $lte: checkpoint.blockNumber } },
      { blockNumber: 1, logIndex: 1 },
      limit,
      cursor,
    );
    // Verify returned block hashes too, including reads concurrent with rollback/replay.
    for (const event of events)
      if ((await this.chain.block(event.blockNumber)).hash !== event.blockHash)
        fail(503, "HISTORY_UNAVAILABLE");
    return {
      events: events.map(
        ({ key: _key, deploymentId: _dep, ...event }) => event,
      ),
      indexedThroughBlock: checkpoint.blockNumber,
      indexedBlockHash: checkpoint.blockHash,
      lag: head.number - checkpoint.blockNumber,
      nextCursor: events.length === limit ? cursor + limit : null,
      authoritative: false,
    };
  }
}
