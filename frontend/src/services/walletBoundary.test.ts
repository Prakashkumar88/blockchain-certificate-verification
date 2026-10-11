// Finding 7: wallet failure paths through the real ethers BrowserProvider/JsonRpcSigner,
// as WalletContext constructs them. Only the injected EIP-1193 object (window.ethereum)
// is scripted; this is NOT a real browser wallet (MetaMask etc.) and NOT a real chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BrowserProvider, isError } from 'ethers';
import { registryInterface, submitPreparedTransaction } from './preparedTransaction';
import { useCertificateTransaction } from '../hooks/useCertificateTransaction';

const contract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const user = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const certId = '0x' + 'aa'.repeat(32);
const digest = '0x' + 'cc'.repeat(32);
const data = registryInterface.encodeFunctionData('issueCertificate', [certId, digest]);

type Handler = (params: unknown[]) => unknown;
function eip1193(overrides: Record<string, Handler> = {}) {
  const calls: string[] = [];
  const handlers: Record<string, Handler> = {
    eth_chainId: () => '0x7a69',
    eth_accounts: () => [user],
    eth_requestAccounts: () => [user],
    eth_estimateGas: () => '0x30d40',
    eth_blockNumber: () => '0x10',
    ...overrides,
  };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    const handler = handlers[method];
    if (!handler) throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    return handler(params ?? []);
  });
  return { request, calls };
}

async function submit(wallet: ReturnType<typeof eip1193>, chainId = 31337) {
  const provider = new BrowserProvider(wallet, 'any');
  const signer = await provider.getSigner(user);
  return submitPreparedTransaction({
    intent: { kind: 'issue', ids: [certId], digests: [digest] },
    prepare: async () => ({
      transaction: { to: contract, from: user, chainId: 31337, data, value: '0x0' } as never,
    }),
    provider,
    signer,
    getSnapshot: () => ({ address: user, chainId, revision: 1 }),
  });
}

describe('wallet boundary through real ethers BrowserProvider (scripted EIP-1193)', () => {
  beforeEach(() => {
    import.meta.env.VITE_CONTRACT_ADDRESS = contract;
    import.meta.env.VITE_NETWORK_CHAIN_ID = '31337';
  });

  it('EIP-1193 user rejection (4001) surfaces as ACTION_REJECTED', async () => {
    const wallet = eip1193({
      eth_sendTransaction: () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      },
    });
    const error = await submit(wallet).catch((e: unknown) => e);
    expect(isError(error, 'ACTION_REJECTED')).toBe(true);
    expect(wallet.calls).toContain('eth_sendTransaction');
  });

  it('wallet on the wrong network is refused before eth_sendTransaction is requested', async () => {
    const wallet = eip1193({ eth_chainId: () => '0xaa36a7' });
    await expect(submit(wallet)).rejects.toThrow(/account or chain does not match/);
    expect(wallet.calls).not.toContain('eth_sendTransaction');
  });

  it('stale app network state is refused before any wallet RPC', async () => {
    const wallet = eip1193();
    await expect(submit(wallet, 11155111)).rejects.toThrow(/configured registry chain/);
    expect(wallet.calls).not.toContain('eth_sendTransaction');
  });

  it.each([
    ['internal JSON-RPC error', { code: -32603, message: 'Internal JSON-RPC error.' }],
    ['disconnected provider', { code: 4900, message: 'Disconnected' }],
  ])('wallet RPC failure (%s) rejects without a transaction hash', async (_label, failure) => {
    const wallet = eip1193({
      eth_sendTransaction: () => {
        throw Object.assign(new Error(failure.message), { code: failure.code });
      },
    });
    await expect(submit(wallet)).rejects.toBeTruthy();
  });

  it('a rejected signature leaves the hook failed, with no hash and no reconciliation', async () => {
    const wallet = eip1193({
      eth_sendTransaction: () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      },
    });
    const reconcile = vi.fn();
    const { result } = renderHook(() => useCertificateTransaction());
    await act(() => result.current.run(() => submit(wallet), reconcile));
    expect(result.current.phase).toBe('failed');
    expect(result.current.hash).toBeNull();
    expect(result.current.confirmed).toBe(false);
    expect(result.current.message).toMatch(/rejected/i);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
