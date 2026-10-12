# CertiVerify — Local Demo Checklist

Everything runs locally on Anvil (chain ID **31337**). Never use a real wallet, a real recovery phrase or real funds, and never deploy to a public network.

## A. The night before

- [ ] Docker Desktop opens and shows **Engine running**.
- [ ] Re-run the tests and confirm the slide-8 numbers. MongoDB must be up for the integration tests (step B1):
  ```bash
  cd ~/Downloads/BlockChain_Sem-7/contracts && forge test                     # expect 51 passed
  cd ../backend && npm run test:unit                                          # expect 97 passed
  TEST_MONGODB_URI=mongodb://127.0.0.1:27017/certificates_test npm run test:integration   # expect 28 passed
  cd ../frontend && npx vitest run                                            # expect 105 passed
  ```
- [ ] Make two **dummy** PDFs with no real personal data:
  - `demo_original.pdf`: any one-page PDF, e.g. type "Sample Certificate — Demo Student — B.Tech 2026" in a document and use **File → Export as PDF**.
  - `demo_modified.pdf`: a copy with one change. Either edit one word and export again, or in Terminal run:
    `cp demo_original.pdf demo_modified.pdf && printf ' ' >> demo_modified.pdf`
- [ ] Do a full dry run (sections B–D), and take a screenshot of the Verify page for slide 8.

## B. Start the project (about 3 minutes)

Use a separate Terminal window for each long-running command.

1. **MongoDB**
   ```bash
   cd ~/Downloads/BlockChain_Sem-7
   docker compose -f compose.test.yaml up -d --wait
   ```
   The dev `compose.yaml` (mongo 8.0.32) won't start on the current Docker kernel, so use `compose.test.yaml` (mongo 7.0). This command keeps the existing data volume.
2. **Anvil** (Terminal 1):
   ```bash
   anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --hardfork cancun
   ```
   Leave it open. It prints 10 test accounts and their test private keys; you'll need account (1) for MetaMask.
3. **Deploy the contract and grant issuer roles** (new terminal):
   ```bash
   cd ~/Downloads/BlockChain_Sem-7/contracts
   ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   INITIAL_ADMIN_ADDRESS=$ADMIN DEPLOYER_ADDRESS=$ADMIN bash scripts/deploy-local.sh
   REG=0x5FbDB2315678afecb367f032d93F642f64180aa3
   ROLE=$(cast call --rpc-url http://127.0.0.1:8545 $REG "ISSUER_ROLE()(bytes32)")
   for a in 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; do
     cast send --rpc-url http://127.0.0.1:8545 --unlocked --from $ADMIN $REG "grantRole(bytes32,address)" $ROLE $a
   done
   cd ../backend && npm run manifest:local
   ```
   You should see `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL` and `Local public manifest written`.
4. **Backend** (Terminal 2): `cd ~/Downloads/BlockChain_Sem-7/backend && npm run dev`
5. **Indexer** (Terminal 3): `cd ~/Downloads/BlockChain_Sem-7/backend && npm run indexer:dev`
6. **Frontend** (Terminal 4): `cd ~/Downloads/BlockChain_Sem-7/frontend && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`
7. **Health check:** open `http://127.0.0.1:3001/api/v1/health/ready`. It should say `"status":"READY"`. (`/health/ready` without `/api/v1` gives NOT_FOUND; that's expected.)

## C. MetaMask setup (in Brave)

- [ ] `brave://settings/wallet` → **Default Ethereum wallet** → **Extensions (no fallback)**.
- [ ] Network **Local Anvil**: RPC URL `http://127.0.0.1:8545`, chain ID **31337**, symbol `ETH`.
- [ ] Import **Anvil account (1)**, address `0x7099…79C8` (an issuer): copy its private key from the Anvil terminal output → MetaMask → **Add account or hardware wallet → Import account**. It's a public test key; never use it on a real network.
- [ ] After every Anvil restart: MetaMask → **Settings → Advanced → Clear activity tab data**.

## D. Demo script (about 3 minutes)

Open **http://localhost:5173**. Use `localhost`, not `127.0.0.1`, or sign-in is refused.

1. **Sign in:** **Connect Wallet**, then **Sign In (SIWE)**, then approve the signature in MetaMask (free; it isn't a transaction). If you see **Wrong Network — Switch**, click it and approve.
2. **Issue:** go to **Issuer Dashboard**, which should show **Verified Issuer Role**.
   - Open **Issue** → upload `demo_original.pdf` → **Upload & Prepare Draft**.
   - Point out the certificate ID and the SHA-256 digest, and say: "this is only a draft".
   - Click **Sign & Anchor to Blockchain** → confirm in MetaMask → wait for confirmation.
   - Copy the **certificate ID**.
3. **Verify the original:** on **Verify Certificate**, paste the ID and upload `demo_original.pdf` → **VALID**.
4. **Tamper detection:** same ID, upload `demo_modified.pdf` → **MODIFIED**.
5. **Unknown ID (optional):** a random ID shows **UNKNOWN**.
6. **Revoke:** **Issuer Dashboard → Revoke** → enter the ID → acknowledge the warning → confirm in MetaMask.
7. **Verify again:** the ID with `demo_original.pdf` now shows **REVOKED**.

## E. If something goes wrong

| Symptom | Fix |
|---|---|
| "Wrong Network" | Click the badge to switch; check the network's chain ID is 31337 |
| `ISSUER_REQUIRED` / "Not an Authorized Issuer" | MetaMask is on a non-issuer account. Switch to Anvil account (1), then sign out and sign in again |
| `ORIGIN_FORBIDDEN` | You opened `127.0.0.1:5173`; use `http://localhost:5173` |
| MetaMask nonce or transaction errors | Clear activity tab data (section C) |
| Readiness not READY | Check MongoDB and Anvil are running, and rerun `npm run manifest:local` |
| Live demo fails in the room | Show your dry-run screenshot and the test results on slide 8 |

## F. Stop everything afterwards

- Press `Ctrl+C` in the frontend, indexer, backend and Anvil terminals.
- Run `docker compose -f compose.test.yaml stop`. Never use `down -v`, which deletes the data.
