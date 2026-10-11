import { afterEach, it, expect, vi } from "vitest";
import { Wallet } from "ethers";
import { AuthService } from "../../src/services/auth.js";
import { MemoryStore, config, mockChain } from "../helpers/fixtures.js";
afterEach(() => vi.useRealTimers());
async function setup() {
  const c = config(),
    store = new MemoryStore(),
    chain = mockChain(),
    auth = new AuthService(c, store, chain),
    wallet = Wallet.createRandom();
  const pre = await auth.create(),
    challenge = await auth.challenge(pre.session, wallet.address.toLowerCase());
  return { c, store, chain, auth, wallet, pre, challenge };
}
it("verifies SIWE, rotates session, and prevents parallel nonce replay", async () => {
  const { auth, wallet, pre, challenge } = await setup();
  const signature = await wallet.signMessage(challenge.message);
  const results = await Promise.allSettled([
    auth.verify(pre.session, challenge.message, signature),
    auth.verify(pre.session, challenge.message, signature),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await auth.session(pre.raw)).toBeNull();
  const good = results.find((r) => r.status === "fulfilled");
  if (good?.status === "fulfilled") {
    expect(good.value.raw).not.toBe(pre.raw);
    expect(good.value.session.wallet).toBe(wallet.address.toLowerCase());
  }
});
it("two distinct challenges cannot reuse a consumed pre-auth session", async () => {
  const { auth, wallet, pre, challenge } = await setup();
  const second = await auth.challenge(
    pre.session,
    wallet.address.toLowerCase(),
  );
  await auth.verify(
    pre.session,
    challenge.message,
    await wallet.signMessage(challenge.message),
  );
  await expect(
    auth.verify(
      pre.session,
      second.message,
      await wallet.signMessage(second.message),
    ),
  ).rejects.toThrow("SESSION_EXPIRED");
});
it("expires challenges even before database TTL deletion", async () => {
  const { auth, wallet, pre, challenge } = await setup();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 301000);
  await expect(
    auth.verify(
      pre.session,
      challenge.message,
      await wallet.signMessage(challenge.message),
    ),
  ).rejects.toThrow("CHALLENGE_INVALID");
});
it("rejects a signature by another wallet", async () => {
  const { auth, pre, challenge } = await setup();
  await expect(
    auth.verify(
      pre.session,
      challenge.message,
      await Wallet.createRandom().signMessage(challenge.message),
    ),
  ).rejects.toThrow("SIGNATURE_INVALID");
});
it("binds challenge to exact domain, chain, message and browser session", async () => {
  const { auth, wallet, pre, challenge } = await setup();
  const altered = challenge.message.replace("localhost:5173", "evil.example");
  await expect(
    auth.verify(pre.session, altered, await wallet.signMessage(altered)),
  ).rejects.toThrow("CHALLENGE_INVALID");
  const other = await auth.create();
  await expect(
    auth.verify(
      other.session,
      challenge.message,
      await wallet.signMessage(challenge.message),
    ),
  ).rejects.toThrow("CHALLENGE_INVALID");
});
it("rejects contract wallets and database outage without session fallback", async () => {
  const { auth, chain, store, pre, wallet } = await setup();
  chain.isEoa.mockResolvedValue(false);
  await expect(
    auth.challenge(pre.session, wallet.address.toLowerCase()),
  ).rejects.toThrow("UNSUPPORTED_WALLET");
  store.available = false;
  await expect(auth.session(pre.raw)).rejects.toThrow("DATABASE_UNAVAILABLE");
});
it("requires CSRF, expires sessions and invalidates logout", async () => {
  const { auth, pre } = await setup();
  expect(() => auth.checkCsrf(pre.raw, "incorrect")).toThrow("CSRF_INVALID");
  auth.checkCsrf(pre.raw, pre.csrfToken);
  await auth.logout(pre.session);
  expect(await auth.session(pre.raw)).toBeNull();
  const fresh = await auth.create();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 28801000);
  expect(await auth.session(fresh.raw)).toBeNull();
});
