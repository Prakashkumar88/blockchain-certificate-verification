import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress } from "ethers";
import { SiweMessage } from "siwe";
import type { Config } from "../config/index.js";
import type { Store, Session } from "../storage/store.js";
import type { Chain } from "./chain.js";
import { fail } from "../errors.js";
const token = () => randomBytes(32).toString("hex");
export class AuthService {
  constructor(
    readonly config: Config,
    private store: Store,
    private chain: Chain,
  ) {}
  hash(value: string) {
    return createHmac("sha256", this.config.SESSION_SECRET)
      .update(value)
      .digest("hex");
  }
  csrf(raw: string) {
    return this.hash("csrf:" + raw);
  }
  checkCsrf(raw: string, provided: unknown) {
    const expected = this.csrf(raw);
    if (
      typeof provided !== "string" ||
      !/^[0-9a-f]{64}$/.test(provided) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      fail(403, "CSRF_INVALID");
  }
  async session(raw?: string): Promise<Session | null> {
    if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null;
    return this.store.one("sessions", {
      key: this.hash(raw),
      deploymentId: this.config.manifest.deploymentId,
      expiresAt: { $gt: new Date() },
    });
  }
  async create(wallet?: string) {
    const raw = token();
    const session: Session = {
      key: this.hash(raw),
      deploymentId: this.config.manifest.deploymentId,
      expiresAt: new Date(Date.now() + this.config.SESSION_TTL_SECONDS * 1000),
      ...(wallet ? { wallet } : {}),
    };
    await this.store.insert("sessions", session);
    return { raw, session, csrfToken: this.csrf(raw) };
  }
  async challenge(session: Session, wallet: string) {
    if (!(await this.chain.isEoa(wallet))) fail(400, "UNSUPPORTED_WALLET");
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = new Date(
      Date.now() + this.config.SIWE_NONCE_TTL_SECONDS * 1000,
    );
    const message = new SiweMessage({
      domain: this.config.SIWE_DOMAIN,
      address: getAddress(wallet),
      statement:
        "Sign in to Certificate Verification. This does not authorize a blockchain transaction.",
      uri: this.config.SIWE_URI,
      version: "1",
      chainId: this.config.CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: expiresAt.toISOString(),
      requestId: this.config.manifest.deploymentId,
    }).prepareMessage();
    await this.store.insert("challenges", {
      key: this.hash("nonce:" + nonce),
      deploymentId: this.config.manifest.deploymentId,
      sessionKey: session.key,
      wallet,
      message,
      expiresAt,
    });
    return { message, expiresAt: expiresAt.toISOString() };
  }
  async verify(session: Session, message: string, signature: string) {
    let parsed: SiweMessage;
    try {
      parsed = new SiweMessage(message);
    } catch {
      return fail(401, "SIGNATURE_INVALID");
    }
    const challenge = await this.store.one("challenges", {
      key: this.hash("nonce:" + parsed.nonce),
      sessionKey: session.key,
      deploymentId: this.config.manifest.deploymentId,
      expiresAt: { $gt: new Date() },
    });
    if (
      !challenge ||
      challenge.message !== message ||
      parsed.address.toLowerCase() !== challenge.wallet ||
      parsed.domain !== this.config.SIWE_DOMAIN ||
      parsed.uri !== this.config.SIWE_URI ||
      parsed.chainId !== this.config.CHAIN_ID ||
      !parsed.issuedAt ||
      Date.parse(parsed.issuedAt) > Date.now() + 60000
    )
      fail(401, "CHALLENGE_INVALID");
    if (!(await this.chain.isEoa(challenge.wallet)))
      fail(400, "UNSUPPORTED_WALLET");
    try {
      const verified = await parsed.verify({
        signature,
        domain: this.config.SIWE_DOMAIN,
        nonce: parsed.nonce,
        time: new Date().toISOString(),
      });
      if (!verified.success) fail(401, "SIGNATURE_INVALID");
    } catch {
      return fail(401, "SIGNATURE_INVALID");
    }
    const consumed = await this.store.take("challenges", {
      key: challenge.key,
      sessionKey: session.key,
      expiresAt: { $gt: new Date() },
    });
    if (!consumed) fail(401, "CHALLENGE_USED_OR_EXPIRED");
    // Atomically consume the pre-auth session too: two different challenges cannot create two sessions.
    const old = await this.store.take("sessions", {
      key: session.key,
      deploymentId: session.deploymentId,
      expiresAt: { $gt: new Date() },
    });
    if (!old) fail(401, "SESSION_EXPIRED");
    return this.create(challenge.wallet);
  }
  async logout(session: Session) {
    await this.store.remove("sessions", {
      key: session.key,
      deploymentId: session.deploymentId,
    });
  }
}
