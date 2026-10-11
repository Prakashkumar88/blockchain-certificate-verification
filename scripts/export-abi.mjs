import { readFileSync, writeFileSync } from "node:fs";
const artifact = JSON.parse(
  readFileSync(
    new URL(
      "../contracts/out/CertificateRegistry.sol/CertificateRegistry.json",
      import.meta.url,
    ),
  ),
);
const output = JSON.stringify(artifact.abi, null, 2) + "\n";
const path = new URL(
  "../backend/src/contracts/CertificateRegistry.json",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("ABI drift: run npm run abi:export");
} else writeFileSync(path, output);
