// Contract-only integration/gas harness. Uses built-in Node modules and an isolated Anvil process.
// No private keys are read or stored. All writes use that process's unlocked development accounts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.FOUNDRY_BIN_DIR || join(homedir(), '.foundry/bin');
const cast = join(bin, 'cast');
const forge = join(bin, 'forge');
const sha256 = (bytes) => `0x${createHash('sha256').update(bytes).digest('hex')}`;
const idFor = (label) => sha256(Buffer.from(`synthetic-id:${label}`));
const output = (file, args, env = {}) => execFileSync(file, args, {
  cwd: root, encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

// Reserve a free loopback port, then launch our own node; never reset an existing user's node.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const rpc = `http://127.0.0.1:${port}`;
const anvil = spawn(join(bin, 'anvil'), [
  '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337',
  '--hardfork', 'cancun', '--gas-limit', '30000000', '--silent',
], { stdio: 'ignore' });
let spawnError;
anvil.on('error', (error) => { spawnError = error; });
const rpcCall = (method, ...args) => JSON.parse(output(cast, ['rpc', method, ...args, '--rpc-url', rpc]));

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    if (anvil.exitCode !== null) throw new Error('Isolated Anvil exited before becoming ready');
    try { ready = rpcCall('eth_chainId') === '0x7a69'; } catch { /* wait for startup */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, 'Anvil did not start on the selected loopback port');
  const [admin, issuer, otherIssuer] = rpcCall('eth_accounts');
  mkdirSync(join(root, '.local'), { recursive: true });
  const deploymentLog = output('bash', ['scripts/deploy-local.sh'], {
    INITIAL_ADMIN_ADDRESS: admin, DEPLOYER_ADDRESS: admin,
    ADMIN_TRANSFER_DELAY_SECONDS: '60', ANVIL_PORT: String(port), FOUNDRY_BIN_DIR: bin,
  });
  writeFileSync(join(root, '.local/deployment.log'), `${deploymentLog}\n`);
  const broadcast = JSON.parse(readFileSync(join(root, 'broadcast/DeployLocal.s.sol/31337/run-latest.json')));
  const deployment = broadcast.transactions.find((tx) => tx.contractName === 'CertificateRegistry');
  assert(deployment?.contractAddress, 'No registry address in local deployment receipt');
  const registry = deployment.contractAddress;
  assert.notEqual(rpcCall('eth_getCode', registry, 'latest'), '0x');
  const gas = [];
  const send = (from, signature, args, gasLimit) => {
    const command = ['send', registry, signature, ...args, '--from', from, '--unlocked', '--rpc-url', rpc, '--json'];
    if (gasLimit) command.push('--gas-limit', String(gasLimit));
    const receipt = JSON.parse(output(cast, command));
    assert.equal(Number(BigInt(receipt.status)), 1, `Transaction failed: ${signature}`);
    return receipt;
  };
  const read = (signature, ...args) => {
    const data = output(cast, ['calldata', signature, ...args]);
    return rpcCall('eth_call', JSON.stringify({ to: registry, data }), 'latest');
  };
  const status = (id, digest) => Number(BigInt(read('verifyCertificate(bytes32,bytes32)', id, digest)));
  const role = output(cast, ['keccak', 'ISSUER_ROLE']);
  send(admin, 'grantRole(bytes32,address)', [role, issuer]);
  send(admin, 'grantRole(bytes32,address)', [role, otherIssuer]);
  assert.equal(Number(BigInt(read('MAX_BATCH_SIZE()'))), 50);

  // Find a synthetic PDF-envelope fixture whose digest begins with a zero byte.
  // This is a byte-encoding fixture, not a PDF-validator implementation.
  let pdf, digest;
  for (let nonce = 0; ; nonce++) {
    pdf = Buffer.from(`%PDF-1.4\n% synthetic test fixture ${nonce}\n%%EOF\n`);
    digest = sha256(pdf);
    if (digest.startsWith('0x00')) break;
  }
  const certificateId = idFor('single');
  const single = send(issuer, 'issueCertificate(bytes32,bytes32)', [certificateId, digest]);
  gas.push({ operation: 'single', batchSize: 1, gasUsed: Number(BigInt(single.gasUsed)) });
  const encodedRecord = read('getCertificate(bytes32)', certificateId).slice(2);
  assert.equal(BigInt(`0x${encodedRecord.slice(0, 64)}`), 1n);
  assert.equal(`0x${encodedRecord.slice(64, 128)}`, digest, 'Leading zero SHA-256 bytes changed');
  assert.equal(single.logs[0].data.slice(0, 66), digest, 'Event digest differs from Node bytes');
  assert.equal(status(certificateId, digest), 1);
  assert.equal(status(certificateId, sha256(Buffer.concat([pdf, Buffer.from('changed')]))), 2);
  assert.equal(status(idFor('unknown'), digest), 0);

  for (const count of [1, 10, 25, 50]) {
    const ids = Array.from({ length: count }, (_, i) => idFor(`batch-${count}-${i}`));
    const hashes = ids.map((id) => sha256(Buffer.from(`document:${id}`)));
    const receipt = send(issuer, 'issueBatch(bytes32[],bytes32[])', [`[${ids}]`, `[${hashes}]`]);
    assert.equal(receipt.logs.length, count);
    for (let i = 0; i < count; i++) assert.equal(status(ids[i], hashes[i]), 1);
    gas.push({ operation: 'batch', batchSize: count, gasUsed: Number(BigInt(receipt.gasUsed)) });
  }

  // Maximal nonzero calldata bytes plus fresh storage for a conservative cap check.
  // A digest is opaque to the registry; these benchmark bytes are not a claimed PDF hash.
  const denseIds = Array.from({ length: 50 }, (_, i) => `0x${'ff'.repeat(31)}${(i + 1).toString(16).padStart(2, '0')}`);
  const denseHashes = denseIds.map(() => `0x${'ff'.repeat(32)}`);
  const denseReceipt = send(issuer, 'issueBatch(bytes32[],bytes32[])', [`[${denseIds}]`, `[${denseHashes}]`]);
  assert.equal(denseReceipt.logs.length, 50);
  for (const id of denseIds) assert.equal(status(id, denseHashes[0]), 1);
  gas.push({ operation: 'batch-dense-calldata', batchSize: 50, gasUsed: Number(BigInt(denseReceipt.gasUsed)) });

  // Send a deliberately reverting batch, bypassing estimation so the receipt proves rollback.
  const fresh = idFor('must-rollback');
  const badData = output(cast, ['calldata', 'issueBatch(bytes32[],bytes32[])',
    `[${fresh},${certificateId}]`, `[${digest},${digest}]`]);
  const badHash = rpcCall('eth_sendTransaction', JSON.stringify({
    from: issuer, to: registry, data: badData, gas: '0x7a120',
  }));
  let failedReceipt;
  for (let i = 0; i < 100; i++) {
    failedReceipt = rpcCall('eth_getTransactionReceipt', badHash);
    if (failedReceipt) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(failedReceipt, 'Missing deliberately reverted transaction receipt');
  assert.equal(BigInt(failedReceipt.status), 0n);
  assert.equal(failedReceipt.logs.length, 0, 'Reverted batch emitted persisted logs');
  assert.equal(status(fresh, digest), 0, 'Reverted batch left a record behind');

  send(admin, 'revokeRole(bytes32,address)', [role, issuer]);
  assert.equal(status(certificateId, digest), 1, 'Issuer removal invalidated historical certificate');
  send(admin, 'revokeCertificate(bytes32)', [certificateId]);
  assert.equal(status(certificateId, digest), 3);
  assert.equal(status(certificateId, sha256(Buffer.from('wrong file'))), 3);
  const artifact = JSON.parse(readFileSync(join(root, 'out/CertificateRegistry.sol/CertificateRegistry.json')));
  const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
  const blockGasLimit = Number(BigInt(rpcCall('eth_getBlockByNumber', 'latest', 'false').gasLimit));
  assert.equal(blockGasLimit, 30_000_000);
  assert(gas.every((entry) => entry.gasUsed < blockGasLimit / 2), 'Batch exceeds chosen 50% local budget');
  const report = {
    chainId: 31337, hardfork: metadata.settings.evmVersion, blockGasLimit,
    compiler: metadata.compiler.version, optimizerRuns: metadata.settings.optimizer.runs,
    foundry: output(forge, ['--version']).split('\n')[0],
    registry, digestFixture: digest, gas,
    revertedBatch: { status: 0, persistedLogs: 0, freshIdAbsent: true },
    note: 'Actual local receipt gas includes intrinsic/calldata gas. Public-network limits not validated.',
  };
  writeFileSync(join(root, '.local/local-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log('Local deployment, digest encoding, rollback, issuer removal and revocation checks passed.');
} finally {
  if (anvil.pid && anvil.exitCode === null && anvil.signalCode === null) {
    await new Promise((resolve) => {
      anvil.once('exit', resolve);
      anvil.kill('SIGTERM');
    });
  }
}
