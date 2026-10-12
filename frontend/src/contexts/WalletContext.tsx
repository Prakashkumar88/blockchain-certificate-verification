import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

export interface WalletSnapshot {
  address: string | null;
  chainId: number | null;
  revision: number;
}
interface WalletContextType extends WalletSnapshot {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  isCorrectNetwork: boolean;
  getSnapshot: () => WalletSnapshot;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  error: string | null;
}
const WalletContext = createContext<WalletContextType | undefined>(undefined);
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_NETWORK_CHAIN_ID || '31337');

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [snapshot, setSnapshot] = useState<WalletSnapshot>({ address: null, chainId: null, revision: 0 });
  const current = useRef(snapshot);
  const connection = useRef<(() => Promise<void>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const getSnapshot = useCallback(() => ({ ...current.current }), []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const p = new BrowserProvider(ethereum, 'any');
    let mounted = true;
    setProvider(p);
    const update = (address: string | null, chainId: number | null) => {
      current.current = { address, chainId, revision: current.current.revision + 1 };
      setSnapshot(current.current);
      setSigner(null);
      return current.current.revision;
    };
    const loadSigner = async (revision: number) => {
      const address = current.current.address;
      if (!address) return;
      try {
        const s = await p.getSigner(address);
        if (mounted && revision === current.current.revision) setSigner(s);
      } catch (e) {
        if (mounted && revision === current.current.revision) setError(e instanceof Error ? e.message : 'Wallet unavailable');
      }
    };
    const refresh = async (requestAccess = false) => {
      const revision = current.current.revision;
      try {
        const accounts = await p.send(requestAccess ? 'eth_requestAccounts' : 'eth_accounts', []);
        const chain = await p.send('eth_chainId', []);
        if (!mounted || revision !== current.current.revision) return;
        const next = update(accounts[0]?.toLowerCase() ?? null, Number(BigInt(chain)));
        setError(null);
        await loadSigner(next);
      } catch (e) {
        if (mounted && revision === current.current.revision) {
          update(null, null);
          setError(e instanceof Error ? e.message : 'Wallet connection failed');
        }
      }
    };
    const accountsChanged = (accounts: string[]) => {
      // Invalidate synchronously, before any asynchronous signer lookup.
      const revision = update(accounts[0]?.toLowerCase() ?? null, current.current.chainId);
      void loadSigner(revision);
    };
    const chainChanged = (chain: string) => {
      const revision = update(current.current.address, Number(BigInt(chain)));
      void loadSigner(revision);
    };
    const disconnected = () => { update(null, null); };
    ethereum.on('accountsChanged', accountsChanged);
    ethereum.on('chainChanged', chainChanged);
    ethereum.on('disconnect', disconnected);
    connection.current = () => refresh(true);
    void refresh();
    return () => {
      mounted = false;
      current.current = { address: null, chainId: null, revision: current.current.revision + 1 };
      connection.current = null;
      ethereum.removeListener('accountsChanged', accountsChanged);
      ethereum.removeListener('chainChanged', chainChanged);
      ethereum.removeListener('disconnect', disconnected);
      p.destroy();
    };
  }, []);

  const connect = async () => {
    if (!connection.current) { setError('No Web3 wallet found. Please install MetaMask.'); return; }
    await connection.current();
  };
  // Only asks the wallet to switch; state still updates solely from the wallet's chainChanged event.
  const switchNetwork = async () => {
    const ethereum = window.ethereum;
    if (!ethereum) { setError('No Web3 wallet found. Please install MetaMask.'); return; }
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + TARGET_CHAIN_ID.toString(16) }] });
      setError(null);
    } catch (e) {
      const code = (e as { code?: number })?.code;
      setError(code === 4902
        ? `Chain ${TARGET_CHAIN_ID} is not added to your wallet. Add it, then switch to it.`
        : code === 4001 ? 'Network switch was rejected in the wallet.' : e instanceof Error ? e.message : 'Network switch failed');
    }
  };
  return <WalletContext.Provider value={{ ...snapshot, provider, signer, getSnapshot, connect, switchNetwork, error, isCorrectNetwork: snapshot.chainId === TARGET_CHAIN_ID }}>
    {children}
  </WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within a WalletProvider');
  return context;
}
