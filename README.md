# Blockchain-Based Smart Contract System for Secure Certificate Verification

**Status: Phase 1 — smart-contract layer implemented; review pending.** The latest approved scope supersedes the original phase numbering: contracts, Foundry tests and local-only deployment tooling are implemented. Backend/frontend work has not started. See [the Phase 1 report](contracts/PHASE1_REPORT.md) and [contract commands](contracts/README.md).

This college project will let authorized universities register certificate digests on Ethereum, let anyone check a certificate ID or compare a PDF with its registered digest, and let authorized wallets revoke certificates. The blockchain is authoritative for issuance and revocation; MongoDB supplies optional metadata and searchable history.

A successful check establishes that a registered issuer committed to these bytes and that the certificate is not revoked at the reported block. It does not independently prove academic achievement, ownership of the document or the real-world legitimacy of the university.

## Planning documents

- [ARCHITECTURE.md](ARCHITECTURE.md): repository layout, contract interface, records, authentication, API and verification rules.
- [SECURITY.md](SECURITY.md): trust boundaries, threats, controls, residual risks and incident response.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): review gates, acceptance criteria, test commands, environment configuration and deployment prerequisites.

## Planned scope and stack

| Area           | Choice                                                                                 |
| -------------- | -------------------------------------------------------------------------------------- |
| Repository     | npm workspaces; `contracts/`, `backend/`, `frontend/`, `packages/shared/`              |
| Blockchain     | Solidity, pinned OpenZeppelin Contracts 5.x, Foundry/Forge, Anvil first; Sepolia later |
| Frontend       | React, TypeScript, Vite, Tailwind CSS, Ethers.js v6                                    |
| Backend        | Node.js 24 baseline, Express, TypeScript, Ethers.js read-only provider                 |
| Storage        | MongoDB, Mongoose; no PDF retention by default                                         |
| Hashing        | Node.js `crypto` SHA-256 over exact PDF bytes                                          |
| Authentication | Sign-In with Ethereum (SIWE), server-side sessions, live on-chain role checks          |
| Testing        | Foundry, Vitest, Supertest, React Testing Library, Playwright                          |

Contract dependencies and compiler versions are pinned in [the contract setup](contracts/README.md); full-stack dependencies remain uninstalled. Planned full-project scope includes issuer administration, single and atomic batch issuance, ID/PDF verification, revocation, transaction history and admin/issuer dashboards. There is no token, NFT, proxy upgrade, paid transaction relayer, PDF storage service or backend signing wallet.

## Key decisions for review

1. Wallets sign every issuance, revocation and role-management transaction. Logging into the API never gives the backend signing power.
2. Certificates have random, non-personal `bytes32` IDs; a deployment and ID identify a certificate. The document digest is a separate `bytes32` containing the exact 32 SHA-256 bytes, transported as `0x` plus 64 hex digits. Records are immutable except for one-way revocation.
3. Verification by ID checks registration and status only. Verification by PDF requires the ID as well, and checks byte equality. The UI explains the difference.
4. Results distinguish `valid`, `unknown`, `modified`, `revoked` and `unavailable`; invalid input is a separate API error. RPC outages and failed contract reads mean `unavailable`, never `unknown`. Pending transactions are tracked separately and do not establish issuance or revocation.
5. An active issuer issues certificates and can revoke only its own. The platform admin manages issuers but cannot revoke certificates by virtue of the admin role. Revocation is irreversible. Removing an issuer blocks subsequent issuer actions but does not invalidate past certificates automatically.
6. PDF uploads are transient and accept one file of at most 10 MiB per request. No PDF contents or private student information go into on-chain storage, calldata or events. Student metadata is private by default and unnecessary for public verification.
7. The compiled local batch cap is 50, supported by Phase 1 measurements. It remains provisional for public deployment until target-network gas validation and review; future clients must use the contract's cap getter.

## Workspace inspection — 10 October 2026

The workspace was empty, with no Git repository, application files or applicable `AGENTS.md` found in the workspace or inspected ancestor paths. Only these four Markdown planning files were created.

| Tool                             | Observed                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| Git                              | `2.54.0 (Apple Git-157)`                                      |
| Node.js                          | `v24.18.0`                                                    |
| npm                              | `11.16.0`                                                     |
| pnpm                             | `11.25.0`; available, but npm is the proposed package manager |
| Docker CLI                       | `29.7.2`; daemon and image availability not checked           |
| `forge`, `cast`, `anvil`, `solc` | Not found on PATH                                             |
| `mongod`, `yarn`                 | Not found on PATH                                             |

Read-only shell inspection, file editing and official web documentation lookup were available. No credentials were requested. No package installation, Git initialization, service startup, deployment or application test was performed. Absence from PATH does not establish absence everywhere on the machine.

## Next phase

Review [the Phase 1 report](contracts/PHASE1_REPORT.md) before approving further work. The earlier [implementation plan](IMPLEMENTATION_PLAN.md) remains the historical full-project roadmap; its original Phase 1 scaffolding scope is superseded by the user's contract-only Phase 1 instruction. No Phase 2 implementation is authorized yet.

Every subsequent phase ends with a review of changes, commands actually executed, test results and remaining limitations. Work then stops until the next phase is explicitly approved.
