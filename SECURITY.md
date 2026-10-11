# Security design

Phase 0 threat model, 10 October 2026. These are planned controls and tests, not claims that the unimplemented system is secure or audited. [ARCHITECTURE.md](ARCHITECTURE.md) defines the exact permissions and verification outcomes.

## Security goals and limits

- Only an authorized issuer wallet can issue. Revocation requires the active original issuer; the platform admin cannot revoke by virtue of the admin role. Revocation is irreversible and preserve the original digest/issuer. Removing an issuer does not revoke its existing certificates.
- Certificate identity, digest and original issuer cannot be overwritten or reused after revocation.
- Public verification reads the configured contract and never substitutes metadata or indexed status for chain state.
- No private student fields, PDF bytes or private file links go into contract storage, calldata or events.
- The backend cannot sign transactions. Authentication proves wallet control, not permission to issue for another wallet.
- Upload handling has bounded work and hashes the exact accepted bytes.
- Dependency failures are distinguishable from certificate verdicts; reported success is supported by executed checks.

Trust assumptions: the administrator vets universities outside the blockchain; issuer wallets control what they attest; the selected RPC supplies honest chain data; the application origin serves trustworthy frontend code; the user's browser/wallet and host are not compromised. A valid digest does not establish the truth of the certificate's claims or the holder's identity. Wallet addresses, opaque IDs, digests and transaction timing remain public and linkable.

## Threats and mitigations

| Threat / boundary | Planned mitigation | Required evidence / remaining risk |
| --- | --- | --- |
| Unauthorized issuance or role escalation | OpenZeppelin issuer role on every write; admin alone grants/removes issuers; no client-provided issuer override | Foundry tests for every caller class and inherited role path; compromised admin can still admit malicious issuers |
| Revoking another university's certificate | Require the active original issuer; verify ownership in contract | Cross-issuer, removed-issuer and admin-cannot-revoke tests (unit, fuzz, invariant) |
| Duplicate/reused ID or partial batch | Nonzero random IDs, immutable record existence check, atomic bounded batch | Fuzz duplicate IDs including within batch and revoked records; assert no partial events/state on revert |
| Compromised issuer or malicious certificate content | Remove role promptly, inspect its public event history, individually revoke affected certificates | Blockchain cannot determine academic truth; role removal does not retroactively revoke records |
| Lost or compromised admin | Delayed two-step transfer, explicit UI review, documented key custody/recovery | Delay protects transfer process, not an already compromised admin's immediate role/revocation powers; no guaranteed lost-key recovery |
| Front-running a visible random ID | Random IDs until publication, compare final issuer/digest after mining, reject duplicate IDs | Another authorized issuer can occupy a seen ID; collision is detected, not silently accepted; reissue with a new ID and finalized PDF if needed |
| Authentication replay or substituted SIWE scope | Server-generated nonce/message, exact domain/URI/chain checks, browser binding, expiry and atomic consume | Concurrent replay, altered fields, future/expired message and incorrect signer tests |
| CSRF, session theft/fixation | HttpOnly/Secure/host-only cookies, SameSite, rotation, server-side invalidation, synchronizer token and Origin checks | Cross-origin, missing-token, logout and expiry tests; XSS can still act within a user's live browser |
| Stale API roles or IDOR | Current on-chain roles and owner checks per protected request; no client role fields | Remove role during a session, cross-wallet draft/metadata access and direct API tests |
| Database tampering/fabricated metadata | Treat database as supplementary, allowlisted DTOs, verify receipt and contract before reconciliation | Seed forged DB status and compare real contract results; a database admin can still alter private off-chain data |
| Fake tx receipt / wrong deployment | Validate configured chain, contract code hash, successful receipt, matching logs/state and canonical block | Wrong-chain, wrong-contract, unrelated-event and replaced/reverted receipt tests |
| RPC outage, failed contract read, stale data or reorg | Timeouts, bounded retries, latest pinned block with hash recheck, explicit unavailable, no DB/cache fallback | Test transport errors, read reverts, invalid ABI data and reorgs; only successful absence reads mean unknown; one RPC can lie consistently |
| Pending transaction presented as completed state | Keep transaction progress separate from mined certificate state; no issuance/revocation success on submission | Test unmined issuance, mined-but-unconfirmed issuance and pending revocation; a pending revocation may still leave the current record valid |
| Index lag or orphaned events | Replayable index with hashes, checkpoints, rollback, unique indexes and freshness labels | Duplicate scans, restart, reorg and DB outage tests; history availability is separate from certificate validity |
| Oversized/slow uploads and request flooding | Stream byte caps, 30-second deadline, aggregate/concurrency limits, rate limits, bounded fields | Missing/false Content-Length, chunked uploads, disconnect and simultaneous-request tests |
| Forged MIME/extension, active or malicious PDF | Layered narrow file admission; no execution, rendering, extraction or long-term file storage | Reject obvious invalid files; signature checks are not antivirus or full structural validation |
| Hash mismatch caused by transformations | Hash exact file bytes, distinguish byte identity from visual similarity | Fixed binary fixtures, cross-check SHA-256 vectors, same-view/different-bytes and one-byte mutations |
| XSS / injection / path traversal | React text escaping, CSP, request schemas and field allowlists, no raw HTML or client Mongo operators; never trust filenames as paths | Metadata/filename payload tests, prohibited-field tests and browser checks |
| Secrets in Git/build/logs | Ignore environment/keystore/broadcast secrets before setup, placeholder examples, secret scanning, public-only frontend config | Inspect source, lockfile changes, production bundle and logs; rotate immediately if exposed |
| Dependency/compiler drift | Pin JS lockfile, OpenZeppelin release/commit, Foundry/compiler/EVM versions and Mongo image; review advisories | Reproducible build and review of audit findings before testnet; tests are not an external audit |
| Privacy leakage | Minimal metadata, issuer-only access, no PDF retention, redacted logs, deletion path, synthetic demos | Inspect public APIs/events/logs and permissions; SHA-256 commitments can be correlated if someone already has the PDF |

