import { it, expect, vi } from "vitest";
import { keccak256, ZeroAddress } from "ethers";
import {
  RegistryChain,
  registryInterface,
  SOLIDITY_STATUS,
  type Intent,
  type Rpc,
} from "../../src/services/chain.js";
import { config, id, wallet, other } from "../helpers/fixtures.js";
const tag = (n: number) => "0x" + n.toString(16);
function setup() {
  const c = config();
  c.manifest.runtimeCodeHash = keccak256("0x1234");
  c.manifest.deploymentBlockHash = id(1);
  const state = {
    exists: true,
    revoked: false,
    digest: id(2),
    head: 10,
    chain: "0x7a69",
    code: "0x1234",
    stale: false,
    comparison: 1,
    callFail: false,
    badAbi: false,
    tx: null as unknown,
    receipt: null as unknown,
    reorg: false,
  };
  const send = vi
    .fn<Rpc["send"]>()
    .mockImplementation(async (method, params) => {
      if (method === "eth_chainId") return state.chain;
      if (method === "eth_getCode") return state.code;
      if (method === "eth_getBlockByNumber") {
        const n =
          params[0] === "latest"
            ? state.head
            : Number(BigInt(String(params[0])));
        return {
          number: tag(n),
          hash:
            state.reorg && params[0] !== "latest" && n === state.head
              ? id(1000)
              : id(n),
          timestamp: tag(state.stale ? 1 : Math.floor(Date.now() / 1000)),
        };
      }
      if (method === "eth_getTransactionByHash") return state.tx;
      if (method === "eth_getTransactionReceipt") return state.receipt;
      if (method === "eth_getLogs") return [];
      if (method === "eth_call") {
        if (state.callFail)
          throw {
            code: "CALL_EXCEPTION",
            data: registryInterface.encodeErrorResult("ZeroCertificateId", []),
          };
        if (state.badAbi) return "0xdead";
        const data = (params[0] as { data: string }).data,
          parsed = registryInterface.parseTransaction({ data })!;
        if (parsed.name === "getCertificate")
          return registryInterface.encodeFunctionResult(parsed.name, [
            state.exists,
            [
              state.digest,
              state.exists ? wallet : ZeroAddress,
              1000,
              5,
              state.revoked ? 1001 : 0,
              state.revoked,
            ],
          ]);
        if (parsed.name === "verifyCertificate")
          return registryInterface.encodeFunctionResult(parsed.name, [
            state.comparison,
          ]);
        if (parsed.name === "MAX_BATCH_SIZE")
          return registryInterface.encodeFunctionResult(parsed.name, [50]);
        if (parsed.name === "hasRole")
          return registryInterface.encodeFunctionResult(parsed.name, [true]);
        return "0x";
      }
      throw new Error("Unexpected method " + method);
    });
  const chain = new RegistryChain(c, { send });
  const intent: Intent = {
    kind: "issue",
    wallet,
    ids: [id(1)],
    digests: [id(2)],
  };
  const tx = {
    hash: id(99),
    from: wallet,
    to: c.manifest.contractAddress,
    input: chain.data(intent),
    blockNumber: "0x5",
  };
  const log = registryInterface.encodeEventLog(
    registryInterface.getEvent("CertificateIssued")!,
    [id(1), wallet, id(2), 1000],
  );
  const receipt = {
    transactionHash: id(99),
    from: wallet,
    to: c.manifest.contractAddress,
    status: "0x1",
    blockNumber: "0x5",
    blockHash: id(5),
    logs: [
      {
        address: c.manifest.contractAddress,
        ...log,
        blockNumber: "0x5",
        blockHash: id(5),
        transactionHash: id(99),
        logIndex: "0x0",
      },
    ],
  };
  return { c, state, send, chain, intent, tx, receipt };
}
it("maps the exact enum and pins reads to a validated mined block", async () => {
  expect(SOLIDITY_STATUS).toEqual({
    0: "UNKNOWN",
    1: "VALID",
    2: "MODIFIED",
    3: "REVOKED",
  });
  const { chain, send } = setup();
  expect(await chain.inspect(id(1), id(2))).toMatchObject({
    exists: true,
    comparison: "VALID",
    record: { issuer: wallet, documentHash: id(2) },
  });
  for (const [method, args] of send.mock.calls)
    if (method === "eth_call") expect(args[1]).toBe("0xa");
});
it.each([
  "wrongChain",
  "wrongCode",
  "stale",
  "reorg",
  "callFail",
  "badAbi",
] as const)("fails closed for %s", async (problem) => {
  const { c, state, chain } = setup();
  if (problem === "wrongChain") state.chain = "0x1";
  if (problem === "wrongCode") state.code = "0x";
  if (problem === "stale") {
    c.MAX_HEAD_AGE_SECONDS = 120;
    state.stale = true;
  }
  if (problem === "reorg") state.reorg = true;
  if (problem === "callFail") state.callFail = true;
  if (problem === "badAbi") state.badAbi = true;
  await expect(chain.inspect(id(1))).rejects.toMatchObject({ status: 503 });
});
it("rejects disagreement between record and contract comparison enum", async () => {
  const { chain, state } = setup();
  state.comparison = 2;
  await expect(chain.inspect(id(1), id(2))).rejects.toThrow(
    "CONTRACT_CALL_FAILED",
  );
});
it("distinguishes missing/dropped, pending and missing-receipt transactions", async () => {
  const { chain, state, tx, intent } = setup();
  expect(await chain.transaction(id(99), intent)).toMatchObject({
    status: "UNRESOLVED",
    reason: "NOT_FOUND_OR_DROPPED",
  });
  state.tx = { ...tx, blockNumber: null };
  expect((await chain.transaction(id(99), intent)).status).toBe("PENDING");
  state.tx = tx;
  expect(await chain.transaction(id(99), intent)).toMatchObject({
    status: "UNRESOLVED",
    reason: "RECEIPT_UNAVAILABLE",
  });
});
it("requires canonical successful receipts and required confirmations", async () => {
  const { c, chain, state, tx, receipt, intent } = setup();
  state.tx = tx;
  state.receipt = receipt;
  expect(await chain.transaction(id(99), intent)).toMatchObject({
    status: "CONFIRMED",
    confirmations: 6,
  });
  c.MIN_ISSUANCE_CONFIRMATIONS = 7;
  expect((await chain.transaction(id(99), intent)).status).toBe(
    "CONFIRMATION_PENDING",
  );
  state.receipt = { ...receipt, status: "0x0", logs: [] };
  expect((await chain.transaction(id(99), intent)).status).toBe("REVERTED");
});
it.each([
  "wallet",
  "destination",
  "calldata",
  "event",
  "block",
  "digest",
] as const)("rejects forged receipt/transaction %s", async (attack) => {
  const { chain, state, tx, receipt, intent } = setup();
  state.tx = tx;
  state.receipt = receipt;
  if (attack === "wallet") tx.from = other;
  if (attack === "destination") tx.to = other;
  if (attack === "calldata") tx.input = "0xdead";
  if (attack === "event") receipt.logs = [];
  if (attack === "block") receipt.blockHash = id(50);
  if (attack === "digest") state.digest = id(9);
  await expect(chain.transaction(id(99), intent)).rejects.toBeDefined();
});
it("simulates without broadcasting and reports contract rejection", async () => {
  const { chain, state, send, intent } = setup();
  expect(await chain.prepare(intent)).toMatchObject({
    data: chain.data(intent),
    from: wallet,
    value: "0x0",
  });
  expect(
    send.mock.calls.some(([method]) => method.startsWith("eth_send")),
  ).toBe(false);
  state.callFail = true;
  await expect(chain.prepare(intent)).rejects.toThrow(
    "TRANSACTION_WOULD_REVERT",
  );
});
it("separates RPC transport failure from failed ABI decoding", async () => {
  const { chain, send } = setup();
  send.mockRejectedValue({
    code: "NETWORK_ERROR",
    message: "secret rpc credential",
  });
  await expect(chain.inspect(id(1))).rejects.toThrow("RPC_UNAVAILABLE");
});
