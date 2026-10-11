# Implementation and validation plan

Phase 0 proposal, 10 October 2026. Each phase requires explicit approval before work starts. At each gate: show the diff, explain decisions, report commands actually executed with outcomes, list limitations, and stop. Approval of one phase does not authorize later phases or a public deployment.

## Phase 0 — inspect and plan (current)

Deliverables: the four planning documents only, preserving existing work; repository/component design; contract and data models; wallet/auth/PDF semantics; threats; environment/deployment requirements; incremental acceptance gates.

Acceptance: inspect workspace/tool availability, identify assumptions and unverified prerequisites, ensure documents agree, and stop for review. No application tests are possible yet. Human architectural approval remains pending.

## Phase 1 — repository and local tooling

Deliverables: initialize Git if approved and still absent; create npm workspace skeleton and planned directories; add strict TypeScript/lint/format settings; minimal React/Vite/Tailwind shell and Express app factory/health routes; shared runtime config schemas; Foundry configuration and dependencies; local Mongo Compose configuration; placeholder environment examples; ignores before generated outputs. Do not implement certificate business logic or deploy contracts.

Select exact compatible versions at implementation time, retaining Node 24 if supported. Pin React/Vite/Tailwind, Ethers v6, Express, Mongoose, validation/auth libraries and test tools in the lockfile. Pin OpenZeppelin 5.x to an exact release/commit, a compatible Solidity compiler/EVM target, Foundry release and Mongo image tag/digest. Avoid floating `latest` references in reproducible setup.

Acceptance:

- Workspace install, TypeScript checks, lint and production skeleton builds execute successfully; shared package boundaries exclude backend code from the frontend.
- Configuration rejects missing, malformed and unsafe production values without leaking secrets. Backend tests cover valid readiness and dependency-failure behavior; do not add tests merely asserting placeholder markup exists.
- Local Mongo starts with a health check, loopback port mapping and persistent local volume; version and connection are verified. Docker availability must be confirmed first.
- Foundry tools report pinned versions and compiler/dependency resolution is checked without implementing the registry. Record what a build actually compiles: a “nothing to compile” result does not verify compiler/OpenZeppelin compatibility. If no compilation unit exists yet, mark that compatibility check deferred to Phase 2. Anvil starts on loopback and reports chain ID 31337. No registry deployment occurs in this phase.
- Record actual commands/results and stop for review. Missing tooling/network/permissions are reported as blockers, not passing checks.

## Phase 2 — smart contract and contract tests

Deliverables: immutable registry, issuer/admin authorization, single/batch issuance, revocation, views/events/custom errors, generated ABI export and tests. No frontend business flow yet.

Acceptance:

- Unit tests cover all interfaces/events, zero inputs, duplicate/revoked IDs, missing records, empty/mismatched/oversized batches and full batch rollback including duplicate entries.
- Caller matrix: admin without issuer role cannot issue; active issuer issues; issuer A cannot revoke B; removed issuer cannot issue/revoke; admin can revoke; regrant semantics match the architecture; unauthorized users cannot grant/remove roles.
- Test delayed admin transfer and delay changes, cancellation, inherited renunciation behavior and zero-address issuer protection; inspect the inherited ABI for bypasses.
- Fuzz/invariant tests verify immutable ID/digest/issuer, irreversible revocation, no unauthorized state changes and batch equivalence to successful single issues. Use multiple caller identities and a stateful handler that can exercise valid transitions.
- Execute `forge fmt --check`, `forge build`, `forge test -vvv`, `forge coverage` and `forge snapshot`; inspect critical branch coverage and maximum-size batch gas against the intended network's block gas budget with headroom.
- Keep the batch cap configurable during design/testing, starting with candidate 50. Measure worst-case fresh-record batches, record compiler/optimizer settings and block-gas headroom, then freeze the accepted contract constant and ABI after review. Verify the `MAX_BATCH_SIZE()` getter exposes the selected cap for later application use. Coverage numbers are diagnostic, not a substitute for the threat-based cases above. Stop for contract review.

## Phase 3 — local deployment and authoritative verification backend

Deliverables: user-invoked local deployment script, sanitized deployment manifest, read-only Ethers adapter, exact-byte PDF validation/hash service, public ID/PDF verification API and input/dependency error contracts. Deploy only to local Anvil within this approved phase.

Acceptance:

