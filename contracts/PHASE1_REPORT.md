# Phase 1 contract review report

Completed 10 October 2026. Scope follows the user's latest instruction: smart contracts only, overriding the initial roadmap's phase numbering. Phase 2 has not started. No backend, frontend, wallet authentication, MongoDB integration or public-network deployment was implemented.

## Files and design

Created:

- Root `.gitignore`: excludes secrets, vendored dependencies, build/cache/broadcast files and temporary local evidence.
- `contracts/foundry.toml`, `contracts/remappings.txt`: explicit compiler, optimizer, EVM and test settings.
- `contracts/src/CertificateRegistry.sol`: issuer roles, single/batch issuance, lookup/digest comparison and irreversible revocation.
- `contracts/script/DeployLocal.s.sol`: chain-31337-only deployment with explicit admin and configurable transfer delay, default 60 seconds.
- `contracts/scripts/deploy-local.sh`: fixed loopback RPC wrapper with chain check and unlocked local-account signing; no keys.
- `contracts/scripts/install-deps.sh`: exact release-tag restoration for the two required contract dependencies.
- `contracts/scripts/local-smoke.mjs`: isolated Anvil receipt/encoding/rollback/gas harness, using only Node built-ins.
- `contracts/test/CertificateRegistry.t.sol`: 39 unit/fuzz tests.
- `contracts/test/CertificateRegistry.invariant.t.sol`: independent state model and seven stateful actions.
- `contracts/test/CertificateRegistry.gas.t.sol`: single and batch gas benchmarks.
- `contracts/test/DeployLocal.t.sol`: deployment configuration and nonlocal-chain rejection tests.
- `contracts/.gas-snapshot`, `contracts/snapshots/issuance.json`: whole-test and isolated-frame snapshots, respectively; neither should be confused with the separately measured local receipts.
- `contracts/gas-report.json`: actual local receipt measurements and compiler settings.
- `contracts/README.md`, this report: reproducible commands, permissions and evidence.

Modified root README status/next-step links and the architecture's contract comparison-view entry only. `SECURITY.md` and `IMPLEMENTATION_PLAN.md` were left unchanged. No Git repository was initialized. Dependencies were downloaded under ignored `contracts/lib/`; generated build artifacts, broadcast data and local logs are ignored.

The registry inherits OpenZeppelin `AccessControlDefaultAdminRules`: a single default admin with delayed two-step transfer. No automatic issuer grant. Active issuer wallets issue and ordinarily revoke only their own records; admin emergency revocation needs no issuer role and works after issuer removal. Both paths are irreversible. Removing an issuer preserves every existing certificate; regrant restores that wallet's original-owner revocation ability. Admin renunciation keeps the inherited dangerous-but-explicit scheduled behavior.

`documentHash` is the exact SHA-256 digest in `bytes32`, passed as 0x-prefixed 64-digit hex without rehashing. The registry cannot establish the origin of a supplied digest. No private student data, PDFs, filenames or URLs are stored or emitted. IDs cannot be overwritten or reused after revocation. Batches are atomic and bounded at candidate 50, with no runtime cap setter.

`getCertificate` returns existence plus record fields for ID-only checks. `verifyCertificate` returns mined-state Unknown/Valid/Modified/Revoked with revocation precedence over mismatch. Pending confirmations and RPC errors remain outside the contract; no offline result is manufactured as an on-chain enum value.

## Actual toolchain and execution

- `forge`, `cast`, `anvil`: **1.8.5**, commit `51a52c59cffd940f76eddd0b4bb1791aa4b5ac7f`.
- Binaries were executable at `/Users/prakashkumar/.foundry/bin/`; they were absent from the initial shell PATH. No persistent shell configuration was changed.
- Node.js **v24.18.0**, npm **11.16.0**; no npm dependency installation.
- OpenZeppelin Contracts **v5.7.0**, forge-std **v1.17.0**, locally installed with `--no-git`.
- Configured and actually used compiler: **0.8.30+commit.73712a01**, confirmed by compiler output and compiled artifact metadata.
- Production compiler settings: **Cancun, optimizer enabled, 200 runs, via-IR disabled**. `forge build --force` compiled 37 Solidity files successfully; this was not a no-op build.

Commands below ran from `contracts/` using the explicit Foundry binary path (shown as `$HOME/.foundry/bin` for portability):

