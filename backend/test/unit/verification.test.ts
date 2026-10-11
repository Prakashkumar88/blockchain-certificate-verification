import { it, expect } from "vitest";
import { VerificationService } from "../../src/services/verification.js";
import { ApiError } from "../../src/errors.js";
import { config, id, mockChain, record } from "../helpers/fixtures.js";
it.each([
  [false, false, undefined, "UNKNOWN"],
  [true, false, undefined, "VALID"],
  [true, false, id(2), "VALID"],
  [true, false, id(3), "MODIFIED"],
  [true, true, id(3), "REVOKED"],
  [true, true, id(2), "REVOKED"],
] as const)(
  "maps existence=%s revoked=%s digest=%s to %s",
  async (exists, revoked, digest, status) => {
    const chain = mockChain();
    chain.inspect.mockResolvedValue({
      exists,
      record: record({ revoked }),
      block: { number: 10, hash: id(10), timestamp: 1000 },
    });
    const result = await new VerificationService(config(), chain).verify(
      id(1),
      digest,
    );
    expect(result.status).toBe(status);
    expect(result.documentMatch).toBe(
      !exists || !digest ? null : digest === id(2),
    );
  },
);
it("distinguishes issuance confirmation delay and immediately reports revocation", async () => {
  const c = config();
  c.MIN_ISSUANCE_CONFIRMATIONS = 2;
  const chain = mockChain();
  chain.inspect.mockResolvedValue({
    exists: true,
    record: record({ issuedBlock: 10 }),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  const service = new VerificationService(c, chain);
  expect(await service.verify(id(1))).toMatchObject({
    status: "UNAVAILABLE",
    reason: "CONFIRMATION_PENDING",
  });
  chain.inspect.mockResolvedValue({
    exists: true,
    record: record({ issuedBlock: 10, revoked: true }),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  expect((await service.verify(id(1))).status).toBe("REVOKED");
});
it.each(["RPC_UNAVAILABLE", "CONTRACT_CALL_FAILED", "CHAIN_REORG"])(
  "never maps %s to unknown",
  async (code) => {
    const chain = mockChain();
    chain.inspect.mockRejectedValue(new ApiError(503, code));
    expect(
      await new VerificationService(config(), chain).verify(id(1)),
    ).toMatchObject({ status: "UNAVAILABLE", reason: code });
  },
);
