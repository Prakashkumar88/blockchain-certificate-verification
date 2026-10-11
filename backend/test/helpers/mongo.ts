import { randomBytes } from "node:crypto";
import type { MongoStore } from "../../src/storage/mongo.js";

// Integration tests may only touch throwaway databases on a loopback server, never a
// developer's application database (e.g. certificates_local) or a remote cluster.
export const TEST_DB_PREFIX = "certificates_test_";
export const DEFAULT_TEST_MONGODB_URI =
  "mongodb://127.0.0.1:27017/certificates_test";
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

export function testDatabaseUri(raw = DEFAULT_TEST_MONGODB_URI) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_MONGODB_URI is not a valid single-host MongoDB URI");
  }
  if (
    url.protocol !== "mongodb:" ||
    !LOOPBACK.includes(url.hostname) ||
    !/^\/certificates_test(?:_[a-zA-Z0-9]+)?$/.test(url.pathname)
  )
    throw new Error(
      "Only a loopback mongodb://…/certificates_test database is allowed for tests",
    );
  // Each suite gets its own random database; the configured name is never used directly.
  url.pathname = "/" + TEST_DB_PREFIX + randomBytes(8).toString("hex");
  return url.toString();
}

export async function dropTestDatabase(store: MongoStore | undefined) {
  if (!store) return;
  try {
    const name = store.connection.name;
    if (!new RegExp(`^${TEST_DB_PREFIX}[0-9a-f]{16}$`).test(name))
      throw new Error(`Refusing to drop non-test database "${name}"`);
    await store.connection.dropDatabase();
  } finally {
    await store.connection.close();
  }
}