- Local deployment code hash, chain ID, constructor configuration and address match the manifest; ABI is exported from actual compiled artifacts.
- Vitest/Supertest tests use synthetic fixed PDFs with independently checked SHA-256 values, identical uploads, byte mutations, visually equivalent but byte-different files, unsupported/truncated PDFs, wrong MIME/extension, empty and 10 MiB boundary cases, streaming oversize and disconnect cleanup.
- Test exact 32-byte SHA-256 representation through Node → Ethers ABI → Solidity storage/events → Node, preserving leading zero bytes and rejecting malformed digest lengths. Verify that neither UTF-8 encoding of hex text nor Keccak-256 is substituted. These are future tests, not Phase 0 results.
- Real Anvil integration tests exercise valid ID, matching PDF, mismatched PDF, unknown, revoked, revoked plus mismatch and confirmation-pending outcomes. Disable automining for explicit unmined-transaction cases: pending issuance remains unknown on a successful mined-state read; pending revocation leaves the existing mined verdict unchanged; the transaction UI reports pending separately. ID-only output explicitly says no PDF was checked.
- Wrong chain/address/code, stale head, RPC outage, contract read revert/invalid ABI return and reorg/read races produce unavailable; malformed input is an input error. Test distinct `RPC_UNAVAILABLE`, `CONTRACT_CALL_FAILED` and `CONFIRMATION_PENDING` reason codes and ensure only successful absence reads produce unknown. MongoDB outage does not break public verification or turn a record unknown.
- No PDF bytes persist; hashing never uses a string conversion or normalizes files. No backend signer exists. Stop for API/verification review.

## Phase 4 — wallet authentication and private metadata

Deliverables: SIWE challenges, server sessions, CSRF/origin protections, Mongoose models/indexes, issuer/admin authorization, private drafts/metadata and profile APIs, request/resource limiting.

Acceptance:

- Execute signature, nonce expiry, atomic parallel replay, message-field tampering, wrong domain/URI/chain, unsupported-wallet and session rotation/logout/expiry tests.
- Supertest covers missing/bad CSRF, disallowed origins, unauthorized users, cross-wallet drafts/metadata, role removal during a session and RPC failure during authorization.
- Test with a real isolated MongoDB service for uniqueness, atomic nonce consumption and runtime expiry despite delayed TTL cleanup. Mocks alone are insufficient evidence for these behaviors.
- Public DTOs and errors never disclose private metadata, sessions or raw upload material; unexpected fields and Mongo operators are rejected.
- Draft/metadata reconciliation verifies canonical receipt, destination, event values and current record. Forged tx hints, already-issued IDs and chain-write/DB-failure cases are handled without false issuance success. Stop for authentication/security review.

## Phase 5 — public UI and single-certificate issuer/admin flows

Deliverables: responsive public verifier, wallet login, issuer single-issue/revoke screens, admin role/profile screens, transaction tracking and metadata management. Frontend writes use user-wallet Ethers signers.

Acceptance:

- React Testing Library covers all verdicts, form validation, pending/error states, accessible labels/focus and ID versus PDF copy; no color-only status communication.
- Wallet/network/account changes invalidate scoped auth; unsupported chain blocks writes. Show network, contract, certificate/digest and action before approval.
- Playwright drives real local API/Anvil/Mongo flows through a deterministic EIP-1193 test wallet adapter restricted to the test build; private test keys never reach production bundles. Separately perform and record a manual browser-wallet smoke test.
- Verify wallet rejection, reverted/replaced transactions, refresh while pending, database failure after successful mining, cross-issuer denial and admin recovery. A transaction hash alone never displays “issued.”
- A fresh browser without a wallet can verify publicly. Run frontend production build and inspect public environment exposure. Stop for interface review.

## Phase 6 — batches, event history and recovery

Deliverables: batch draft preview, bounded multi-file preparation, atomic batch writes and explicit multi-transaction chunks, event indexer, dashboard/history pagination and synchronization status.

Acceptance:

- Test discovery of the deployed `MAX_BATCH_SIZE()` rather than assuming 50, exact cap, cap+1 handling, duplicate IDs, one invalid member causing total transaction rollback, and low-gas/revert handling. Retry/replacement logic does not accidentally issue fresh IDs for already-mined records.
- Indexer tests cover duplicate delivery, restart from checkpoint, scan-range limits, transient RPC failures, reorg rollback beyond the overlap window, orphaned records and full rebuild after a local reset.
- History never reports stale indexed status as the current certificate verdict; simulated lag has a visible freshness marker. Direct contract issuance without metadata remains verifiable and discoverable in history.
- Run end-to-end single and batch issue → verify → modify → revoke → verify flows, plus issuer removal/regrant and database recovery. Stop for integration review.

