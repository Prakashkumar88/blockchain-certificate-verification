import { readFileSync } from "node:fs";
import { z } from "zod";
import { keccak256, toUtf8Bytes } from "ethers";
import { address, hex32 } from "../schemas.js";
import abi from "../contracts/CertificateRegistry.json" with { type: "json" };
const positive = z.coerce.number().int().positive();
export const manifestSchema = z
  .object({
    chainId: positive,
    contractAddress: address,
    deploymentTransactionHash: hex32,
    deploymentBlock: z.number().int().nonnegative(),
    deploymentBlockHash: hex32,
    runtimeCodeHash: hex32,
    abiHash: hex32,
    deploymentId: hex32,
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function deploymentId(
  m: Pick<
    Manifest,
    | "chainId"
    | "contractAddress"
    | "deploymentTransactionHash"
    | "deploymentBlockHash"
  >,
) {
  return keccak256(
    toUtf8Bytes(
      `${m.chainId}:${m.contractAddress.toLowerCase()}:${m.deploymentTransactionHash}:${m.deploymentBlockHash}`,
    ),
  );
}
export const abiHash = keccak256(toUtf8Bytes(JSON.stringify(abi)));
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: positive.max(65535).default(3001),
  APP_ORIGIN: z.url(),
  SIWE_DOMAIN: z.string().min(1),
  SIWE_URI: z.url(),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  RPC_URL: z
    .url()
    .refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
  CHAIN_ID: positive,
  DEPLOYMENT_MANIFEST_PATH: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .regex(/^[a-fA-F0-9]{64,}$/)
    .refine((v) => !/^([a-fA-F0-9])\1+$/.test(v)),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  MIN_ISSUANCE_CONFIRMATIONS: positive.default(1),
  RPC_TIMEOUT_MS: positive.max(10000).default(5000),
  MAX_HEAD_AGE_SECONDS: z.coerce.number().int().nonnegative().default(0),
  SESSION_TTL_SECONDS: positive.max(28800).default(28800),
  SIWE_NONCE_TTL_SECONDS: positive.max(300).default(300),
  MAX_PDF_BYTES: positive.max(10485760).default(10485760),
  REQUEST_TIMEOUT_MS: positive.max(30000).default(30000),
  MAX_CONCURRENT_UPLOADS: positive.max(4).default(4),
  AUTH_RATE_PER_MIN: positive.default(10),
  UPLOAD_RATE_PER_MIN: positive.default(10),
  READ_RATE_PER_MIN: positive.default(60),
  DRAFT_TTL_SECONDS: positive.max(86400).default(86400),
  INDEXER_POLL_MS: positive.default(3000),
  INDEXER_REORG_OVERLAP: positive.max(100).default(12),
});
export type Config = z.infer<typeof envSchema> & { manifest: Manifest };
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = envSchema.parse(env);
  const origin = new URL(c.APP_ORIGIN);
  if (
    c.APP_ORIGIN !== origin.origin ||
    c.SIWE_DOMAIN !== origin.host ||
    c.SIWE_URI !== c.APP_ORIGIN
  )
    throw new Error("Invalid origin/SIWE scope");
  if (
    c.NODE_ENV === "production" &&
    (!c.COOKIE_SECURE ||
      origin.protocol !== "https:" ||
      c.MAX_HEAD_AGE_SECONDS === 0)
  )
    throw new Error("Unsafe production configuration");
  if (c.CHAIN_ID !== 31337 && c.MAX_HEAD_AGE_SECONDS === 0)
    throw new Error("Nonlocal chain requires freshness checks");
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(c.DEPLOYMENT_MANIFEST_PATH, "utf8")),
  );
  if (
    manifest.chainId !== c.CHAIN_ID ||
    manifest.abiHash !== abiHash ||
    manifest.deploymentId !== deploymentId(manifest)
  )
    throw new Error("Manifest mismatch");
  return { ...c, manifest };
}
