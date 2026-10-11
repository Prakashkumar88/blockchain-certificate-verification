import {
  FetchRequest,
  Interface,
  JsonRpcProvider,
  ZeroHash,
  keccak256,
  id as ethersId,
} from "ethers";
import { z } from "zod";
import abi from "../contracts/CertificateRegistry.json" with { type: "json" };
import type { Config } from "../config/index.js";
import { ApiError, chainError, fail } from "../errors.js";

export const registryInterface = new Interface(abi);
export const ISSUER_ROLE = ethersId("ISSUER_ROLE");
export interface Rpc {
  send(method: string, params: unknown[]): Promise<unknown>;
}
export interface Block {
  number: number;
  hash: string;
  timestamp: number;
}
export interface Certificate {
  documentHash: string;
  issuer: string;
  issuedAt: number;
  issuedBlock: number;
  revokedAt: number;
  revoked: boolean;
}
export interface RecordRead {
  exists: boolean;
  record: Certificate;
}
export type Verdict = "UNKNOWN" | "VALID" | "MODIFIED" | "REVOKED";
export const SOLIDITY_STATUS: Readonly<Record<number, Verdict>> = {
  0: "UNKNOWN",
  1: "VALID",
  2: "MODIFIED",
  3: "REVOKED",
};
export interface ChainSnapshot extends RecordRead {
  block: Block;
  comparison?: Verdict;
}
export interface Intent {
  kind: "issue" | "batch" | "revoke";
  wallet: string;
  ids: string[];
  digests: string[];
}
export interface ChainEvent {
  name: string;
  id?: string;
  issuer?: string;
  digest?: string;
  actor?: string;
  role?: string;
  account?: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}
