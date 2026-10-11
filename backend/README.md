# Phase 2 backend

Node 24, Express 5, TypeScript, Ethers 6, SIWE, Zod and Mongoose. The root npm workspace currently contains **only this backend**. Phase 1 contracts are unchanged; no frontend or public deployment is included.

## Install and configure

From the repository root:

```sh
npm ci
npm run abi:check
npm run typecheck
npm run lint
npm run build
npm run test:unit
```

Exact versions are in `package.json` and the root lockfile. `abi:check` compares the checked-in backend ABI with the existing Forge artifact; it does not compile Solidity. A fresh checkout needs the approved Phase 1 build before this comparison or Anvil integration tests. `npm run abi:export` regenerates the ABI from `contracts/out/CertificateRegistry.sol/CertificateRegistry.json`; review any changes.

Start the existing Docker Desktop application, then the local database:

```sh
docker compose up -d mongo
docker compose ps
```

`compose.yaml` pins MongoDB 8.0.32 and binds port 27017 to loopback. It intentionally has no credentials for the isolated local demo; do not expose this service publicly. Its named volume persists between restarts. `docker compose stop mongo` stops it without deleting data. Production requires separate authenticated, private, encrypted database provisioning.

Start Anvil and deploy using the existing [Phase 1 instructions](../contracts/README.md). Do not reuse public-network wallets or expose unlocked Anvil accounts. The backend does not deploy contracts.

Create the ignored local environment file:

```sh
cp backend/.env.example backend/.env
```

Replace `SESSION_SECRET` with at least 32 locally generated random bytes encoded as hex. Keep the resulting file private. Set the public `DEPLOYMENT_TRANSACTION_HASH` to the successful local deployment receipt hash. Then:

```sh
npm run manifest:local -w backend
npm run dev
```

The manifest command reads an **existing** deployment on loopback chain 31337, checks its runtime bytecode against the Phase 1 artifact and writes `deployments/31337.local.json`. It never signs or submits a transaction. Paths in `.env` are relative to the backend package working directory. No maintained deployment is created by tests.

For the compiled server:

```sh
npm run build
npm run start -w backend
```

Run the event indexer in a second terminal:

```sh
npm run indexer:dev -w backend
```

The API and indexer must use the same environment/deployment. Run one indexer instance per deployment. If the initial Mongo connection or index initialization fails, the API starts with database-backed operations unavailable while public chain verification remains available. Restore Mongo and restart the API after an initial connection failure. Readiness reports both dependencies independently.

## Configuration

See [`.env.example`](.env.example). No private-key, mnemonic, password-login or backend signing option exists.

| Configuration                                                   | Meaning                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `HOST`, `PORT`                                      | Environment and HTTP listener; loopback:3001 locally                                                       |
| `APP_ORIGIN`, `SIWE_DOMAIN`, `SIWE_URI`                         | Exact browser origin and SIWE scope; domain includes the port; URI equals origin                           |
| `MONGODB_URI`                                                   | Server-only database URI; never logged or returned                                                         |
| `RPC_URL`, `CHAIN_ID`                                           | Read-only JSON-RPC transport and required chain                                                            |
| `DEPLOYMENT_MANIFEST_PATH`                                      | Chain/address/deployment block and transaction hashes, runtime code hash, ABI hash, deployment ID          |
| `SESSION_SECRET`                                                | Private random HMAC key, at least 64 hex characters                                                        |
| `COOKIE_SECURE`, `TRUST_PROXY_HOPS`                             | HTTPS cookie policy and explicit known proxy count                                                         |
| `MIN_ISSUANCE_CONFIRMATIONS`                                    | Positive confirmation threshold, 1 locally; also applied to transaction reconciliation                     |
| `RPC_TIMEOUT_MS`, `MAX_HEAD_AGE_SECONDS`                        | RPC timeout and head freshness; zero freshness limit only on local nonproduction chain 31337               |
| `SESSION_TTL_SECONDS`, `SIWE_NONCE_TTL_SECONDS`                 | Maximum 8-hour sessions and 5-minute challenges; expiry checked at use, independently of Mongo TTL cleanup |
| `MAX_PDF_BYTES`, `REQUEST_TIMEOUT_MS`, `MAX_CONCURRENT_UPLOADS` | At most 10 MiB, 30 seconds, 4 concurrent uploads; at most 2 per client                                     |
| `AUTH_RATE_PER_MIN`, `UPLOAD_RATE_PER_MIN`, `READ_RATE_PER_MIN` | Per-IP limits; protected uploads also have per-wallet limits                                               |
| `DRAFT_TTL_SECONDS`                                             | Maximum 24-hour drafts; no PDF storage                                                                     |
| `INDEXER_POLL_MS`, `INDEXER_REORG_OVERLAP`                      | Poll interval and replay overlap; default 3000 ms and 12 blocks                                            |
| `TEST_MONGODB_URI`                                              | Test runner only; explicit loopback `certificates_test` database URI                                       |
| `DEPLOYMENT_TRANSACTION_HASH`                                   | Manifest tool only; public local deployment transaction hash                                               |

