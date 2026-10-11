import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as WalletModule from './WalletContext';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    auth: {
      getSession: vi.fn(),
      challenge: vi.fn(),
      verify: vi.fn(),
      logout: vi.fn(),
    }
  },
  setCsrfToken: vi.fn(),
}));

function TestAuthConsumer() {
  const { wallet, isAuthenticated, isLoading, login, logout, error } = useAuth();
  return (
    <div>
      <span data-testid="status">{isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
      <span data-testid="wallet">{wallet || 'none'}</span>
      {error && <span data-testid="error">{error}</span>}
      <button onClick={login}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

describe('AuthContext (Finding 5 regression tests)', () => {
  const walletA = '0x1111111111111111111111111111111111111111';
  const walletB = '0x2222222222222222222222222222222222222222';
  const validCsrf = 'a'.repeat(64);
  const validCsrf2 = 'b'.repeat(64);
  const futureExpiresAt = '2099-01-01T00:00:00.000Z';

  const mockSigner = {
    getAddress: vi.fn().mockResolvedValue(walletA),
    signMessage: vi.fn(),
  };

  let currentWalletState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSigner.getAddress = vi.fn().mockResolvedValue(walletA);

    currentWalletState = {
      provider: {} as any,
      signer: mockSigner as any,
      address: walletA,
      chainId: 31337,
      revision: 1,
      getSnapshot: () => ({ address: currentWalletState.address, chainId: currentWalletState.chainId, revision: currentWalletState.revision }),
      isCorrectNetwork: true,
      connect: vi.fn(),
      error: null,
    };

    vi.spyOn(WalletModule, 'useWallet').mockImplementation(() => currentWalletState);
  });

  it('fetches existing session on mount and restores authenticated state', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: walletA,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent(walletA);
    });
  });

  it('handles initial anonymous session on mount', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });
  });

  it('invalidates mismatched initial session on mount and refreshes anonymous session', async () => {
    // Backend reports session for walletB, but connected wallet is walletA
    (api.auth.getSession as any)
      .mockResolvedValueOnce({
        wallet: walletB,
        csrfToken: validCsrf,
        expiresAt: futureExpiresAt,
      })
      .mockResolvedValueOnce({
        wallet: null,
        csrfToken: validCsrf2,
        expiresAt: futureExpiresAt,
      });
    (api.auth.logout as any).mockResolvedValue({});

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(api.auth.logout).toHaveBeenCalled();
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });
  });

  it('supports login -> logout -> login lifecycle without page reload', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });
    (api.auth.challenge as any).mockResolvedValue({
      message: 'Sign in with Ethereum',
      expiresAt: futureExpiresAt,
    });
    mockSigner.signMessage.mockResolvedValue('0xvalidsig1');
    (api.auth.verify as any).mockResolvedValue({
      wallet: walletA,
      csrfToken: validCsrf2,
      expiresAt: futureExpiresAt,
    });
    (api.auth.logout as any).mockResolvedValue({});

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    // Initial state: unauthenticated
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });

    // 1. First login
    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(api.auth.challenge).toHaveBeenCalledWith(walletA);
      expect(mockSigner.signMessage).toHaveBeenCalledWith('Sign in with Ethereum');
      expect(api.auth.verify).toHaveBeenCalledWith('Sign in with Ethereum', '0xvalidsig1');
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent(walletA);
    });

    // 2. Logout
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });

    fireEvent.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(api.auth.logout).toHaveBeenCalled();
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });

    // 3. Second login without reload
    mockSigner.signMessage.mockResolvedValue('0xvalidsig2');
    (api.auth.verify as any).mockResolvedValue({
      wallet: walletA,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });

    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent(walletA);
    });
  });

  it('switching accounts invalidates stale authentication and refreshes anonymous session', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: walletA,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });
    (api.auth.logout as any).mockResolvedValue({});

    const { rerender } = render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent(walletA);
    });

    // Simulate account switch in wallet to walletB
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf2,
      expiresAt: futureExpiresAt,
    });

    currentWalletState = {
      ...currentWalletState,
      address: walletB,
      revision: 2,
    };

    rerender(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(api.auth.logout).toHaveBeenCalled();
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });
  });

  it('wallet disconnection clears stale authenticated state', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: walletA,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });
    (api.auth.logout as any).mockResolvedValue({});

    const { rerender } = render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    // Simulate wallet disconnect
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf2,
      expiresAt: futureExpiresAt,
    });

    currentWalletState = {
      ...currentWalletState,
      address: null,
      chainId: null,
      revision: 2,
    };

    rerender(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });
  });

  it('late asynchronous response cannot restore authentication for a previous account', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });

    let resolveVerify: any;
    const verifyPromise = new Promise((resolve) => {
      resolveVerify = resolve;
    });

    (api.auth.challenge as any).mockResolvedValue({
      message: 'Challenge A',
      expiresAt: futureExpiresAt,
    });
    mockSigner.signMessage.mockResolvedValue('0xsigA');
    (api.auth.verify as any).mockReturnValue(verifyPromise);

    const { rerender } = render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });

    // Start login for walletA
    fireEvent.click(screen.getByText('Login'));

    // Wait until challenge is fetched and signed
    await waitFor(() => {
      expect(mockSigner.signMessage).toHaveBeenCalledWith('Challenge A');
      expect(api.auth.verify).toHaveBeenCalledWith('Challenge A', '0xsigA');
    });

    // While verify is still in flight, wallet switches to walletB
    currentWalletState = {
      ...currentWalletState,
      address: walletB,
      revision: 2,
    };

    rerender(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    // Now resolve the late verify response for walletA
    await act(async () => {
      resolveVerify({
        wallet: walletA,
        csrfToken: validCsrf,
        expiresAt: futureExpiresAt,
      });
    });

    // Verify walletA is NOT authenticated
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
    });
  });

  it('authentication failure leaves a safe unauthenticated state with error', async () => {
    (api.auth.getSession as any).mockResolvedValue({
      wallet: null,
      csrfToken: validCsrf,
      expiresAt: futureExpiresAt,
    });
    (api.auth.challenge as any).mockResolvedValue({
      message: 'Sign in with Ethereum',
      expiresAt: futureExpiresAt,
    });
    mockSigner.signMessage.mockRejectedValue(new Error('User rejected the signature request'));

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });

    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('wallet')).toHaveTextContent('none');
      expect(screen.getByTestId('error')).toHaveTextContent('User rejected the signature request');
    });
  });
});
