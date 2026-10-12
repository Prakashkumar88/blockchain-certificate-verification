// Regression: a SIWE-authenticated wallet without ISSUER_ROLE must never be shown as a verified
// issuer; the indicator follows the backend's on-chain issuer check (ISSUER_REQUIRED → 403).
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Dashboard from './pages/Dashboard';
import Issue from './pages/Issue';
import * as WalletModule from './contexts/WalletContext';
import * as AuthModule from './contexts/AuthContext';
import { api, ApiError } from './services/api';
import { ISSUER_REQUIRED_MESSAGE } from './services/apiErrors';

vi.mock('./services/api', async (original) => ({
  ...(await original<typeof import('./services/api')>()),
  api: { issuance: { getDrafts: vi.fn(), uploadDraft: vi.fn() }, certificates: {} },
}));

const nonIssuer = '0x6ed1afb25232805003e08e9e1c6f83ff0751097f';
const issuerRequired = () => new ApiError(403, 'ISSUER_REQUIRED', 'ISSUER_REQUIRED', { error: { code: 'ISSUER_REQUIRED' } });
const page = (ui: ReactElement) => render(<BrowserRouter>{ui}</BrowserRouter>);

describe('issuer role indicator and ISSUER_REQUIRED handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(WalletModule, 'useWallet').mockReturnValue({
      provider: {} as never, signer: {} as never, address: nonIssuer, chainId: 31337, revision: 1,
      getSnapshot: () => ({ address: nonIssuer, chainId: 31337, revision: 1 }),
      isCorrectNetwork: true, connect: vi.fn(), switchNetwork: vi.fn(), error: null,
    });
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      wallet: nonIssuer, isAuthenticated: true, isLoading: false, login: vi.fn(), logout: vi.fn(), error: null,
    });
  });

  it('authenticated non-issuer is shown as not authorized, never as a verified issuer', async () => {
    vi.mocked(api.issuance.getDrafts).mockRejectedValue(issuerRequired());
    page(<Dashboard />);
    expect(await screen.findByText('Not an Authorized Issuer')).toBeInTheDocument();
    expect(screen.queryByText('Verified Issuer Role')).not.toBeInTheDocument();
    expect(screen.getByText(ISSUER_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it('shows Verified Issuer Role only after the backend issuer-only request succeeds', async () => {
    let resolve!: (v: { drafts: never[] }) => void;
    vi.mocked(api.issuance.getDrafts).mockReturnValue(new Promise((r) => { resolve = r; }));
    page(<Dashboard />);
    expect(await screen.findByText('Checking Issuer Role…')).toBeInTheDocument();
    expect(screen.queryByText('Verified Issuer Role')).not.toBeInTheDocument();
    resolve({ drafts: [] });
    expect(await screen.findByText('Verified Issuer Role')).toBeInTheDocument();
  });

  it('a non-role failure is reported as unverified, not as a verified issuer', async () => {
    vi.mocked(api.issuance.getDrafts).mockRejectedValue(new Error('API offline'));
    page(<Dashboard />);
    expect(await screen.findByText('Issuer Role Unverified')).toBeInTheDocument();
    expect(screen.queryByText('Verified Issuer Role')).not.toBeInTheDocument();
  });

  it('issuance upload explains ISSUER_REQUIRED instead of showing the bare code', async () => {
    vi.mocked(api.issuance.uploadDraft).mockRejectedValue(issuerRequired());
    page(<Issue />);
    const file = new File(['%PDF-1.4 dummy %%EOF'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByText('Upload & Prepare Draft'));
    expect(await screen.findByText(ISSUER_REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('Review Cryptographic Parameters')).not.toBeInTheDocument();
  });
});
