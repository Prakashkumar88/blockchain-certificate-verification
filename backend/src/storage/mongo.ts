import mongoose, { Schema, type Connection, type Model } from "mongoose";
import { ApiError } from "../errors.js";
import type { Documents, Filter, Store, Table } from "./store.js";
const requiredString = { type: String, required: true };
const hex32 = { ...requiredString, match: /^0x[0-9a-f]{64}$/ };
const wallet = { ...requiredString, match: /^0x[0-9a-f]{40}$/ };
const base = { key: requiredString, deploymentId: hex32 };
const date = { type: Date, required: true };
export function modelsFor(connection: Connection) {
  const definitions = {
    sessions: new Schema({ ...base, wallet, expiresAt: date }),
    challenges: new Schema({
      ...base,
      sessionKey: requiredString,
      wallet,
      message: requiredString,
      expiresAt: date,
    }),
    drafts: new Schema({
      ...base,
      owner: wallet,
      certificateId: hex32,
      documentHash: hex32,
      createdAt: date,
      expiresAt: date,
    }),
    metadata: new Schema({
      ...base,
      certificateId: hex32,
      issuer: wallet,
      documentHash: hex32,
      issuanceTransactionHash: String,
      revocationTransactionHash: String,
      displayLabel: { type: String, maxlength: 120 },
      updatedAt: date,
    }),
    transactions: new Schema({
      ...base,
      owner: wallet,
      intent: {
        type: new Schema(
          {
            kind: {
              type: String,
              enum: ["issue", "batch", "revoke"],
              required: true,
            },
            wallet,
            ids: { type: [String], required: true },
            digests: { type: [String], required: true },
          },
          { _id: false },
        ),
        required: true,
      },
      transactionHash: hex32,
      result: { type: Schema.Types.Mixed, required: true },
      updatedAt: date,
    }),
    events: new Schema({
      ...base,
      name: requiredString,
      id: String,
      issuer: String,
      digest: String,
      actor: String,
      role: String,
      account: String,
      blockNumber: { type: Number, required: true },
      blockHash: hex32,
      transactionHash: hex32,
      logIndex: { type: Number, required: true },
    }),
    checkpoints: new Schema({
      ...base,
      blockNumber: { type: Number, required: true },
      blockHash: hex32,
    }),
    profiles: new Schema({
      ...base,
      wallet,
      institutionName: { ...requiredString, maxlength: 120 },
      updatedAt: date,
    }),
  };
  definitions.sessions.path("wallet").required(false);
  for (const [name, schema] of Object.entries(definitions)) {
    schema.set("bufferCommands", false);
    schema.set("strict", "throw");
    schema.set("versionKey", false);
    schema.index({ key: 1 }, { unique: true });
    if (["sessions", "challenges", "drafts"].includes(name))
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  definitions.metadata.index(
    { deploymentId: 1, certificateId: 1 },
    { unique: true },
  );
  definitions.drafts.index({ deploymentId: 1, owner: 1, createdAt: -1 });
  definitions.events.index(
    { deploymentId: 1, transactionHash: 1, logIndex: 1 },
    { unique: true },
  );
  definitions.events.index({
    deploymentId: 1,
    id: 1,
    blockNumber: 1,
    logIndex: 1,
  });
  definitions.profiles.index({ deploymentId: 1, wallet: 1 }, { unique: true });
  return Object.fromEntries(
    Object.entries(definitions).map(([name, schema]) => [
      name,
      connection.model(name, schema),
    ]),
  ) as unknown as Record<Table, Model<unknown>>;
}
export class MongoStore implements Store {
  readonly models: ReturnType<typeof modelsFor>;
  private initialized = false;
  constructor(readonly connection: Connection) {
    this.models = modelsFor(connection);
  }
  async initialize() {
    await Promise.all(Object.values(this.models).map((m) => m.init()));
    this.initialized = true;
  }
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      if (!this.initialized) throw new ApiError(503, "DATABASE_UNAVAILABLE");
      return await fn();
    } catch (e) {
      if ((e as { code?: number })?.code === 11000)
        throw new ApiError(409, "DUPLICATE_METADATA");
      throw new ApiError(503, "DATABASE_UNAVAILABLE");
    }
  }
  async ready() {
    try {
      if (!this.initialized || this.connection.readyState !== 1) return false;
      await this.connection.db!.command({ ping: 1 }, { timeoutMS: 2000 });
      return true;
    } catch {
      return false;
    }
  }
  async insert<K extends Table>(table: K, doc: Documents[K]) {
    await this.guard(async () => {
      await this.models[table].create(doc);
    });
  }
  async one<K extends Table>(table: K, filter: Filter) {
    return this.guard(
      async () =>
        (await this.models[table]
          .findOne(filter)
          .select("-_id")
          .lean()
          .exec()) as Documents[K] | null,
    );
  }
  async take<K extends Table>(table: K, filter: Filter) {
    return this.guard(
      async () =>
        (await this.models[table]
          .findOneAndDelete(filter)
          .select("-_id")
          .lean()
          .exec()) as Documents[K] | null,
    );
  }
  async list<K extends Table>(
    table: K,
    filter: Filter,
    sort: Record<string, 1 | -1>,
    limit: number,
    skip = 0,
  ) {
    return this.guard(
      async () =>
        (await this.models[table]
          .find(filter)
          .select("-_id")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec()) as unknown as Documents[K][],
    );
  }
  async upsert<K extends Table>(
    table: K,
    filter: Filter,
    patch: Partial<Documents[K]>,
  ) {
    await this.guard(async () => {
      await this.models[table]
        .updateOne(
          filter,
          { $set: patch },
          { upsert: true, runValidators: true },
        )
        .exec();
    });
  }
  async remove(table: Table, filter: Filter) {
    await this.guard(async () => {
      await this.models[table].deleteMany(filter).exec();
    });
  }
}
export async function connectStore(uri: string) {
  const connection = mongoose.createConnection();
  const store = new MongoStore(connection);
  await connection.openUri(uri, {
    serverSelectionTimeoutMS: 2000,
    connectTimeoutMS: 2000,
    socketTimeoutMS: 5000,
    timeoutMS: 5000,
    maxPoolSize: 10,
    bufferCommands: false,
  });
  await store.initialize();
  return store;
}