## Phase 7 — hardening and reproducibility

Deliverables: CI, stable synthetic fixtures, integration/E2E harness, dependency/secret review, recovery documentation, environment and operational runbooks, measured resource limits.

Acceptance:

- Clean checkout can reproduce pinned installs, ABI generation, builds and the full suite. CI runs Foundry, backend unit/integration, frontend component tests and local-chain browser E2E with isolated service state.
- Test upload concurrency, chunked requests, rate limiting, stale/failed RPC, auth-store failure and no-PII logging. Audit application-specific custom errors and user messaging for false validity claims.
- Record test counts, coverage gaps, gas measurements, tool versions and any advisory exceptions. Scan Git content and built assets for secrets; no tests are called passed when skipped or unavailable.
- Verify the demo and teardown/reset procedure without destroying unrelated data. Use only synthetic student data. Stop for readiness review.

## Phase 8 — Sepolia (separate explicit approval)

Prerequisites: all earlier gates approved; user-controlled funded testnet deployment/admin/issuer wallets; verified target RPC/network; secrets provisioned outside Git; deployment parameters, code/ABI hashes and custody procedure reviewed. No credentials are needed in Phase 0.

Deliverables: explicitly approved Sepolia deployment, verified explorer source where supported, public manifest, HTTPS frontend/API configuration and documented testnet demo.

Acceptance:

- Confirm chain ID 11155111 through the chosen RPC and wallet, live network availability, compatible EVM/compiler settings, bytecode and constructor arguments. Reconfirm Sepolia suitability at this later phase rather than assuming today's network lifecycle.
- Deployment is signed by a user-controlled keystore/hardware wallet; there is no backend signing secret. Grant issuer roles explicitly with the admin wallet, and test the configured admin-transfer process safely.
- Execute synthetic single/batch issuance, all verification verdicts, issuer administration, revocation and history against the deployed registry. Save actual transaction hashes and checked blocks; do not imply a two-block confirmation threshold is finality.
- Verify HTTPS cookies, domain/URI SIWE binding, production resource limits, no secrets in bundles/logs, explorer/source verification status and RPC outage behavior.
- Clearly label the deployment as a college testnet demonstration, list unresolved risks, and stop. Mainnet is outside scope.

## Environment variable contract

The following names/defaults are proposed, not existing configuration. Validate configuration at startup. Keep public deployment facts in one manifest; backend and frontend consume the same sanitized values rather than maintaining independent contract addresses.