Configuration rejects invalid manifest identity, ABI mismatch, zero addresses, malformed hashes, placeholder secrets and unsafe production cookie/origin/freshness settings. Public deployment setup remains a separately approved phase. The deployment ID includes chain, address, deployment transaction and block hash; rebuilding Anvil requires a fresh manifest and session namespace.

## Authentication and authorization

1. `GET /api/v1/auth/session` establishes a pre-auth session and returns a CSRF token. Cookies are HttpOnly, SameSite=Lax, host-only; Secure and the `__Host-` prefix are enabled for HTTPS.
2. `POST /auth/challenge` with `{ "wallet": "0x…" }`, cookie, exact `Origin` and `X-CSRF-Token` returns the server-built SIWE message.
3. The client wallet signs that exact message. `POST /auth/verify` sends `{ "message": "…", "signature": "0x…" }` with the same cookie/CSRF binding.
4. Verification checks the signature, exact stored message, nonce, domain, URI, chain, deployment, wallet, expiry and EOA-only policy. Atomic challenge and pre-auth-session consumption prevents replay; successful login rotates the session and CSRF token.
5. Every protected request checks live contract roles. Metadata requires the active original issuer. Revocation also requires the active original issuer; the admin role confers neither revocation nor private metadata access.
6. Logout uses `DELETE /auth/session`, cookie, exact Origin and current CSRF token.

All cookie-authenticated mutations require Origin and CSRF, including login and logout. Public PDF verification needs no session. On account/network change the future client must log out and authenticate again. Database failure denies authentication and private operations. The server stores HMACs of opaque session cookies; cookies and signatures never appear in application logs. Sessions contain no cached role entitlement. Only server-generated SIWE messages are accepted. Smart-contract wallet authentication is intentionally unsupported.

## Transaction signing and reconciliation

The API **never broadcasts or signs**. A prepared transaction contains `to`, `from`, `chainId`, `data`, and zero `value`; status is `AWAITING_SIGNATURE`. The future browser wallet must display/review it, estimate gas and sign on the configured deployment. Contract simulation is advisory: roles/state can change before mining.

For a single issuance:

1. Upload one finalized PDF to `POST /issuance-drafts`; optionally include a random `certificateId` field. If the PDF embeds an ID, supply that same ID before hashing. Otherwise the server can generate an opaque ID.
2. Call `POST /issuance-drafts/:draftId/prepare` with `{}`.
3. Submit the prepared call through the issuer wallet.
4. Send its hash to `POST /issuance-drafts/:draftId/transaction` as `{ "transactionHash": "0x…" }`.
5. Poll `GET /transactions/:hash`, or repeat reconciliation. Hash hints alone never prove issuance.

For a batch, prepare individual uploads, then send `{ "draftIds": ["0x…", "0x…"] }` to `POST /issuance-batches/prepare`. Add `transactionHash` for `/issuance-batches/transaction`. IDs must be distinct and count must respect the **deployed `MAX_BATCH_SIZE()`**, currently 50. The API additionally caps request schemas at the reviewed 50. Larger jobs require explicit client chunks; only each transaction is atomic.

Revocation uses `/certificates/:id/revocation/prepare` and `/certificates/:id/revocation/transaction`. Active original issuers or the current admin are accepted. No backend grant/remove-issuer transaction endpoint exists; those remain wallet calls using the contract ABI. Revocation is irreversible; issuer removal preserves past certificates.

Reconciliation validates the actual transaction sender, destination and exact calldata, successful receipt, canonical block, matching registry events, stored issuer/digest and confirmations. Custom contract errors are decoded to names without exposing raw error/provider payloads.

| Transaction status                                           | HTTP / meaning                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `AWAITING_SIGNATURE`                                         | 200; unsigned preparation only                                                                      |
| `PENDING`                                                    | 202; known transaction, no mined receipt                                                            |
| `UNRESOLVED`                                                 | 202; missing receipt or hash not found; may be dropped/replaced or temporarily absent from this RPC |
| `CONFIRMATION_PENDING`                                       | 202; mined, below threshold; metadata not attached                                                  |
| `REVERTED`                                                   | 409; mined receipt status zero                                                                      |
| `CONFIRMED` + `metadataStatus: SYNCED`                       | 200; receipt/state checked and metadata reconciled                                                  |
| Any mined status + `metadataStatus: RECONCILIATION_REQUIRED` | 503; chain result is retained in the response but persistence failed; retry the same hash/intent    |

