import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createProvider, RegistryChain } from "./services/chain.js";
import { MongoStore } from "./storage/mongo.js";

async function main() {
  const config = loadConfig();
  const provider = createProvider(config),
    chain = new RegistryChain(config, provider);
  const connection = mongoose.createConnection();
  const store = new MongoStore(connection);
  try {
    await connection.openUri(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
      timeoutMS: 5000,
      socketTimeoutMS: 5000,
      bufferCommands: false,
      maxPoolSize: 10,
    });
    await store.initialize();
  } catch {
    console.error(
      "DATABASE_UNAVAILABLE: public verification remains available; restart after initial database connection failure.",
    );
  }
  const app = createApp(config, store, chain, (code) => console.error(code));
  const server = app.listen(config.PORT, config.HOST, () =>
    console.log(`Backend listening on port ${config.PORT}`),
  );
  server.requestTimeout = config.REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(10000, config.REQUEST_TIMEOUT_MS);
  server.setTimeout(config.REQUEST_TIMEOUT_MS, (socket) => socket.destroy());
  const close = () => {
    server.close(() => {
      void connection.close().finally(() => {
        provider.destroy();
      });
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
main().catch(() => {
  console.error(
    "STARTUP_FAILED: check validated configuration and deployment manifest.",
  );
  process.exitCode = 1;
});
