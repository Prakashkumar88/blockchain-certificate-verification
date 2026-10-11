# Local Integration Test Report

## 1. Summary and Scope

This report covers local integration testing of the **Blockchain-Based Smart Contract System for Secure Certificate Verification**.

**What "integration" means here.** The backend integration suites run the real `CertificateRegistry` contract on a local Anvil node, the real Express API (in-process via `supertest`), and a real MongoDB 7.0 container. Transactions are signed and broadcast by **programmatic Anvil signers** (ethers `JsonRpcSigner`), standing in for the user's wallet.

**What is not covered end to end.** No test drives the React application, a real browser, or a real browser wallet (MetaMask, etc.). Frontend behaviour is tested separately in jsdom with mocked API responses. Section 5 lists the exact limitations. These suites should therefore be described as **backend/contract/database integration tests**, not as full-stack browser E2E tests.

> Revision (Finding 7): an earlier version of this report said all scenarios ran "with zero mocks" across the frontend, and that Scenario 9 tested wallet rejection and RPC failure. Both claims were inaccurate. Several endpoint names, response fields, and test counts were also wrong. All of these are corrected below, and the missing failure-path tests have been added (Section 4).

---

## 2. Test Environment

| Component | Technology | Configuration |
| :--- | :--- | :--- |
| Blockchain node | Foundry Anvil 1.8.5 (`cancun`) | `127.0.0.1:<ephemeral>`, chain ID `31337`, fresh node per suite |
| Smart contract | `CertificateRegistry.sol` | Deployed per suite; issuer role granted to Anvil account 1 |
| Database | MongoDB 7.0 (`compose.test.yaml`) | `127.0.0.1:27017`, random per-suite database, dropped afterwards |
| Backend | Express 5 + Mongoose, in-process via `supertest` | Real `createApp`, `RegistryChain`, `MongoStore` |
| Client signer | ethers v6 `JsonRpcSigner` (Anvil unlocked accounts) | **Programmatic, not a browser wallet** |

**How to run**

```bash
docker compose -f compose.test.yaml up -d --wait
cd backend
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/certificates_test npm run test:integration
```

`test/integration/mongo.test.ts` is **skipped** unless `TEST_MONGODB_URI` is set. The other suites default to `mongodb://127.0.0.1:27017`.

Test database safety: every MongoDB suite goes through `test/helpers/mongo.ts`. It accepts only a loopback `mongodb://…/certificates_test[_x]` URI and always uses a fresh random `certificates_test_<16 hex>` database. Teardown drops only databases matching that pattern. Any other URI (such as `certificates_local`, a remote host or `mongodb+srv`) makes the suites fail before connecting.

---

## 3. Lifecycle Scenarios (`backend/test/integration/e2e_full_lifecycle.test.ts`)

All ten scenarios use real Anvil, real MongoDB, real Express, and a programmatic signer.

| # | Scenario | What the test actually does | Result |
| :-- | :-- | :-- | :-- |
| 1 | Health/readiness | `GET /health/live` → 200 `LIVE`; `GET /health/ready` → 200 with `database: true, blockchain: true` | PASS |
| 2 | SIWE authentication | Session + CSRF → `POST /auth/challenge` → challenge signed by an Anvil signer (`signMessage`) → `POST /auth/verify` → authenticated wallet | PASS |
| 3 | Issuer authorization | On-chain `roles()` confirms the issuer. A random wallet completes SIWE, then `POST /issuance-drafts` → **403 `ISSUER_REQUIRED`** | PASS |
| 4 | Single issuance | Upload PDF → SHA-256 matches → `POST /issuance-drafts/:id/prepare` (unsigned tx, nothing on-chain yet) → signer broadcasts → receipt status 1 → `POST /issuance-drafts/:id/transaction` → 200 `CONFIRMED` / `SYNCED`; on-chain record matches digest and issuer | PASS |
| 5 | Verify original PDF | `POST /certificates/:id/verify-pdf` → `VALID`, `documentMatch: true`; `GET /certificates/:id/verification` → `VALID` | PASS |
| 6 | Verify modified PDF | One byte flipped → `MODIFIED`, `documentMatch: false` | PASS |
| 7 | Revocation | `POST /certificates/:id/revocation/prepare` → signer broadcasts → `POST /certificates/:id/revocation/transaction` → `CONFIRMED`; ID and PDF verification both → `REVOKED` | PASS |
| 8 | Unknown certificate | Unissued ID → 200 `UNKNOWN`, `confirmations: 0` | PASS |
| 9 | Unbroadcast draft and input validation | A prepared draft that is never broadcast has no on-chain state. A non-hex ID gives 400, and a non-PDF upload gives 415. **This test does not exercise wallet rejection or RPC failure**; see Section 4 for those. | PASS |
| 10 | Batch issuance | Two drafts → `POST /issuance-batches/prepare` (`issueBatch`) → one signed tx → `POST /issuance-batches/transaction` → `CONFIRMED`; both IDs `VALID` | PASS |

---

## 4. Failure-Path Coverage (added for Finding 7)

### 4.1 Backend, real Anvil + MongoDB + Express (`backend/test/integration/e2e_failure_paths.test.ts`)

