# CertiVerify — Presentation Script (10 minutes)

Speak slowly and look at the panel, not the screen. The times are targets; the running total is in brackets. The same text is in each slide's speaker notes in PowerPoint.

| Slide | Topic | Time | Running total |
|---|---|---|---|
| 1 | Title | 0:30 | 0:30 |
| 2 | Problem | 1:00 | 1:30 |
| 3 | Solution | 1:00 | 2:30 |
| 4 | Architecture | 1:00 | 3:30 |
| 5 | Technologies and features | 1:00 | 4:30 |
| 6 | Issuance workflow | 1:00 | 5:30 |
| 7 | Verification and revocation | 1:00 | 6:30 |
| 8 | Demo and test results | 1:00 | 7:30 |
| 9 | Applications, limitations, future | 1:00 | 8:30 |
| 10 | Conclusion | 0:30 | 9:00 |

That leaves about **1 minute of buffer** for pauses or a short live demo moment.

---

## Slide 1 — Title (30 sec)
> Good morning. I am Prakash Kumar, B.Tech Computer Science, IIIT Lucknow. My project is **CertiVerify**, a blockchain-based smart contract system for secure certificate verification. In the next ten minutes I will explain the problem, how the system works, what I tested, and what is still future work.

## Slide 2 — The Problem (1 min)
> Today most certificates are shared as PDF files. Take a simple example: a student sends a degree certificate to an employer. If someone edits the CGPA and saves the file again, the edited PDF looks exactly like the real one.
>
> This creates three problems. **First**, fake or modified certificates are easy to make and hard to spot. **Second**, manual verification is slow — the employer has to email or call the university and wait. **Third**, if the university cancels a certificate later, anyone holding the old PDF cannot easily find out that it was revoked.

## Slide 3 — Our Solution (1 min)
> Our idea is simple. Instead of trusting the PDF itself, we record its **digital fingerprint** on a blockchain.
>
> The fingerprint is a **SHA-256 hash**: a 32-byte code calculated from the exact bytes of the PDF. The same file always gives the same fingerprint, but if even **one byte** changes, the fingerprint changes completely.
>
> When the university issues a certificate, the smart contract stores the fingerprint, the issuer's wallet address and a revoked flag. The PDF and the student's details are **never** put on the blockchain.
>
> Our objectives: only authorized issuers can issue, anyone can verify instantly, any change to the PDF is detected, and revocation status is visible to everyone.

## Slide 4 — System Architecture (1 min)
> On the left is the user side: the **React and TypeScript frontend**, and the **MetaMask wallet**, which holds the user's private key.
>
> In the middle is the **Node.js and Express backend**. It handles wallet login, computes the SHA-256 fingerprint of uploaded PDFs, and prepares *unsigned* transaction data. On the right, **MongoDB** stores off-chain data like drafts, sessions and history, and the **Solidity smart contract** runs on **Anvil**, a local Ethereum blockchain, for this demonstration.
>
> The key point is the bottom arrow: the **signed transaction goes from the user's wallet directly to the blockchain**. The backend only *reads* the blockchain. It never holds a private key and never sends transactions. And the blockchain — not MongoDB — is the source of truth.

## Slide 5 — Technologies and Key Features (1 min)
> The contract is written in **Solidity** and tested with **Foundry**, using **OpenZeppelin** for role-based access control. The backend uses **Node.js, Express, TypeScript, ethers.js and MongoDB**. The frontend is **React with TypeScript, Vite and Tailwind**.
>
> The six key features: **wallet login** by signing a message — Sign-In with Ethereum, no password; **authorized issuance** — only wallets with the issuer role; **lookup and verification** by ID or PDF; **tamper detection** with SHA-256; **issuer revocation** — only the original issuer can revoke, and it is permanent, even the admin cannot do it for them; and **batch issuance** of up to 50 certificates in one transaction.

## Slide 6 — Issuance Workflow (1 min)
> Issuing a certificate takes six steps. **One**, the issuer connects MetaMask and signs in. **Two**, uploads the PDF. **Three**, the backend calculates the SHA-256 fingerprint. **Four**, the backend creates a draft, checks that the contract call would succeed, and returns unsigned transaction data.
>
> Up to here it is **only a draft** — nothing is on the blockchain.
>
> **Five**, the issuer reviews the details and approves in MetaMask. **Six**, the contract records the certificate, and the backend checks the receipt and the event before showing success. While a transaction is still pending, the app says *pending*, not success.

## Slide 7 — Verification and Revocation (1 min)
> Verification is public — no login needed. The verifier enters the certificate ID and uploads the PDF. The backend calculates its fingerprint and compares it with the blockchain record.
>
> Three main results: **VALID** — it matches and is not revoked. **MODIFIED** — the PDF was changed, so the fingerprint does not match. **REVOKED** — the original issuer cancelled it on the blockchain, permanently.
>
> So the system always checks two things: is the document unchanged, and is the certificate still active? There are also **UNKNOWN**, when the ID was never issued, and **UNAVAILABLE**, when the blockchain cannot be reached — the app never guesses.

## Slide 8 — Demo and Test Results (1 min)
> I tested the full system **locally**. In the demo on the Anvil local blockchain: a certificate was issued and confirmed, the original PDF verified as **VALID**, a modified copy showed **MODIFIED**, and after the issuer revoked it, verification showed **REVOKED**.
>
> There are **281 automated tests**, all passing: 51 smart-contract tests including fuzz and invariant tests, 97 backend unit tests, 28 backend integration tests against a real local blockchain and a real MongoDB, and 105 frontend tests.
>
> To be clear: this is **local testing**. The project is not on a public blockchain, and it has not had an independent security audit.

*(If you added a screenshot, point to it while saying the demo line.)*

## Slide 9 — Applications, Limitations, Future Scope (1 min)
> It can be used for **university degrees and marksheets**, for **employers checking candidates** during recruitment, and for **professional and training certificates**.
>
> The limitations, honestly: the demo runs on **local Anvil**, not a public network. When Anvil stops, the local chain **resets** and must be redeployed. Real production use also needs secure hosting, institution onboarding, monitoring and privacy policies.
>
> Future work: deploy to a **public testnet**, move to **secure hosting and a managed database**, and **onboard institutions**. Everything in the bottom box is already implemented and tested today.

## Slide 10 — Conclusion (30 sec)
> To conclude: CertiVerify uses **SHA-256 fingerprints** to detect any change to a PDF, and a **smart contract** to record who issued each certificate and whether it is revoked. The user's own wallet signs every transaction.
>
> In one sentence: **anyone can check, in seconds, whether a certificate is genuine, unchanged and still valid — without contacting the university.** Thank you. I am happy to take your questions.
