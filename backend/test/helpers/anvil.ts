import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { ContractFactory, JsonRpcProvider, keccak256 } from "ethers";
import { abiHash, deploymentId } from "../../src/config/index.js";
import { RegistryChain } from "../../src/services/chain.js";
import { config } from "./fixtures.js";
export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  return port;
}
export async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
// Anvil (1.8.x) automines asynchronously. ethers' tx.wait() only reacts to blocks newer
// than its first poll, so a tx mined in between can wait forever on an idle node.
// Poll the receipt directly instead.
export async function mined(
  provider: JsonRpcProvider,
  tx: string | { hash: string },
  timeoutMs = 20000,
) {
  const hash = typeof tx === "string" ? tx : tx.hash;
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Transaction ${hash} was not mined`);
}
export async function startAnvil() {
  const port = await freePort();
  const child = spawn(
    join(
      process.env.FOUNDRY_BIN_DIR ?? join(homedir(), ".foundry/bin"),
      "anvil",
    ),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--hardfork",
      "cancun",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let error: Error | undefined;
  child.on("error", (e) => {
    error = e;
  });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  try {
    for (let n = 0; n < 100; n++) {
      if (error) throw error;
      if (child.exitCode !== null) throw new Error("Anvil exited");
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
        });
        ready = ((await r.json()) as { result: string }).result === "0x7a69";
      } catch {
        /* Starting our own local node. */
      }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!ready) throw new Error("Anvil startup timeout");
    const provider = new JsonRpcProvider(url, undefined, {
      cacheTimeout: -1,
      batchMaxCount: 1,
    });
    try {
      const admin = await provider.getSigner(0),
        issuer = await provider.getSigner(1),
        other = await provider.getSigner(2);
      const artifact = JSON.parse(
        await readFile(
          new URL(
            "../../../contracts/out/CertificateRegistry.sol/CertificateRegistry.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const contract = await new ContractFactory(
        artifact.abi,
        artifact.bytecode.object,
        admin,
      ).deploy(await admin.getAddress(), 60);
      const receipt = await mined(provider, contract.deploymentTransaction()!);
      if (!receipt) throw new Error("No deployment receipt");
      const address = await contract.getAddress();
      await mined(
        provider,
        await contract.getFunction("grantRole")(
          await contract.getFunction("ISSUER_ROLE")(),
          await issuer.getAddress(),
        ),
      );
      const c = config();
      c.RPC_URL = url;
      const m = {
        chainId: 31337,
        contractAddress: address.toLowerCase(),
        deploymentTransactionHash: receipt.hash.toLowerCase(),
        deploymentBlock: receipt.blockNumber,
        deploymentBlockHash: receipt.blockHash.toLowerCase(),
        runtimeCodeHash: keccak256(await provider.getCode(address)),
        abiHash,
      };
      c.manifest = { ...m, deploymentId: deploymentId(m) };
      return {
        config: c,
        provider,
        contract,
        admin,
        issuer,
        other,
        chain: new RegistryChain(c, provider),
        close: async () => {
          provider.destroy();
          await stopChild(child);
        },
      };
    } catch (e) {
      provider.destroy();
      throw e;
    }
  } catch (e) {
    await stopChild(child);
    throw e;
  }
}