A hash alone cannot prove that an absent transaction was dropped or discover its replacement. The client must retain the original intent and any wallet-provided replacement hash, and submit the replacement for the same full validation. Rejected wallet signatures and submission failures occur in the client; the API never claims to observe them. Unknown hashes do not reserve a shared transaction record. Unmined issuance stays `UNKNOWN` on public chain reads; pending revocation does not change current mined validity.

## Endpoints

All paths below are under `/api/v1`. Protected mutations require the session cookie, Origin and CSRF token. JSON bodies reject unknown fields.

| Method/path                                                                                  | Access / purpose                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /health/live`, `GET /health/ready`                                                      | Process and dependency health                                                                    |
| `GET /auth/session`                                                                          | Session/CSRF bootstrap or current wallet                                                         |
| `POST /auth/challenge`, `POST /auth/verify`, `DELETE /auth/session`                          | SIWE and logout                                                                                  |
| `GET /certificates/:id/verification`                                                         | Public authoritative ID verification                                                             |
| `POST /certificates/:id/verify-pdf`                                                          | Public multipart field `pdf`; ignores no caller-provided digest because such fields are rejected |
| `POST /issuance-drafts`                                                                      | Active issuer, one `pdf` and optional `certificateId`; returns draft ID/digest                   |
| `GET /issuance-drafts/:draftId`                                                              | Active owning issuer; unexpired draft                                                            |
| `POST /issuance-drafts/:draftId/prepare`, `POST /issuance-batches/prepare`                   | Active owning issuer; unsigned calldata                                                          |
| `POST /issuance-drafts/:draftId/transaction`, `POST /issuance-batches/transaction`           | Validate receipt hints and reconcile                                                             |
| `POST /certificates/:id/revocation/prepare`, `POST /certificates/:id/revocation/transaction` | Active original issuer only                                                                      |
| `GET /transactions/:hash`                                                                    | Authenticated owner with a current issuer/admin role; rechecks tracked transaction               |
| `GET/PATCH/DELETE /certificates/:id/metadata`                                                | Active original issuer; optional non-sensitive `displayLabel` only                               |
| `GET /issuer/drafts`, `GET /issuer/certificates`                                             | Active issuer's drafts/indexed issuance history                                                  |
| `GET /certificates/:id/history`                                                              | Public indexed history with block, lag and availability context                                  |
| `GET /admin/issuers`                                                                         | Admin; candidates from indexed issuer-role events, live role checks                              |
| `GET/PUT /admin/issuers/:wallet/profile`                                                     | Admin; non-sensitive `institutionName` only                                                      |

Pagination uses `?cursor=0&limit=25`, with at most 100 results and bounded offset 100000. Responses supply `nextCursor`. Admin issuer pagination advances over role events; repeated wallets across pages are possible and clients should deduplicate. Offset pagination can shift as data changes; it is for this local demo, not an immutable export API.

Examples, substituting an actual nonzero 32-byte ID:

```sh
curl http://127.0.0.1:3001/api/v1/health/ready
curl 'http://127.0.0.1:3001/api/v1/certificates/0x<64-hex-digits>/verification'
curl -F 'pdf=@synthetic.pdf;type=application/pdf' \
  'http://127.0.0.1:3001/api/v1/certificates/0x<64-hex-digits>/verify-pdf'
