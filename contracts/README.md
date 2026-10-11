# CertificateRegistry — Phase 1 contract layer

This is the smart-contract-only Phase 1 requested after architectural approval. It supersedes the earlier phase numbering in the root implementation plan; it does not authorize backend/frontend development. See [PHASE1_REPORT.md](PHASE1_REPORT.md) for executed checks, measurements and limitations.

## Pinned toolchain

- Foundry `1.8.5` (Forge, Cast and Anvil).
- Solidity `0.8.30+commit.73712a01`, selected explicitly by `foundry.toml`.
- EVM target `cancun`, optimizer enabled, 200 runs, no via-IR, isolated tests.
- [OpenZeppelin Contracts v5.7.0](https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.7.0).
- [forge-std v1.17.0](https://github.com/foundry-rs/forge-std/releases/tag/v1.17.0).
- Node.js 24 for the optional contract integration harness; no npm packages are required.

Dependencies are local under ignored `lib/`, restored from the exact release tags by `scripts/install-deps.sh`. This uses `forge install --no-git`; it does not initialize or modify the project's Git repository. OpenZeppelin's pinned repository also includes its upstream test submodules; this project only compiles imported sources. Review dependency upgrades explicitly.

From this directory, with Foundry already installed:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
bash scripts/install-deps.sh
forge fmt --check
forge build --force
forge test -vvv
forge coverage --report summary
forge snapshot --match-contract CertificateRegistryGasTest
node scripts/local-smoke.mjs
```

The PATH change lasts only for this shell. The first build may download the pinned compiler into Foundry's user cache. No global npm dependencies or shell-profile modifications are needed. The integration harness requires permission to bind loopback sockets and creates/stops its own isolated Anvil node. Do not run the harness concurrently with another deployment script in this same checkout because Forge's broadcast artifact path is shared.

## Contract rules

`CertificateRegistry(initialAdmin, adminTransferDelay)` is non-upgradeable and rejects a zero admin through OpenZeppelin. It grants no issuer role automatically, including to the admin or deployer. `ISSUER_ROLE = keccak256("ISSUER_ROLE")` identifies a permission; this use of Keccak is unrelated to document hashing.

| Operation | Authority / result |
| --- | --- |
| `grantRole(ISSUER_ROLE, wallet)` | Default admin; zero issuer is rejected |
| `revokeRole(ISSUER_ROLE, wallet)` | Default admin; past certificate records remain unchanged |
| `renounceRole(ISSUER_ROLE, wallet)` | That wallet, with inherited caller confirmation |
| `issueCertificate(id, documentHash)` | Active issuer; nonzero ID/digest; ID never previously used |
| `issueBatch(ids, documentHashes)` | Active issuer; equal nonempty arrays; maximum 50; atomic rollback on any invalid member |
| `getCertificate(id)` | Public `(exists, record)`; used for ID-only verification |
| `verifyCertificate(id, candidateDigest)` | Public digest comparison: `Unknown=0`, `Valid=1`, `Modified=2`, `Revoked=3` |
| `revokeCertificate(id)` | Active original issuer only; unknown/already-revoked IDs reject |

The default admin has no revocation authority by virtue of that role (an admin that was separately granted `ISSUER_ROLE` can revoke only certificates it issued itself). Revocation preserves ID, digest, original issuer, issuance timestamp and block, set irreversible revocation fields and emit the revoking actor. Another issuer cannot revoke the record. Regranting the original wallet restores its ordinary revocation ability; a replacement wallet does not inherit old ownership.

Admin transfer, cancellation, delay adjustment and renunciation retain OpenZeppelin's inherited rules. The admin transfer delay does **not** delay issuer grants/removals or certificate revocation. Renouncing the default admin after its required scheduled zero-address transfer removes recovery authority; existing issuers can still issue/revoke their own certificates. It is not a shutdown mechanism.

Records contain only the digest, issuer address, issuance timestamp/block and revocation timestamp/flag under a non-personal `bytes32` ID. No PDF, filename, URI, student wallet or private student fields are accepted. There are no payments, external contract calls, proxy upgrades, deletion or un-revocation functions.

### SHA-256 byte encoding

Hash the final PDF bytes off-chain with Node `createHash('sha256').update(pdfBytes).digest()`. Transport the 32-byte result as `'0x' + digest.toString('hex')`, preserving leading zero bytes. ABI-encode this directly as `bytes32`; never use a bytes32 string encoder, rehash the hex text, or substitute Keccak-256. IDs are separate opaque values, not student-data hashes.

The registry accepts a nonzero digest but cannot prove it was produced by SHA-256 or came from a PDF. The issuer attests to it. A zero **candidate** digest passed to the read-only comparison simply mismatches an existing unrevoked record; it cannot be issued as a stored digest.

`verifyCertificate` reports state at the queried block. Unknown takes precedence when no record exists; revoked takes precedence over digest mismatch. Pending, confirmations and unavailable are off-chain concerns; RPC/call failures must not be translated into `Unknown`. ID-only lookup does not establish document equality. The planned Ethers/API integration is not implemented or tested here; the contract harness uses Node crypto plus Cast ABI/RPC encoding.

### Batch cap

`MAX_BATCH_SIZE()` returns 50, retained as the local candidate after measured tests. It is a source-level design parameter, not runtime admin configuration. No transaction may exceed the compiled cap; future clients must read the getter. Measure again before a public deployment or changes to compiler, optimizer, hardfork or record layout. The current measurements justify the local cap only.

## Local deployment

Start an isolated development chain in one terminal:

```sh
"$HOME/.foundry/bin/anvil" --host 127.0.0.1 --port 8545 \
  --chain-id 31337 --hardfork cancun --gas-limit 30000000
```

In another terminal, export **public addresses** from that local node, then run the wrapper. No private keys belong in the environment or source. Substitute the addresses before executing:

```sh
export INITIAL_ADMIN_ADDRESS='<local admin address>'
export DEPLOYER_ADDRESS='<unlocked local deployer address>'
export ADMIN_TRANSFER_DELAY_SECONDS=60
bash scripts/deploy-local.sh
```

The wrapper fixes RPC to `http://127.0.0.1:<ANVIL_PORT or 8545>` and checks chain ID 31337. The Solidity script independently rejects all other chain IDs. These are development safeguards, not proof that an arbitrary RPC advertising 31337 is trustworthy. Do not bypass the wrapper or expose an unlocked Anvil node publicly.

After deployment, issuer grants remain explicit admin-signed operations. The automated local harness performs its own synthetic grants/issuance/revocation for testing; deployment itself does not. Raw `broadcast/`, `cache/` and `.local/` artifacts are ignored. The harness's temporary deployment is destroyed when its Anvil process exits; the gas report is evidence, not a persistent deployment manifest.