| Variable | Consumer / proposed local value | Sensitivity and rule |
| --- | --- | --- |
| `NODE_ENV` | Backend/frontend tooling: `development` | Production activates strict transport/security requirements |
| `HOST`, `PORT` | Backend: `127.0.0.1`, `3001` | Production binding explicitly set by deployment |
| `APP_ORIGIN` | Backend: `http://localhost:5173` | Exact expected web origin; also governs CSRF/CORS |
| `MONGODB_URI` | Backend: `mongodb://127.0.0.1:27017/certificates_local` | Server-only; real credentials are secret |
| `TEST_MONGODB_URI` | Test runner: separate `certificates_test` database | Guard destructive test cleanup against non-test DBs |
| `RPC_URL` | Backend/CLI: `http://127.0.0.1:8545` | Server-only; provider URL may contain a secret token |
| `CHAIN_ID` | Backend/scripts: `31337`; later `11155111` | Must match RPC and manifest; fail closed on mismatch |
| `DEPLOYMENT_MANIFEST_PATH` | Backend/scripts: `deployments/31337.local.json` | Contains chain, address, deploy tx/block/hash, runtime code hash, ABI hash and deployment ID; absent before Phase 3 |
| `MIN_ISSUANCE_CONFIRMATIONS` | Backend/indexer: `1`; Sepolia proposal `2` | Positive integer; not a guarantee of finality |
| `RPC_TIMEOUT_MS` | Backend: `5000` | Bounded retries inside overall request deadline |
| `MAX_HEAD_AGE_SECONDS` | Backend: `0` on idle Anvil; `120` proposed on Sepolia | Zero permitted only for local development/test |
| `INDEXER_POLL_MS`, `INDEXER_REORG_OVERLAP` | Indexer: `3000`, `12` | Roll back deeper when ancestry does not match |
| `SESSION_SECRET` | Backend: generated locally when implemented | At least 32 random bytes; no real value in example files |
| `SESSION_TTL_SECONDS`, `SIWE_NONCE_TTL_SECONDS` | Backend: `28800`, `300` | Validate absolute expiry in code |
| `SIWE_DOMAIN`, `SIWE_URI` | Backend: `localhost:5173`, `http://localhost:5173` | Exact canonical values consistent with APP_ORIGIN |
| `COOKIE_SECURE` | Backend: `false` locally; `true` for HTTPS | Reject false in production |
| `TRUST_PROXY_HOPS` | Backend: `0` locally | Set only for known reverse-proxy topology |
| `MAX_PDF_BYTES`, `REQUEST_TIMEOUT_MS` | Backend: `10485760`, `30000` | Enforced during streaming, not only by headers |
| `MAX_CONCURRENT_UPLOADS` | Backend: `4` | Also cap per client at 2; separate from max file bytes |
| `AUTH_RATE_PER_MIN`, `UPLOAD_RATE_PER_MIN`, `READ_RATE_PER_MIN` | Backend: `10`, `10`, `60` | Initial per-IP caps; also per-wallet for protected endpoints |
| `DRAFT_TTL_SECONDS`, `LOG_RETENTION_DAYS` | Backend/operations: `86400`, `7` | Cleanup and redaction tests required |
| `VITE_API_BASE_URL` | Frontend: `/api/v1` | Public; prefer same origin |
| `VITE_CHAIN_ID`, `VITE_CONTRACT_ADDRESS` | Frontend: generated from selected manifest after Phase 3 | Public; chain/deployment mismatch blocks write |
| `VITE_DEPLOYMENT_ID` | Frontend: generated from manifest | Public reset/redeployment namespace |
| `DEPLOY_RPC_URL` | Operator CLI only: local RPC or later Sepolia RPC | May contain a secret; do not print |
| `INITIAL_ADMIN_ADDRESS`, `ADMIN_TRANSFER_DELAY_SECONDS` | Deployment: explicit wallet, `60` local / `172800` Sepolia | Public constructor parameters, reviewed before deployment |
| `DEPLOYER_ACCOUNT` | Operator CLI: encrypted keystore alias | Alias only; password entered interactively, not in env/source |
| `ETHERSCAN_API_KEY` | Optional operator/verification CI only, Phase 8 | Secret; never frontend/backend runtime dependency |

No backend or frontend private-key variable is permitted. Public frontend RPC access is through the user's wallet for writes; server verification uses `RPC_URL`. Pre-contract Phase 1 configuration deliberately has no deployment manifest and must not expose a misleading verification service. Later phases require a verified manifest before enabling chain-dependent features.

## Local development and testing workflow

Once implemented: run MongoDB and Anvil bound to loopback, deploy the local contract in Phase 3, export ABI/manifest, then start backend, frontend and (from Phase 6) indexer. The Vite proxy routes `/api` to the backend. Use distinct admin/issuer/verifier identities and only synthetic PDFs. Restarting persistent Anvil preserves deployment state only when deliberately configured; otherwise regenerate the local manifest and namespace on reset.

Separate fast unit tests from real-service integration and browser tests. Integration/E2E runners own isolated test databases, chain instances and ports; do not reset a developer's active node or Mongo volume. CI generates artifacts containing redacted logs, actual results and Playwright traces on failure. Wallet extension testing is an additional manual check, not implied by a test adapter passing.

Planned root scripts: `dev`, `build`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `abi:export`, `abi:check`, `chain:local`, `deploy:local`, `indexer:dev`. Add each script when its phase introduces the capability; do not create success-returning placeholders for absent tests.

## Commands for the next phase

