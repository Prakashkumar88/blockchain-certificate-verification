import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import type { Config, Manifest } from "../../src/config/index.js";
import { abiHash, deploymentId } from "../../src/config/index.js";
import { ApiError } from "../../src/errors.js";
import type {
  Documents,
  Filter,
  Store,
  Table,
} from "../../src/storage/store.js";
import type { Chain, Certificate } from "../../src/services/chain.js";
export const id = (n: number) => "0x" + n.toString(16).padStart(64, "0");
export const wallet = "0x" + "12".repeat(20),
  other = "0x" + "34".repeat(20);
export function config(): Config {
  const partial = {
    chainId: 31337,
    contractAddress: "0x" + "ab".repeat(20),
    deploymentTransactionHash: id(90),
    deploymentBlock: 1,
    deploymentBlockHash: id(91),
    runtimeCodeHash: id(92),
    abiHash,
  };
  const manifest: Manifest = {
    ...partial,
    deploymentId: deploymentId(partial),
  };
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3001,
    APP_ORIGIN: "http://localhost:5173",
    SIWE_DOMAIN: "localhost:5173",
    SIWE_URI: "http://localhost:5173",
    MONGODB_URI: "mongodb://127.0.0.1:27017/certificates_test",
    RPC_URL: "http://127.0.0.1:8545",
    CHAIN_ID: 31337,
    DEPLOYMENT_MANIFEST_PATH: "unused",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    COOKIE_SECURE: false,
    TRUST_PROXY_HOPS: 0,
    MIN_ISSUANCE_CONFIRMATIONS: 1,
    RPC_TIMEOUT_MS: 1000,
    MAX_HEAD_AGE_SECONDS: 0,
    SESSION_TTL_SECONDS: 28800,
    SIWE_NONCE_TTL_SECONDS: 300,
    MAX_PDF_BYTES: 10485760,
    REQUEST_TIMEOUT_MS: 30000,
    MAX_CONCURRENT_UPLOADS: 4,
    AUTH_RATE_PER_MIN: 1000,
    UPLOAD_RATE_PER_MIN: 1000,
    READ_RATE_PER_MIN: 1000,
    DRAFT_TTL_SECONDS: 86400,
    INDEXER_POLL_MS: 3000,
    INDEXER_REORG_OVERLAP: 12,
    manifest,
  };
}
function matches(doc: object, filter: Filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = (doc as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !(value instanceof Date))
      return Object.entries(value).every(([op, expected]) => {
        const a =
          actual instanceof Date ? actual.getTime() : (actual as number);
        const b =
          expected instanceof Date ? expected.getTime() : (expected as number);
        return op === "$gt"
          ? a > b
          : op === "$gte"
            ? a >= b
            : op === "$lte"
              ? a <= b
              : op === "$lt"
                ? a < b
                : op === "$in"
                  ? (expected as unknown[]).includes(actual)
                  : false;
      });
    return actual === value;
  });
}
export class MemoryStore implements Store {
  rows: Record<Table, object[]> = {
    sessions: [],
    challenges: [],
    drafts: [],
    metadata: [],
    transactions: [],
    events: [],
    checkpoints: [],
    profiles: [],
  };
  available = true;
  failMetadata = false;
  private check(table?: Table) {
    if (!this.available || (this.failMetadata && table === "metadata"))
      throw new ApiError(503, "DATABASE_UNAVAILABLE");
  }
  async ready() {
    return this.available;
  }
  async insert<K extends Table>(table: K, doc: Documents[K]) {
    this.check(table);
    if (this.rows[table].some((v) => (v as { key: string }).key === doc.key))
      throw new ApiError(409, "DUPLICATE_METADATA");
    this.rows[table].push(structuredClone(doc));
  }
  async one<K extends Table>(table: K, filter: Filter) {
    this.check(table);
    return structuredClone(
      this.rows[table].find((d) => matches(d, filter)) ?? null,
    ) as Documents[K] | null;
  }
  async take<K extends Table>(table: K, filter: Filter) {
    this.check(table);
    const i = this.rows[table].findIndex((d) => matches(d, filter));
    return (i < 0 ? null : this.rows[table].splice(i, 1)[0]) as
      Documents[K] | null;
  }
  async list<K extends Table>(
    table: K,
    filter: Filter,
    sort: Record<string, 1 | -1>,
    limit: number,
    skip = 0,
  ) {
    this.check(table);
    const rows = this.rows[table].filter((d) => matches(d, filter));
    rows.sort((a, b) => {
      for (const [k, order] of Object.entries(sort)) {
        const av = (a as Record<string, number | string>)[k]!,
          bv = (b as Record<string, number | string>)[k]!;
        if (av !== bv) return (av < bv ? -1 : 1) * order;
      }
      return 0;
    });
    return structuredClone(rows.slice(skip, skip + limit)) as Documents[K][];
  }
  async upsert<K extends Table>(
    table: K,
    filter: Filter,
    patch: Partial<Documents[K]>,
  ) {
    this.check(table);
    const current = this.rows[table].find((d) => matches(d, filter));
    if (current) Object.assign(current, structuredClone(patch));
    else this.rows[table].push({ ...filter, ...structuredClone(patch) });
  }
  async remove(table: Table, filter: Filter) {
    this.check(table);
    this.rows[table] = this.rows[table].filter((d) => !matches(d, filter));
  }
}
export function record(overrides: Partial<Certificate> = {}): Certificate {
  return {
    documentHash: id(2),
    issuer: wallet,
    issuedAt: 1000,
    issuedBlock: 5,
    revokedAt: 0,
    revoked: false,
    ...overrides,
  };
}
export function mockChain() {
  return {
    inspect: vi.fn<Chain["inspect"]>().mockResolvedValue({
      exists: false,
      record: record(),
      block: { number: 10, hash: id(10), timestamp: 1000 },
    }),
    roles: vi
      .fn<Chain["roles"]>()
      .mockResolvedValue({ issuer: true, admin: false }),
    maxBatch: vi.fn<Chain["maxBatch"]>().mockResolvedValue(50),
    isEoa: vi.fn<Chain["isEoa"]>().mockResolvedValue(true),
    prepare: vi.fn<Chain["prepare"]>().mockResolvedValue({
      to: "0x" + "ab".repeat(20),
      data: "0x1234",
      from: wallet,
      chainId: 31337,
      value: "0x0",
    }),
    transaction: vi
      .fn<Chain["transaction"]>()
      .mockResolvedValue({ transactionHash: id(99), status: "PENDING" }),
    head: vi
      .fn<Chain["head"]>()
      .mockResolvedValue({ number: 10, hash: id(10), timestamp: 1000 }),
    block: vi.fn<Chain["block"]>().mockImplementation(async (n) => ({
      number: n,
      hash: id(n),
      timestamp: 1000,
    })),
    events: vi.fn<Chain["events"]>().mockResolvedValue([]),
  };
}
export const pdf = Buffer.from("%PDF-1.4\n% synthetic byte fixture\n%%EOF\n");
