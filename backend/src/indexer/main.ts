import { loadConfig } from "../config/index.js";
import { connectStore } from "../storage/mongo.js";
import { createProvider, RegistryChain } from "../services/chain.js";
import { EventIndexer } from "./indexer.js";
async function main() {
  const config = loadConfig(),
    store = await connectStore(config.MONGODB_URI),
    provider = createProvider(config),
    indexer = new EventIndexer(
      config,
      store,
      new RegistryChain(config, provider),
    );
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopped) {
      try {
        await indexer.tick();
      } catch {
        console.error(
          "INDEXER_UNAVAILABLE: retrying without advancing unverified state.",
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, config.INDEXER_POLL_MS),
      );
    }
  } finally {
    await store.connection.close();
    provider.destroy();
  }
}
main().catch(() => {
  console.error("INDEXER_STARTUP_FAILED");
  process.exitCode = 1;
});