**Reference only: none of the following setup/install/build commands ran in Phase 0.** Phase 1 approval is required before executing them. Missing Foundry requires installation following the [official Foundry installation guide](https://getfoundry.sh/getting-started/installation); choose a pinned release and review its installer before running it. No package or installer is downloaded now. Vite's [setup requirements](https://vite.dev/guide/) must be checked against the chosen release when pinning Node and frontend tooling.

Foundry prerequisite checklist for the approved setup phase:

1. Recheck existing installation and PATH before installing; this review found `foundryup`, `forge`, `cast` and `anvil` absent from PATH, not necessarily absent from disk. Confirm macOS/CPU architecture and a matching release artifact.
2. Prefer official prebuilt binaries through the reviewed Foundryup workflow. Check HTTPS access to release/dependency/compiler downloads and permission to write the installation/cache locations. Check installer prerequisites such as `curl`, Git and archive/verification utilities then; their readiness is not established here. Rust/Cargo is only needed if deliberately choosing a source build, not as an extra prerequisite for prebuilt Foundry.
3. Select an exact stable Foundry release rather than an unpinned latest/nightly, retain integrity/provenance verification, and record the resolved versions. Consult the selected installer's help for version-selection flags; do not assume all Foundryup releases have identical CLI behavior. See the [official Foundryup repository](https://github.com/foundry-rs/foundryup).
4. Make the installation's binary directory (normally `~/.foundry/bin`) visible to the zsh session, then verify actual paths and `forge`, `cast`, `anvil` versions. Do not overwrite shell configuration or an existing installation without reviewing it.
5. Pin Solidity in `foundry.toml` and compatible OpenZeppelin/forge-std releases plus remappings. Foundry can manage the selected compiler; a standalone global `solc` executable is not required. The first compilation may download that compiler, so it is not an offline guarantee. See [Foundry compiler configuration](https://getfoundry.sh/reference/config/solidity-compiler).
6. Check loopback port 8545 availability, start Anvil only in the approved setup phase and verify chain ID 31337. A version check, a no-op build and a running node are distinct from compiled contract tests; report each accurately. Docker is a separate MongoDB prerequisite, not required for the proposed native Foundry setup.

Initial read-only checks after approval:

```sh
git --version
node --version
npm --version
docker version
docker info
forge --version
cast --version
anvil --version
```

`foundryup`, `forge`, `cast` and `anvil` remain unavailable on PATH as rechecked during this documentation review; their version checks will not succeed until installed/configured. Installation paths, release downloads, compiler/dependency compatibility and Docker daemon availability are unverified.

After authoring the Phase 1 manifests/configuration (these commands are not runnable against the planning-only workspace):

```sh
git init
npm install
npm run typecheck
npm run lint
npm run build
npm run test:unit
docker compose config --quiet
docker compose up -d mongo
docker compose ps
forge build --root contracts
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

The initial `npm install` creates the reviewed lockfile; subsequent clean installations use `npm ci`. Install pinned Foundry/OpenZeppelin dependencies according to the selected configuration before `forge build`; exact versions/commands are intentionally deferred to Phase 1. Anvil is a foreground service; in another terminal verify `cast chain-id --rpc-url http://127.0.0.1:8545`. No `forge script --broadcast`, private-key command or contract deployment belongs in Phase 1.

Later phase checks, only after their scripts/tests exist:

```sh
forge fmt --check --root contracts
forge test --root contracts -vvv
forge coverage --root contracts
forge snapshot --root contracts
npm run abi:check
npm run test:integration
npm run test:e2e
```

## Phase 0 evidence, assumptions and open risks

Executed: directory listing/file discovery, ancestor instruction checks, `git status` (reported no Git repository), PATH/version checks for the tools recorded in README, and official documentation lookup. A Node.js documentation check passed: exactly the four requested planning files exist, local Markdown file/anchor links resolve, and fenced code blocks are balanced. Planning coverage and cross-document decisions were also reviewed. No application tests, builds, installations or deployments ran.

Assumptions requiring architectural review: npm workspace layout; one platform admin with multiple university issuer wallets; active original issuer plus admin emergency revocation; EOA-only dashboard authentication initially; candidate batch cap 50 pending gas validation; 10 MiB PDF cap; PDF verification requires ID; no default PDF storage or certificate expiry; optional private metadata; issuer removal preserves historical certificates.

Unverified: Docker daemon/MongoDB operation, browser wallet availability, Foundry installation and CLI flag compatibility, exact dependency/compiler compatibility, maximum batch gas, performance/resource limits, RPC provider behavior, reorg tests, Sepolia availability/funding/source verification and real-world university onboarding. All are assigned to later gates. No credentials, funding or deployment permissions are requested now.

**Stop here after Phase 0. Await explicit approval before implementing Phase 1.**