```

A completed PDF verification resembles:

```json
{
  "status": "VALID",
  "mode": "pdf",
  "certificateId": "0x<64-hex-digits>",
  "documentMatch": true,
  "chainId": 31337,
  "contractAddress": "0x<40-hex-digits>",
  "deploymentId": "0x<64-hex-digits>",
  "checkedBlock": { "number": 12, "hash": "0x<64-hex-digits>", "timestamp": 0 },
  "confirmations": 2
}
```

Known records additionally include the contract record. ID-only results have `documentMatch: null` and establish no PDF equality. The API spells statuses uppercase; it preserves the approved meanings: `UNKNOWN`, `VALID`, `MODIFIED`, `REVOKED`, and `UNAVAILABLE`. Below-threshold issuance returns HTTP 503 with `status: UNAVAILABLE`, `reason: CONFIRMATION_PENDING` and `transactionStatus: CONFIRMATION_PENDING`. Revocation takes precedence over mismatch and confirmation delay. RPC or call failure never becomes `UNKNOWN`.

Other errors use `{ "error": { "code": "VALIDATION_ERROR" } }`: 400 malformed input, 401 unauthenticated, 403 authority/Origin/CSRF, 404 private resource absent, 409 conflict/revert, 413 size, 415 type, 422 PDF envelope, 429 limits, 503 dependencies, 500 unexpected failure. Provider URLs, raw errors and stacks are never response fields.

## Hashing and consistency

PDF handling streams exact file-part bytes into SHA-256, preserving byte order and leading zeros in canonical `0x` + 64 lowercase hex digits. Ethers encodes these directly as `bytes32`; no string hashing, rehashing or PDF transformations occur. Only one PDF is admitted, with a `.pdf` filename, declared PDF MIME type, exact `%PDF-` prefix and terminal `%%EOF` followed only by permitted whitespace. This is a narrow byte-envelope check, not malware scanning or a full PDF parser. Multipart overhead is capped at 64 KiB; stalls, disconnects, over-limit streams and concurrency release resources. No PDF is saved to disk, MongoDB, logs or events.

Chain reads validate chain ID, deployment block hash and runtime code hash, pin all record/enum reads to a mined block and recheck its hash. A detected reorg/head race gets one bounded retry, then an unavailable result. The selected RPC remains a trust dependency; hashes from one provider do not defend against a consistently dishonest provider. Two confirmations are not economic finality.

Mongo stores supplementary drafts, minimal metadata, transaction observations, issuer profiles, indexed events, checkpoints, sessions and challenges. Unique indexes scope metadata/events to a deployment. No names, student references, grades, courses or PDFs are accepted. Display labels/institution names must be non-sensitive. Metadata access checks live ownership/roles and stored digest consistency. Mongo does not determine certificate validity.

Reconciliation uses idempotent upserts, not a cross-chain/database transaction. A batch can partially persist metadata after chain success; `RECONCILIATION_REQUIRED` instructs a retry. Repeated hints repair missing rows without issuing another certificate. Preserve draft IDs and transaction hashes client-side; after draft expiry, previously tracked intents can be polled. If both tracking persistence failed and drafts expired, private metadata can be reattached by the active owner using PATCH after authoritative ownership checks; historical transactions remain discoverable by the indexer.

The indexer processes at most 100 blocks per tick, replays an overlap and walks backward across deeper reorgs over multiple ticks. Per-block checkpoints and event keys make replay restartable. History validates checkpoint/event canonicality and reports lag. It is supplementary: stale, missing or offline history never overrides live verification. Anvil resets require a new manifest; an old deployment fails closed. Metadata transaction links are historical observations and may become orphaned; transaction polling revalidates them. No automatic private metadata deletion is triggered by an index reorg.

## Tests and remaining limits

```sh
npm run test:unit
npm run test:integration
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/certificates_test npm run test:integration
npm run format:check
npm run lint
npm run typecheck
npm run build
```

Unit/API tests mock RPC/database dependencies and use Supertest HTTP listeners. Integration tests start/stop their **own** loopback Anvil node, deploy the existing artifact using unlocked development accounts, exercise Ethers calls/receipts and start the actual HTTP server. They never read private keys or use a public network. The Anvil history test explicitly uses an in-memory store.

Mongo tests are **skipped** unless `TEST_MONGODB_URI` is supplied. They require a loopback URI whose database name starts with `certificates_test`, create their own random test database, verify real indexes/atomic challenge consumption, then drop only that database. Do not infer Mongo coverage from mock tests. See [PHASE2_REPORT.md](PHASE2_REPORT.md) for the actual executed results.

Single-process rate/concurrency limits require shared coordination before multiple API replicas. Run one indexer per deployment. Full PDF safety analysis, browser-wallet UI, client submission/replacement handling, performance/load testing, production TLS/proxy/database validation, independent security audit and Sepolia deployment remain outside this phase. Admin renunciation and authorized-issuer ID front-running retain the reviewed contract tradeoffs.

Primary implementation references: [Ethers JSON-RPC provider](https://docs.ethers.org/v6/api/providers/jsonrpc/), [Ethers request timeouts](https://docs.ethers.org/v6/api/utils/fetching/), [SIWE verification implementation](https://github.com/spruceid/siwe/blob/main/packages/siwe/lib/client.ts), [Mongoose connection failure behavior](https://mongoosejs.com/docs/connections.html), [MongoDB 8.0 release notes](https://www.mongodb.com/docs/v8.0/release-notes/8.0/).
