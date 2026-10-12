# CertiVerify — Likely Evaluation Questions and Answers

Short, honest answers you can say in your own words. If you don't know something, say so, and say what you would check.

---

**1. Why use a blockchain? Why not just a normal database?**
A normal database is controlled by one server, and whoever controls it can change records quietly. On a blockchain, the issuance and revocation records are public and tamper-evident, so anyone can check them independently. In my project the blockchain is the source of truth, and MongoDB only stores extra off-chain data.

**2. What exactly is stored on the blockchain?**
For each certificate: a certificate ID, the 32-byte SHA-256 fingerprint of the PDF, the issuer's wallet address, the issue time and block, and a revoked flag with its time. The PDF and the student's personal details are **not** stored on-chain.

**3. What is SHA-256, and why is it secure here?**
SHA-256 is a hash function: it turns any file into a fixed 32-byte code. The same file always gives the same code, and changing even one byte gives a completely different one. It is practically impossible to make a different PDF with the same hash. That is why we can detect tampering.

**4. Who computes the hash, the browser or the server?**
The backend computes the SHA-256 of the exact uploaded PDF bytes, using Node.js's built-in `crypto` library. It is calculated the same way when issuing and when verifying.

**5. How do you stop someone from issuing fake certificates on your contract?**
Only wallets that hold the `ISSUER_ROLE` can issue. The contract checks this itself, using OpenZeppelin's AccessControl. The admin grants or removes issuer roles. The backend also checks the role live on-chain before preparing a draft.

**6. Does the backend have the private keys? Can the server issue certificates by itself?**
No. The backend has no private keys and never sends issuance or revocation transactions. It only prepares unsigned transaction data. The issuer's own MetaMask wallet signs and sends it. This is called a non-custodial design.

**7. How does login work without a password?**
I use Sign-In with Ethereum (SIWE, EIP-4361). The backend gives a one-time message with a random nonce. The user signs it in MetaMask, and the backend checks the signature to confirm they own that wallet address. Then it creates a session cookie protected with a CSRF token.

**8. Who can revoke a certificate? Can the admin revoke anything?**
Only the original issuer, and only while they still hold the issuer role. The admin **cannot** revoke a certificate just because they are the admin. Revocation is permanent: a revoked certificate can't be restored, and its ID can't be reused.

**9. What happens if an issuer's wallet is lost or stolen?**
The admin can remove that wallet's issuer role so it can't issue anything new. But by our chosen policy, nobody else can revoke the certificates that wallet already issued, because there is no admin override. This is a known trade-off, and it is documented in SECURITY.md.

**10. What if someone just copies a valid certificate PDF?**
A copy has the same hash, so it verifies as VALID. That is correct, because the content is genuine. The system proves the document is unchanged and was issued by an authorized issuer. It does not prove who is holding the file. That would need an extra identity check.

**11. What does the app show if the blockchain is down?**
It shows **UNAVAILABLE**, never "unknown" or "invalid". We don't want a temporary outage to make a real certificate look fake.

**12. What if a transaction is still pending?**
The app shows PENDING, not success. The certificate counts as issued only after the transaction is mined and the backend has checked the receipt, the event and the on-chain record.

**13. How did you test the project?**
There are 281 automated tests, all passing:
- 51 Foundry smart-contract tests (unit, fuzz and invariant tests)
- 97 backend unit tests
- 28 backend integration tests that run against a real local Anvil blockchain and a real MongoDB
- 105 frontend tests

I also ran the full flow on a local deployment: issue, verify the original, detect a modified copy, then revoke. All of this is local testing; there has been no independent audit.

**14. Is it deployed on Ethereum mainnet or a testnet?**
No. The current demo runs on Anvil, a local Ethereum blockchain (chain ID 31337). Deploying to a public testnet like Sepolia is the next step in my future scope.

**15. What does it cost to issue a certificate?**
On a public network each issuance costs gas, paid by the issuer. Batch issuance (up to 50 certificates in one transaction) reduces the cost per certificate. I measured gas only locally, so I haven't stated real-money costs. Those depend on the network and its gas price at the time.
