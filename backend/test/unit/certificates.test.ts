import { it, expect } from "vitest";
import { CertificateService } from "../../src/services/certificates.js";
import type { Intent } from "../../src/services/chain.js";
import {
  config,
  MemoryStore,
  mockChain,
  id,
  wallet,
  other,
  record,
} from "../helpers/fixtures.js";
function setup() {
  const c = config(),
    store = new MemoryStore(),
    chain = mockChain();
  return { c, store, chain, service: new CertificateService(c, store, chain) };
}
const intent: Intent = {
  kind: "issue",
  wallet,
  ids: [id(1)],
  digests: [id(2)],
};
it("reconciles idempotently and reports chain success independently from database failure", async () => {
  const { service, chain, store } = setup();
  chain.inspect.mockResolvedValue({
    exists: true,
    record: record(),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  chain.transaction.mockResolvedValue({
    transactionHash: id(99),
    status: "CONFIRMED",
    blockNumber: 5,
    blockHash: id(5),
    confirmations: 6,
  });
  store.failMetadata = true;
  expect(await service.reconcile(id(99), intent)).toMatchObject({
    status: "CONFIRMED",
    metadataStatus: "RECONCILIATION_REQUIRED",
    reason: "DATABASE_UNAVAILABLE",
  });
  store.failMetadata = false;
  expect((await service.reconcile(id(99), intent)).metadataStatus).toBe(
    "SYNCED",
  );
  await service.reconcile(id(99), intent);
  expect(store.rows.metadata).toHaveLength(1);
  expect(store.rows.transactions).toHaveLength(1);
});
it.each(["PENDING", "CONFIRMATION_PENDING", "REVERTED"] as const)(
  "does not attach metadata for %s",
  async (status) => {
    const { service, chain, store } = setup();
    chain.transaction.mockResolvedValue({ transactionHash: id(99), status });
    const r = await service.reconcile(id(99), intent);
    expect(r.status).toBe(status);
    expect(store.rows.metadata).toHaveLength(0);
  },
);
it("does not let an unobserved transaction hash reserve another user’s tracking entry", async () => {
  const { service, chain, store } = setup();
  chain.transaction.mockResolvedValue({
    transactionHash: id(99),
    status: "UNRESOLVED",
    reason: "NOT_FOUND_OR_DROPPED",
  });
  await service.reconcile(id(99), intent);
  expect(store.rows.transactions).toHaveLength(0);
});
it("checks draft owner, expiry, duplicate certificate IDs and deployed cap", async () => {
  const { service, chain, store } = setup();
  const a = await service.createDraft(wallet, id(1), id(2));
  await expect(service.draft(other, a.key)).rejects.toThrow("DRAFT_NOT_FOUND");
  const b = await service.createDraft(wallet, id(1), id(3));
  await expect(
    service.issuanceIntent(wallet, [a.key, b.key], true),
  ).rejects.toThrow("DUPLICATE_CERTIFICATE_ID");
  chain.maxBatch.mockResolvedValue(1);
  await expect(
    service.issuanceIntent(wallet, [a.key, b.key], true),
  ).rejects.toThrow("INVALID_BATCH");
  (store.rows.drafts[0] as { expiresAt: Date }).expiresAt = new Date(0);
  await expect(service.draft(wallet, a.key)).rejects.toThrow("DRAFT_NOT_FOUND");
});
it("revocation permits only the active original issuer, never the admin", async () => {
  const { service, chain } = setup();
  chain.inspect.mockResolvedValue({
    exists: true,
    record: record(),
    block: { number: 10, hash: id(10), timestamp: 1000 },
  });
  await expect(service.revocationIntent(other, id(1))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  chain.roles.mockResolvedValue({ issuer: false, admin: false });
  await expect(service.revocationIntent(wallet, id(1))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  chain.roles.mockResolvedValue({ issuer: false, admin: true });
  await expect(service.revocationIntent(other, id(1))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  chain.roles.mockResolvedValue({ issuer: true, admin: true });
  await expect(service.revocationIntent(other, id(1))).rejects.toThrow(
    "REVOCATION_FORBIDDEN",
  );
  chain.roles.mockResolvedValue({ issuer: true, admin: false });
  expect((await service.revocationIntent(wallet, id(1))).kind).toBe("revoke");
});
