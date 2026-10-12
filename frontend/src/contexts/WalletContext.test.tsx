import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WalletProvider, useWallet } from './WalletContext';

const user = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

function fakeWallet(initialChain: string, switchResult: 'ok' | 'reject' = 'ok') {
  let chain = initialChain;
  const listeners: Record<string, ((v: unknown) => void)[]> = {};
  const request = vi.fn(async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [user];
    if (method === 'wallet_switchEthereumChain') {
      if (switchResult === 'reject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      chain = params![0].chainId;
      return null;
    }
    throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
  });
  return {
    request,
    on: (event: string, fn: (v: unknown) => void) => { (listeners[event] ??= []).push(fn); },
    removeListener: vi.fn(),
    emit: (event: string, value: unknown) => listeners[event]?.forEach((fn) => fn(value)),
    get chain() { return chain; },
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <WalletProvider>{children}</WalletProvider>;

describe('WalletContext network switching', () => {
  afterEach(() => { delete (window as { ethereum?: unknown }).ethereum; });

  it('requests the configured chain and only becomes correct after the wallet reports it', async () => {
    const wallet = fakeWallet('0x1');
    window.ethereum = wallet;
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.chainId).toBe(1));
    expect(result.current.isCorrectNetwork).toBe(false);

    await act(() => result.current.switchNetwork());
    expect(wallet.request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] });
    // The request alone does not flip state; the wallet's chainChanged event does.
    expect(result.current.isCorrectNetwork).toBe(false);

    act(() => wallet.emit('chainChanged', wallet.chain));
    expect(result.current.chainId).toBe(31337);
    expect(result.current.isCorrectNetwork).toBe(true);
  });

  it('surfaces a rejected switch and stays on the wrong network', async () => {
    window.ethereum = fakeWallet('0x1', 'reject');
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.chainId).toBe(1));
    await act(() => result.current.switchNetwork());
    expect(result.current.error).toMatch(/rejected/);
    expect(result.current.isCorrectNetwork).toBe(false);
  });
});