The upload policy follows layered validation and resource restrictions rather than trusting a browser's content type alone; see the [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). This project adds the constraint that admitted bytes must remain unchanged for digest comparison.

## Operational controls

### Wallets and secrets

- Use separate admin and issuer wallets in demonstrations. Never reuse Anvil development wallets on a public network or fund them with real assets.
- Users sign writes through their browser wallet. Deployment later uses a user-controlled encrypted Foundry keystore or hardware wallet, with interactive unlocking. The API service never receives these keys.
- Do not create a backend `PRIVATE_KEY`, `MNEMONIC` or signing-key configuration option. Do not put secrets in any `VITE_*` variable; those values are public build inputs.
- Database credentials, RPC provider tokens and session secrets remain server-side and outside version control. Example files contain placeholders only; never print effective secret configuration.
- Avoid secrets in shell arguments, command history, screenshots and recorded demos. Ignore keystores, real environment files, local chain state and raw deployment broadcast output; export a sanitized public deployment manifest instead.

### HTTP, storage and resource policy

- Production uses HTTPS, same-origin API routing, a restrictive CSP and security headers. Credentialed CORS, if later needed, permits exact configured origins only, never a wildcard. Trust proxy headers only from the known reverse proxy.
- Suggested starting limits: auth 10 requests/minute/IP, PDF uploads 10/minute/IP, public reads 60/minute/IP; authenticate upload preparation and also limit per wallet. Return 429 with retry guidance. Load testing may change these before testnet.
- Single-instance college deployment may use bounded in-process rate/concurrency limits; document that replicas need a shared limiter before scaling. Cap concurrent uploads at 4 per process and 2 per client initially. Stream aborts must free resources.
- Keep MongoDB and Anvil on loopback for local development. Production MongoDB is private, authenticated and encrypted in transit; backend credentials have only the needed database privileges.
- No PDF files in MongoDB/GridFS, logs, analytics, caches or disk. Transient server processing still exposes file contents to the server during a request; tell users this before upload. A later browser-side hashing mode could reduce this exposure, but is not required now.
- Private metadata is optional and deletable by its authorized issuer. Delete expired drafts after 24 hours, challenges after 5 minutes and sessions after 8 hours; enforce expiry even before TTL deletion. Operational logs retain 7 days by default and omit upload bytes, filenames, student fields, cookies, tokens and signatures.
- Public chain commitments/events cannot be deleted. Random identifiers and digests are not encryption or guaranteed anonymity. Deleting metadata does not remove chain history. Backups, if enabled later, require an explicit retention and deletion policy before real student data is used.

## Failure and incident behavior

1. **Issuer compromise:** admin removes its role using the admin wallet, reviews issuance events, and grants a replacement wallet only after off-chain verification. Historical ownership is not transferred automatically. **Limitation:** there is no admin revocation, so certificates issued by a removed or compromised issuer wallet cannot be revoked on-chain unless that same wallet is re-granted the role and revokes them; affected IDs must be handled off-chain (e.g. published notices).
2. **Admin compromise/loss:** use the available admin transfer path only if a trustworthy admin still controls it. If recovery is impossible, retire the deployment, visibly publish a new manifest and migration policy, and never silently reinterpret old IDs under a new registry.
3. **RPC failure:** public verification becomes unavailable; protected writes in the API fail closed. A previously displayed result remains labeled with its old block, and must not be presented as current.
4. **MongoDB failure:** private metadata/auth/history may be unavailable, but stateless public chain verification can continue. A successful contract transaction is not rolled back by a database error.
5. **Reorg/reset:** invalidate orphaned projections, reconcile pending transactions and rebuild events. Anvil reset requires new deployment identity and cleared environment-scoped sessions/drafts.
6. **Secret exposure:** revoke/rotate the affected credential; removing it from the newest Git commit is insufficient. Assess exposed data and wallet actions before continuing.

## Review gates

Before Sepolia, execute adversarial contract and API tests, browser flows, replay/CSRF checks, rate/upload limit checks, reorg/outage recovery, dependency review and secret/bundle inspection. Record commands and actual results, including skipped/blocked checks. No security audit, live dependency compatibility, gas-limit suitability or deployment readiness was verified during Phase 0.
