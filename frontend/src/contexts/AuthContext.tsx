import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { api, setCsrfToken, type SessionData } from '../services/api';
import { useWallet } from './WalletContext';

interface AuthContextType {
  wallet: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cookie-changing requests must finish in order, including across provider remounts.
// Ignoring a stale React response alone cannot undo a late Set-Cookie header.
let requests: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = requests.then(work);
  requests = result.catch(() => {});
  return result;
}

function validateSession(session: SessionData) {
  if (!session || typeof session.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrfToken) ||
      !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('Invalid or expired session response. Please sign in again.');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, chainId, revision, signer, isCorrectNetwork, getSnapshot } = useWallet();
  const scope = `${address?.toLowerCase() ?? ''}:${chainId}:${revision}`;
  const [session, setSession] = useState<{ wallet: string; scope: string; expiresAt: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const first = useRef(true);
  const knownSession = useRef<SessionData | null>(null);

  function begin() {
    const id = ++generation.current;
    const expected = typeof getSnapshot === 'function'
      ? getSnapshot()
      : { address: address ?? null, chainId: chainId ?? null, revision: revision ?? 0 };
    setSession(null);
    setCsrfToken(null);
    setError(null);
    setIsLoading(true);
    return () => {
      const now = typeof getSnapshot === 'function'
        ? getSnapshot()
        : { address: address ?? null, chainId: chainId ?? null, revision: revision ?? 0 };
      return mounted.current && id === generation.current && now.revision === expected.revision &&
        now.address === expected.address && now.chainId === expected.chainId;
    };
  }

  async function bootstrap(current: () => boolean, restore = false, reset = false) {
    if (!current()) return null;
    let data = knownSession.current;
    if (!data || Date.parse(data.expiresAt) <= Date.now()) data = await api.auth.getSession();
    if (!current()) return null;
    validateSession(data);
    setCsrfToken(data.csrfToken);
    const matches = isCorrectNetwork && address && data.wallet?.toLowerCase() === address.toLowerCase();
    if (reset || (data.wallet && (!restore || !matches))) {
      // Refresh even an anonymous session so old challenges cannot carry across wallet changes.
      knownSession.current = null;
      await api.auth.logout();
      if (!current()) return null;
      setCsrfToken(null);
      data = await api.auth.getSession();
      if (!current()) return null;
      validateSession(data);
      if (data.wallet !== null) throw new Error('Unable to reset the previous wallet session.');
      setCsrfToken(data.csrfToken);
    }
    knownSession.current = data;
    return data;
  }

  function failed(current: () => boolean, cause: unknown) {
    if (!current()) return;
    setSession(null);
    knownSession.current = null;
    setCsrfToken(null);
    setError(cause instanceof Error ? cause.message : 'Session request failed. Please try again.');
  }

  useEffect(() => {
    mounted.current = true;
    const restore = first.current;
    first.current = false;
    const current = begin();
    void serialized(async () => {
      try {
        const data = await bootstrap(current, restore, !restore);
        if (current() && data?.wallet && isCorrectNetwork && data.wallet.toLowerCase() === address?.toLowerCase()) {
          setSession({ wallet: data.wallet, scope, expiresAt: data.expiresAt });
        }
      } catch (cause) { failed(current, cause); }
      finally { if (current()) setIsLoading(false); }
    });
    return () => { mounted.current = false; generation.current++; };
    // Wallet scope changes deliberately reset the server session, not only the visible wallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const login = async () => {
    const current = begin();
    if (!address || !signer || !isCorrectNetwork) {
      failed(current, new Error('Connect your wallet on the configured network before signing in.'));
      if (current()) setIsLoading(false);
      return;
    }
    try {
      const challenge = await serialized(async () => {
        if (!await bootstrap(current)) return null;
        return api.auth.challenge(address);
      });
      if (!challenge || !current()) return;
      if ((await signer.getAddress()).toLowerCase() !== address.toLowerCase()) throw new Error('Wallet account changed. Please sign in again.');
      if (!current()) return;
      // Do not hold the HTTP queue open while the user considers the wallet prompt.
      const signature = await signer.signMessage(challenge.message);
      if (!current()) return;
      await serialized(async () => {
        if (!current()) return;
        knownSession.current = null;
        const data = await api.auth.verify(challenge.message, signature);
        if (!current()) return;
        validateSession(data);
        if (data.wallet?.toLowerCase() !== address.toLowerCase()) throw new Error('Authenticated wallet does not match the connected account.');
        setCsrfToken(data.csrfToken);
        knownSession.current = data;
        setSession({ wallet: data.wallet, scope, expiresAt: data.expiresAt });
      });
    } catch (cause) { failed(current, cause); }
    finally { if (current()) setIsLoading(false); }
  };

  const logout = async () => {
    const current = begin();
    try { await serialized(() => bootstrap(current, false, true)); }
    catch (cause) { failed(current, cause); }
    finally { if (current()) setIsLoading(false); }
  };

  const wallet = session?.scope === scope && isCorrectNetwork && session.wallet.toLowerCase() === address?.toLowerCase() &&
    Date.parse(session.expiresAt) > Date.now() ? session.wallet : null;
  return <AuthContext.Provider value={{ wallet, isAuthenticated: !!wallet, isLoading, login, logout, error }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