| Failure path | How it is produced | Asserted behaviour |
| :-- | :-- | :-- |
| Wallet rejection (client never broadcasts) | Draft is prepared, then never sent | No chain state; verification `UNKNOWN`; draft can be prepared again |
| Unknown or dropped transaction hash | Random hash submitted for reconciliation | 202 `UNRESOLVED` / `NOT_FOUND_OR_DROPPED`; no metadata written |
| Pending transaction | Anvil automine disabled, tx broadcast | 202 `PENDING`; verification still `UNKNOWN`; after `evm_mine`, 200 `CONFIRMED` / `SYNCED` |
| Below confirmation threshold | `MIN_ISSUANCE_CONFIRMATIONS = 3` | 202 `CONFIRMATION_PENDING`, metadata not updated |
| Reverted transaction | Identical issuance re-broadcast with an explicit gas limit, so it is mined with status 0 | 409 `REVERTED`; existing record and metadata unchanged; still `VALID` |
| Transaction from wrong sender | Non-issuer broadcasts the prepared calldata (reverts) | 409 `TRANSACTION_MISMATCH`; no record |
| Reconciliation failure (database) | Tx confirmed on-chain, then Mongo `upsert` fails (**injected fault**: a proxy over the real store makes writes throw `DATABASE_UNAVAILABLE`) | 503 `CONFIRMED` + `RECONCILIATION_REQUIRED` + retry hash; verification stays `VALID` from chain; retry of the **same hash** → `SYNCED` |
| RPC outage | Production `createProvider` pointed at a port with no RPC server (connection refused) | `/health/ready` 503 (`blockchain: false`); verification 503 (never `UNKNOWN`/`INVALID`/`MODIFIED`); prepare and reconcile give 503 `RPC_UNAVAILABLE`; no metadata. After recovery, the same hash reconciles to `CONFIRMED` with no new transaction |
| Wrong network (backend) | Backend configured for chain 11155111 against Anvil 31337 | Verification and readiness give 503; prepared transactions pin `chainId` 31337 |

### 4.2 Frontend wallet boundary (`frontend/src/services/walletBoundary.test.ts`)

These tests use the **real ethers `BrowserProvider` / `JsonRpcSigner`** (as `WalletContext` creates them), `submitPreparedTransaction`, and the `useCertificateTransaction` hook. Only the injected EIP-1193 object (`window.ethereum`) is scripted. **They use no real wallet and no real chain.**

| Failure path | Asserted behaviour |
| :-- | :-- |
| User rejects in wallet (EIP-1193 `4001`) | ethers raises `ACTION_REJECTED`; hook ends `failed`, with no hash, no reconciliation, and no success state |
| Wallet on wrong network (`eth_chainId` ≠ 31337) | Refused; `eth_sendTransaction` is never requested |
| App state on wrong network | Refused before any wallet RPC |
| Wallet RPC failure (`-32603`, disconnected `4900`) | Submission rejects; no transaction hash |

### 4.3 Existing mocked frontend coverage (jsdom, mocked API)

`TransactionLifecycle.test.tsx`, `Issue.test.tsx`, `RevokeModal.test.tsx`, `Verify.test.tsx`, and `api.test.ts` cover the UI response to `PENDING`, `REVERTED`, reconciliation 503 with retry, API/network errors, receipt-polling failure, and registry-unavailable verification. The backend responses there are **mocked**; their shapes match those asserted for real in Section 4.1.

---

## 5. Known Limitations (not covered end to end)

1. **No real browser wallet.** MetaMask or other extension popups, account switching inside the extension, and the user's actual reject click are not automated. Doing this would need a browser-extension harness (for example Playwright with a wallet extension), which this project does not include.
2. **The React app is not driven against live services.** No test runs the built frontend in a browser against the real backend and Anvil. The UI ↔ API contract is tested on both sides separately (Sections 4.1 and 4.3), not in one connected run.
3. **Database reconciliation failure is fault-injected.** The chain and reads are real, but the write failure comes from a proxy rather than a real MongoDB outage.
4. **Chain reorganisations** are covered only at unit level (`chain.test.ts`, `indexer.test.ts`, `verification.test.ts`), not against a reorging node.
5. **No public network.** Nothing was deployed to Sepolia or mainnet.

---

## 6. Architectural and Safety Confirmations

1. **The backend never signs or broadcasts.** It holds no issuer or admin keys. Prepare endpoints simulate with `eth_call` and return unsigned calldata, and every broadcast in the tests comes from a client signer. The failure suite also checks that on-chain state is absent after prepare.
2. **Success is never premature.** Reconciliation accepts only a canonical receipt with status 1, matching sender, contract, calldata and events, and the required confirmations. `PENDING`, `CONFIRMATION_PENDING`, `UNRESOLVED` and `REVERTED` never write metadata or report success.
3. **The blockchain is authoritative.** Verification reads chain state. Missing or failed MongoDB metadata does not change a `VALID` result, and an RPC outage yields 503 rather than a false `UNKNOWN`/`INVALID`.

---

## 7. Test Inventory (results from the Finding 7 run)

| Suite | Command | Result |
| :-- | :-- | :-- |
| Contract (Foundry) | `cd contracts && forge test` | 49 passed |
| Backend unit | `npm run test:unit -w backend` | 80 passed (9 files) |
| Backend integration | `TEST_MONGODB_URI=… npm run test:integration -w backend` | 28 passed: anvil 6, mongo 3, lifecycle 10, failure paths 9. Run 10 times, all passed |
| Frontend (jsdom) | `cd frontend && npx vitest run` | 99 passed (8 files) |

**Test infrastructure fix.** Anvil 1.8.5 mines asynchronously. ethers' `tx.wait()` only reacts to blocks newer than its first poll, so a transaction mined in between could wait forever on an idle node. This caused intermittent `startAnvil()` hangs (about 1 in 10 runs). Integration tests now use a receipt-polling `mined()` helper (`backend/test/helpers/anvil.ts`) instead. This also cut the integration run from about 85 s to about 8 s.