export interface TxResult {
  transactionHash: string;
  status:
    | "PENDING"
    | "UNRESOLVED"
    | "REVERTED"
    | "CONFIRMATION_PENDING"
    | "CONFIRMED";
  reason?: string;
  blockNumber?: number;
  blockHash?: string;
  confirmations?: number;
  events?: ChainEvent[];
}
export interface Chain {
  inspect(id: string, digest?: string): Promise<ChainSnapshot>;
  roles(wallet: string): Promise<{ issuer: boolean; admin: boolean }>;
  maxBatch(): Promise<number>;
  isEoa(wallet: string): Promise<boolean>;
  prepare(intent: Intent): Promise<{
    to: string;
    data: string;
    chainId: number;
    value: string;
    from: string;
  }>;
  transaction(hash: string, intent: Intent): Promise<TxResult>;
  head(): Promise<Block>;
  block(number: number): Promise<Block>;
  events(from: number, to: number): Promise<ChainEvent[]>;
}
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const rawBlock = z.object({ number: hex, hash: hex, timestamp: hex });
const rawTx = z.object({
  hash: hex,
  from: hex,
  to: hex.nullable(),
  input: hex,
  blockNumber: hex.nullable(),
});
const rawLog = z.object({
  address: hex,
  topics: z.array(hex),
  data: hex,
  blockNumber: hex,
  blockHash: hex,
  transactionHash: hex,
  logIndex: hex,
  removed: z.boolean().optional(),
});
const rawReceipt = z.object({
  transactionHash: hex,
  to: hex.nullable(),
  from: hex,
  status: hex,
  blockNumber: hex,
  blockHash: hex,
  logs: z.array(rawLog),
});
function integer(v: unknown): number {
  const n = Number(BigInt(String(v)));
  if (!Number.isSafeInteger(n) || n < 0) fail(503, "CONTRACT_CALL_FAILED");
  return n;
}
const tag = (n: number) => "0x" + n.toString(16);
const same = (a: string | null, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
export function createProvider(config: Config) {
  const req = new FetchRequest(config.RPC_URL);
  req.timeout = config.RPC_TIMEOUT_MS;
  return new JsonRpcProvider(req, undefined, {
    cacheTimeout: -1,
    batchMaxCount: 1,
  });
}
export class RegistryChain implements Chain {
  constructor(
    readonly config: Config,
    readonly rpc: Rpc,
  ) {}
  private async send(method: string, params: unknown[]) {
    try {
      return await this.rpc.send(method, params);
    } catch (e) {
      const normalized = chainError(e);
      const raw = (e as { data?: unknown })?.data;
      let name: string | undefined;
      if (typeof raw === "string") {
        try {
          name = registryInterface.parseError(raw)?.name;
        } catch {
          /* Invalid error data is never exposed. */
        }
      }
      throw new ApiError(normalized.status, normalized.code, name);
    }
  }
  async block(number: number): Promise<Block> {
    return this.readBlock(tag(number));
  }
  private async readBlock(blockTag: string): Promise<Block> {
    const parsed = rawBlock.safeParse(
      await this.send("eth_getBlockByNumber", [blockTag, false]),
    );
    if (!parsed.success) fail(503, "RPC_UNAVAILABLE");
    return {
      number: integer(parsed.data.number),
      hash: parsed.data.hash.toLowerCase(),
      timestamp: integer(parsed.data.timestamp),
    };
  }
  async head(): Promise<Block> {
    if (integer(await this.send("eth_chainId", [])) !== this.config.CHAIN_ID)
      fail(503, "WRONG_CHAIN");
    const block = await this.readBlock("latest");
    if (
      this.config.MAX_HEAD_AGE_SECONDS > 0 &&
      (Date.now() / 1000 - block.timestamp > this.config.MAX_HEAD_AGE_SECONDS ||
        block.timestamp > Date.now() / 1000 + 60)
    )
      fail(503, "STALE_HEAD");
    const deployment = await this.block(this.config.manifest.deploymentBlock);
    if (deployment.hash !== this.config.manifest.deploymentBlockHash)
      fail(503, "DEPLOYMENT_MISMATCH");
    const code = await this.send("eth_getCode", [
      this.config.manifest.contractAddress,
      tag(block.number),
    ]);
    if (
      typeof code !== "string" ||
      code === "0x" ||
      keccak256(code) !== this.config.manifest.runtimeCodeHash
    )
      fail(503, "CONTRACT_CODE_MISMATCH");
    return block;
  }
  private async snapshot<T>(read: (block: Block) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const head = await this.head();
        const result = await read(head);
        if ((await this.block(head.number)).hash === head.hash) return result;
      } catch (error) {
        if (!(
          error instanceof ApiError &&
          error.code === "CHAIN_REORG" &&
          attempt === 0
        ))
          throw error;
      }
    }
    return fail(503, "CHAIN_REORG");
  }
  private async call(
    name: string,
    args: unknown[],
    block: number,
    from?: string,
  ) {
    try {
      const data = registryInterface.encodeFunctionData(name, args);
      const raw = await this.send("eth_call", [
        {
          to: this.config.manifest.contractAddress,
          data,
          ...(from ? { from } : {}),
        },
        tag(block),
      ]);
      if (typeof raw !== "string") fail(503, "CONTRACT_CALL_FAILED");
      return registryInterface.decodeFunctionResult(name, raw);
    } catch (e) {
      throw chainError(e);
    }
  }
  private async readRecord(id: string, block: number): Promise<RecordRead> {
    const result = await this.call("getCertificate", [id], block);
    const r = result[1];
    return {
      exists: Boolean(result[0]),
      record: {
        documentHash: String(r[0]).toLowerCase(),
        issuer: String(r[1]).toLowerCase(),
        issuedAt: integer(r[2]),
        issuedBlock: integer(r[3]),
        revokedAt: integer(r[4]),
        revoked: Boolean(r[5]),
      },
    };
  }
  async inspect(id: string, digest?: string): Promise<ChainSnapshot> {
    return this.snapshot(async (block) => {
      const record = await this.readRecord(id, block.number);
      let comparison: Verdict | undefined;
      if (digest) {
        comparison =
          SOLIDITY_STATUS[
            integer(
              (
                await this.call("verifyCertificate", [id, digest], block.number)
              )[0],
            )
          ];
        const expected = !record.exists
          ? "UNKNOWN"
          : record.record.revoked
            ? "REVOKED"
            : record.record.documentHash === digest
              ? "VALID"
              : "MODIFIED";
        if (!comparison || comparison !== expected)
          fail(503, "CONTRACT_CALL_FAILED");
      }
      return { ...record, block, comparison };
    });
  }
  async roles(wallet: string) {
    return this.snapshot(async (b) => ({
      issuer: Boolean(
        (await this.call("hasRole", [ISSUER_ROLE, wallet], b.number))[0],
      ),
      admin: Boolean(
        (await this.call("hasRole", [ZeroHash, wallet], b.number))[0],
      ),
    }));
  }
  async maxBatch() {
    return this.snapshot(async (b) =>
      integer((await this.call("MAX_BATCH_SIZE", [], b.number))[0]),
    );
  }
  async isEoa(wallet: string) {
    return this.snapshot(
      async (b) =>
        (await this.send("eth_getCode", [wallet, tag(b.number)])) === "0x",
    );
  }
  data(intent: Intent) {
    if (intent.kind === "revoke")
      return registryInterface.encodeFunctionData("revokeCertificate", [
        intent.ids[0],
      ]);
    if (intent.kind === "issue")
      return registryInterface.encodeFunctionData("issueCertificate", [
        intent.ids[0],
        intent.digests[0],
      ]);
    return registryInterface.encodeFunctionData("issueBatch", [
      intent.ids,
      intent.digests,
    ]);
  }
  async prepare(intent: Intent) {
    const data = this.data(intent);
    await this.snapshot(async (b) => {
      try {
        await this.send("eth_call", [
          {
            to: this.config.manifest.contractAddress,
            from: intent.wallet,
            data,
          },
          tag(b.number),
        ]);
      } catch (e) {
        if (e instanceof ApiError && e.code === "CONTRACT_CALL_FAILED")
          throw new ApiError(409, "TRANSACTION_WOULD_REVERT", e.contractError);
        throw e;
      }
    });
    return {
      to: this.config.manifest.contractAddress,
      from: intent.wallet,
      data,
      chainId: this.config.CHAIN_ID,
      value: "0x0",
    };
  }
  private parseLogs(logs: z.infer<typeof rawLog>[]): ChainEvent[] {
    const events: ChainEvent[] = [];
    for (const log of logs) {
      if (!same(log.address, this.config.manifest.contractAddress)) continue;
      if (log.removed) fail(503, "CHAIN_REORG");
      const parsed = registryInterface.parseLog(log);
      if (!parsed) continue;
      const event: ChainEvent = {
        name: parsed.name,
        blockNumber: integer(log.blockNumber),
        blockHash: log.blockHash.toLowerCase(),
        transactionHash: log.transactionHash.toLowerCase(),
        logIndex: integer(log.logIndex),
      };
      if (parsed.name === "CertificateIssued")
        Object.assign(event, {
          id: String(parsed.args[0]).toLowerCase(),
          issuer: String(parsed.args[1]).toLowerCase(),
          digest: String(parsed.args[2]).toLowerCase(),
        });
      if (parsed.name === "CertificateRevoked")
        Object.assign(event, {
          id: String(parsed.args[0]).toLowerCase(),
          issuer: String(parsed.args[1]).toLowerCase(),
          actor: String(parsed.args[2]).toLowerCase(),
        });
      if (["RoleGranted", "RoleRevoked"].includes(parsed.name))
        Object.assign(event, {
          role: String(parsed.args[0]).toLowerCase(),
          account: String(parsed.args[1]).toLowerCase(),
          actor: String(parsed.args[2]).toLowerCase(),
        });
      events.push(event);
    }
    return events;
  }
  async transaction(hash: string, intent: Intent): Promise<TxResult> {
    return this.snapshot(async (head) => {
      const txRaw = await this.send("eth_getTransactionByHash", [hash]);
      const receiptRaw = await this.send("eth_getTransactionReceipt", [hash]);
      if (txRaw === null && receiptRaw === null)
        return {
          transactionHash: hash,
          status: "UNRESOLVED",
          reason: "NOT_FOUND_OR_DROPPED",
        };
      const tx = rawTx.safeParse(txRaw);
      if (!tx.success) fail(503, "RPC_UNAVAILABLE");
      if (
        !same(tx.data.hash, hash) ||
        !same(tx.data.from, intent.wallet) ||
        !same(tx.data.to, this.config.manifest.contractAddress) ||
        !same(tx.data.input, this.data(intent))
      )
        fail(409, "TRANSACTION_MISMATCH");
      if (receiptRaw === null)
        return {
          transactionHash: hash,
          status: tx.data.blockNumber === null ? "PENDING" : "UNRESOLVED",
          reason:
            tx.data.blockNumber === null ? undefined : "RECEIPT_UNAVAILABLE",
        };
      const receipt = rawReceipt.safeParse(receiptRaw);
      if (!receipt.success) fail(503, "RPC_UNAVAILABLE");
      const r = receipt.data;
      if (
        !same(r.transactionHash, hash) ||
        !same(r.from, intent.wallet) ||
        !same(r.to, this.config.manifest.contractAddress)
      )
        fail(409, "TRANSACTION_MISMATCH");
      const blockNumber = integer(r.blockNumber);
      if (
        blockNumber > head.number ||
        (await this.block(blockNumber)).hash !== r.blockHash.toLowerCase()
      )
        fail(503, "CHAIN_REORG");
      const confirmations = head.number - blockNumber + 1;
      const base = {
        transactionHash: hash,
        blockNumber,
        blockHash: r.blockHash.toLowerCase(),
        confirmations,
      };
      if (integer(r.status) === 0) return { ...base, status: "REVERTED" };
      if (integer(r.status) !== 1) fail(503, "RPC_UNAVAILABLE");
      const events = this.parseLogs(r.logs);
      const relevant = events.filter(
        (e) =>
          e.name ===
          (intent.kind === "revoke"
            ? "CertificateRevoked"
            : "CertificateIssued"),
      );
      if (relevant.length !== intent.ids.length)
        fail(409, "TRANSACTION_MISMATCH");
      for (let i = 0; i < intent.ids.length; i++) {
        const id = intent.ids[i]!;
        const event = relevant[i]!;
        const record = await this.readRecord(id, head.number);
        if (
          event.id !== id ||
          event.blockNumber !== blockNumber ||
          event.blockHash !== base.blockHash ||
          event.transactionHash !== hash ||
          !record.exists ||
          event.issuer !== record.record.issuer
        )
          fail(409, "TRANSACTION_MISMATCH");
        if (intent.kind === "revoke") {
          if (event.actor !== intent.wallet || !record.record.revoked)
            fail(409, "TRANSACTION_MISMATCH");
        } else if (
          event.issuer !== intent.wallet ||
          event.digest !== intent.digests[i] ||
          record.record.documentHash !== intent.digests[i] ||
          record.record.issuedBlock !== blockNumber
        )
          fail(409, "TRANSACTION_MISMATCH");
      }
      if ((await this.block(blockNumber)).hash !== base.blockHash)
        fail(503, "CHAIN_REORG");
      return {
        ...base,
        status:
          confirmations < this.config.MIN_ISSUANCE_CONFIRMATIONS
            ? "CONFIRMATION_PENDING"
            : "CONFIRMED",
        events,
      };
    });
  }
  async events(from: number, to: number) {
    if (to < from || to - from >= 100) fail(400, "INVALID_BLOCK_RANGE");
    try {
      return this.parseLogs(
        z.array(rawLog).parse(
          await this.send("eth_getLogs", [
            {
              address: this.config.manifest.contractAddress,
              fromBlock: tag(from),
              toBlock: tag(to),
            },
          ]),
        ),
      );
    } catch (e) {
      throw chainError(e);
    }
  }
}