```sh
"$HOME/.foundry/bin/forge" --version
"$HOME/.foundry/bin/cast" --version
"$HOME/.foundry/bin/anvil" --version
"$HOME/.foundry/bin/forge" install --no-git OpenZeppelin/openzeppelin-contracts@v5.7.0 foundry-rs/forge-std@v1.17.0
"$HOME/.foundry/bin/forge" fmt
"$HOME/.foundry/bin/forge" fmt --check
"$HOME/.foundry/bin/forge" build
"$HOME/.foundry/bin/forge" build --force
"$HOME/.foundry/bin/forge" test -vvv
"$HOME/.foundry/bin/forge" coverage --report summary
"$HOME/.foundry/bin/forge" snapshot --match-contract CertificateRegistryGasTest
node scripts/local-smoke.mjs
```

## Results and failures encountered

- Final full Foundry suite: **49 passed, 0 failed, 0 skipped**, across four suites. Four fuzz tests each run 256 cases. The invariant test runs 128 sequences of depth 64: **8,192 handler calls, 0 unexpected reverts**.
- The first full suite failed **21 of 49 tests**. SHA-256 precompile calls in test argument evaluation consumed one-shot prank/revert expectations; process-global environment mutation also raced between parallel deployment tests. Fixed by precomputing digest arguments/literals and injecting deployment configuration through a test harness. No access-control rule was relaxed to make tests pass.
- Formatting and forced compilation passed. Gas snapshot suite: **5 passed**. Cached compilations skipped by subsequent test/script commands were not used as compilation evidence.
- Coverage execution passed all 49 tests and reported registry line **39/39**, statement **48/48**, branch **12/12**, function **8/8** coverage. The deployment script reported 10/12 lines; the live harness separately exercises environment loading.
- Coverage disables optimizer settings for instrumentation and emitted source-map/anchor warnings. These percentages are diagnostic, not proof of complete path coverage or an audit. Gas values from coverage instrumentation are not used in the receipt table.
- Forge's lint warns about `revert` in the issuance loop. This is intentional: any invalid batch member must roll back the entire transaction. Ordinary successful builds also warned that the sandbox could not write the optional global signature cache; compilation and tests still exited successfully.
- Dependency setup initially failed using relative `--root contracts` in the non-Git workspace, then failed on sandbox-blocked GitHub DNS. Running from `contracts/` with approved network access succeeded. The initial compiler-cache access and loopback socket binding were also sandbox-blocked; approved retries succeeded. An exploratory standalone `~/.svm/...` compiler lookup found no binary there; actual compilation and artifact metadata above establish the compiler used.
- Local Anvil deployment and receipt checks passed: exact SHA-256 bytes with a leading zero survived calldata, storage and events; match/mismatch/unknown/revoked states agreed; a mined reverted batch persisted **zero logs and zero new records**; issuer removal preserved an existing certificate and admin emergency revocation worked afterward.

## Measured issuance gas

Actual transaction `gasUsed` from an isolated Anvil **Cancun** node, chain ID **31337**, explicit **30,000,000** block gas limit, fresh certificate slots and an already-authorized issuer. These values include transaction intrinsic/calldata costs. No public RPC was used.

| Operation | Records | Receipt gas |
| --- | ---: | ---: |
| Individual issuance | 1 | 94,125 |
| Batch issuance | 1 | 95,397 |
| Batch issuance | 10 | 730,028 |
| Batch issuance | 25 | 1,787,744 |
| Batch issuance | 50 | 3,550,658 |
| Batch, fully nonzero ID/digest calldata | 50 | 3,550,826 |

The dense 50-record case consumes about **11.84%** of the configured local block limit, below the harness's 50% budget assertion. Retain 50 for this local build; do not treat it as a public-network guarantee. The dense digest bytes are a synthetic worst-case calldata benchmark, not a claim about a real PDF. No gas price/fee estimate is promised by these measurements.

The harness stops its own Anvil process in cleanup. Its ephemeral address is not a maintained deployment. `gas-report.json` retains nonsecret measurement evidence; raw receipts and logs are under ignored `.local/` and `broadcast/` directories.

## Remaining risks and next review

- Phase 2 requires explicit user approval and a confirmed scope; the root roadmap retains its original numbering.
- No backend/Ethers integration or PDF validator has been built. Node-to-Cast-to-contract byte encoding was tested; the future Ethers path still needs its own tests.
- Real-world issuer onboarding, admin/issuer wallet custody, RPC trust, confirmation/reorg handling, indexing and metadata privacy remain later-layer work. An authorized malicious issuer can commit to a false claim; the contract cannot determine academic truth.
- Public-network compiler/hardfork compatibility, gas policy, funding and deployment/source verification are untested. No Sepolia or other public-network deployment occurred. Review dependencies/advisories and obtain a separate deployment approval before that work.
- No external security audit was performed. Full reported source coverage does not remove the coverage instrumentation warnings or establish production readiness.
- Git initialization and the application's remaining workspace setup were intentionally not performed in this contract-only scope.

**Stop: awaiting review and explicit approval before Phase 2.**
