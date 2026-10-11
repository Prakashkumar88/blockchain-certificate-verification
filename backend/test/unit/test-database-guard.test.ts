import { it, expect, vi } from "vitest";
import type { MongoStore } from "../../src/storage/mongo.js";
import {
  dropTestDatabase,
  TEST_DB_PREFIX,
  testDatabaseUri,
} from "../helpers/mongo.js";

it.each([
  "mongodb://127.0.0.1:27017/certificates_local", // developer application database
  "mongodb://127.0.0.1:27017/certificates", // production-style name
  "mongodb://127.0.0.1:27017/", // default database
  "mongodb://db.example.com:27017/certificates_test", // remote host
  "mongodb://10.0.0.5:27017/certificates_test", // non-loopback IP
  "mongodb+srv://cluster.example.net/certificates_test", // SRV / Atlas
  "mongodb://127.0.0.1:27017,127.0.0.1:27018/certificates_test", // multi-host
  "postgres://127.0.0.1/certificates_test",
  "not a uri",
])("rejects unsafe test database URI %s", (uri) => {
  expect(() => testDatabaseUri(uri)).toThrow();
});

it("defaults to loopback and always uses a fresh random test database", () => {
  const a = new URL(testDatabaseUri()),
    b = new URL(
      testDatabaseUri(
        "mongodb://localhost:27017/certificates_test_ci?directConnection=true",
      ),
    );
  expect(a.hostname).toBe("127.0.0.1");
  expect(a.pathname).toMatch(new RegExp(`^/${TEST_DB_PREFIX}[0-9a-f]{16}$`));
  expect(b.pathname).toMatch(new RegExp(`^/${TEST_DB_PREFIX}[0-9a-f]{16}$`));
  expect(b.pathname).not.toBe("/certificates_test_ci");
  expect(b.searchParams.get("directConnection")).toBe("true");
  expect(a.pathname).not.toBe(new URL(testDatabaseUri()).pathname);
});

function fakeStore(name: string) {
  const connection = {
    name,
    dropDatabase: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { store: { connection } as unknown as MongoStore, connection };
}

it("drops and closes only a generated test database", async () => {
  const { store, connection } = fakeStore(TEST_DB_PREFIX + "0123456789abcdef");
  await dropTestDatabase(store);
  expect(connection.dropDatabase).toHaveBeenCalledOnce();
  expect(connection.close).toHaveBeenCalledOnce();
  await expect(dropTestDatabase(undefined)).resolves.toBeUndefined();
});

it.each(["certificates_local", "certificates_test", "certificates_test_ci"])(
  "refuses to drop %s but still closes the connection",
  async (name) => {
    const { store, connection } = fakeStore(name);
    await expect(dropTestDatabase(store)).rejects.toThrow(/Refusing to drop/);
    expect(connection.dropDatabase).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledOnce();
  },
);
