import { getAddress, Interface, ZeroAddress, ZeroHash } from 'ethers';
import type { BrowserProvider, JsonRpcSigner } from 'ethers';
import registryAbi from '../../../backend/src/contracts/CertificateRegistry.json';
import type { WalletSnapshot } from '../contexts/WalletContext';
import type { PreparedTransaction } from './api';

export const registryInterface = new Interface(registryAbi);
export type CertificateIntent =
  | { kind: 'issue'; ids: string[]; digests: string[] }
  | { kind: 'batch'; ids: string[]; digests: string[] }
  | { kind: 'revoke'; ids: string[] };

export function registryConfig() {
  let address = ZeroAddress;
  try {
    address = getAddress(import.meta.env.VITE_CONTRACT_ADDRESS || ZeroAddress);
  } catch {
    address = ZeroAddress;
  }
  const chainId = Number(import.meta.env.VITE_NETWORK_CHAIN_ID || '31337');
  if (address === ZeroAddress || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('Configure a valid registry address and chain before submitting transactions.');
  }
  return { address, chainId };
}

function bytes32(value: string) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZeroHash) {
    throw new Error('Invalid certificate identifier or SHA-256 digest.');
  }
  return value.toLowerCase();
}

function encodeIntent(intent: CertificateIntent) {
  const ids = intent.ids.map(bytes32);
  if (!ids.length || ids.length > 50 || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    throw new Error('Invalid certificate selection.');
  }
  if (intent.kind !== 'batch' && ids.length !== 1) throw new Error('Expected one certificate.');
  if (intent.kind === 'revoke') return registryInterface.encodeFunctionData('revokeCertificate', ids);
  const digests = intent.digests.map(bytes32);
  if (digests.length !== ids.length) throw new Error('Certificate digests do not match the selection.');
  return intent.kind === 'issue'
    ? registryInterface.encodeFunctionData('issueCertificate', [ids[0], digests[0]])
    : registryInterface.encodeFunctionData('issueBatch', [ids, digests]);
}

export async function submitPreparedTransaction(options: {
  intent: CertificateIntent;
  prepare: () => Promise<{ transaction: PreparedTransaction }>;
  provider: BrowserProvider;
  signer: JsonRpcSigner;
  getSnapshot: () => WalletSnapshot;
}) {
  const { provider, signer, getSnapshot } = options;
  const config = registryConfig();
  const expected = typeof getSnapshot === 'function' ? { ...getSnapshot() } : { address: null, chainId: null, revision: 0 };
  if (!provider || !signer || !expected.address || expected.chainId !== config.chainId) {
    throw new Error('Connect your wallet on the configured registry chain.');
  }
  const from = getAddress(expected.address);
  // Encode reviewed IDs/digests before awaiting a backend response.
  const data = encodeIntent(options.intent);
  const assertUnchanged = () => {
    const now = typeof getSnapshot === 'function' ? getSnapshot() : { address: null, chainId: null, revision: -1 };
    if (now.revision !== expected.revision || now.address?.toLowerCase() !== from.toLowerCase() || now.chainId !== config.chainId) {
      throw new Error('Wallet account or network changed. Review the operation again.');
    }
  };
  const { transaction } = await options.prepare();
  assertUnchanged();
  let matches = false;
  try {
    matches = !!transaction &&
      getAddress(transaction.to) === config.address &&
      transaction.chainId === config.chainId &&
      getAddress(transaction.from) === from &&
      typeof transaction.data === 'string' &&
      transaction.data.toLowerCase() === data.toLowerCase() &&
      typeof transaction.value === 'string' &&
      /^0x0+$/.test(transaction.value);
  } catch {
    matches = false;
  }
  if (!matches) {
    throw new Error('Prepared transaction does not match the reviewed certificate operation.');
  }

  // Raw RPC queries avoid relying on the React render or cached network information.
  const [accounts, activeChain, signerAddress] = await Promise.all([
    provider.send('eth_accounts', []), provider.send('eth_chainId', []), signer.getAddress(),
  ]);
  let rpcValid = false;
  try {
    rpcValid = Array.isArray(accounts) &&
      !!accounts[0] &&
      getAddress(accounts[0]) === from &&
      BigInt(activeChain) === BigInt(config.chainId) &&
      getAddress(signerAddress) === from;
  } catch {
    rpcValid = false;
  }
  if (!rpcValid) {
    throw new Error('The active wallet account or chain does not match this transaction.');
  }
  assertUnchanged();
  // Never forward unvalidated backend fields. Pin chain and sender for wallet-side enforcement.
  return signer.sendTransaction({ to: config.address, from, chainId: config.chainId, data, value: 0n });
}
