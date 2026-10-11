// Reads an already-mined LOCAL deployment. This script never signs or deploys.
import { readFile, writeFile } from "node:fs/promises";
import { JsonRpcProvider, keccak256 } from "ethers";
import { abiHash, deploymentId } from "../src/config/index.js";
const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const url = new URL(rpc);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw new Error("Local loopback RPC required");
const hash = process.env.DEPLOYMENT_TRANSACTION_HASH;
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash))
  throw new Error("Set public DEPLOYMENT_TRANSACTION_HASH");
const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
try {
  if ((await provider.getNetwork()).chainId !== 31337n)
    throw new Error("Local chain 31337 required");
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress)
    throw new Error("Successful deployment receipt required");
  const artifact = JSON.parse(
    await readFile(
      new URL(
        "../../contracts/out/CertificateRegistry.sol/CertificateRegistry.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const code = await provider.getCode(receipt.contractAddress);
  if (keccak256(code) !== keccak256(artifact.deployedBytecode.object))
    throw new Error("Runtime differs from Phase 1 artifact");
  const m = {
    chainId: 31337,
    contractAddress: receipt.contractAddress.toLowerCase(),
    deploymentTransactionHash: hash.toLowerCase(),
    deploymentBlock: receipt.blockNumber,
    deploymentBlockHash: receipt.blockHash.toLowerCase(),
    runtimeCodeHash: keccak256(code),
    abiHash,
  };
  const target =
    process.env.DEPLOYMENT_MANIFEST_PATH ?? "../deployments/31337.local.json";
  await writeFile(
    target,
    JSON.stringify({ ...m, deploymentId: deploymentId(m) }, null, 2) + "\n",
  );
  console.log("Local public manifest written. No transaction submitted.");
} finally {
  provider.destroy();
}
