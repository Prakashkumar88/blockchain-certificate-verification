// Regression: Dashboard "Complete" links to /issue?draft=<id>; the Issue page must load that draft
// at Review & Sign (same ID and SHA-256 digest) without creating a new draft or re-hashing a PDF.
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Issue from './pages/Issue';
import Dashboard from './pages/Dashboard';
import * as WalletModule from './contexts/WalletContext';
import * as AuthModule from './contexts/AuthContext';
import { api, ApiError } from './services/api';
import { registryInterface } from './services/preparedTransaction';
import { ALREADY_ISSUED_MESSAGE } from './services/apiErrors';

vi.mock('./services/api', async (original) => ({
  ...(await original<typeof import('./services/api')>()),
  api: {
    issuance: { getDraft: vi.fn(), getDrafts: vi.fn(), uploadDraft: vi.fn(), prepareIssue: vi.fn(), submitIssueTx: vi.fn() },
    certificates: {},
  },
}));

const user = '0x1111111111111111111111111111111111111111';
const contract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const draftId = '0x' + 'd1'.repeat(32);
const certificateId = '0x' + '11'.repeat(32);
const documentHash = '0x' + '22'.repeat(32);
const savedDraft = { draftId, certificateId, documentHash, expiresAt: '2099-01-01T00:00:00.000Z' };
const signer = { getAddress: vi.fn().mockResolvedValue(user), sendTransaction: vi.fn() };
const provider = {
  send: vi.fn((method: string) => Promise.resolve(method === 'eth_accounts' ? [user] : method === 'eth_chainId' ? '0x7a69' : null)),
};

// The app runs under <StrictMode> (main.tsx), which mounts, cleans up and re-runs effects in dev.
const openIssue = (path: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/issue" element={<Issue />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );

describe('Issue page: resume an existing draft vs new issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    import.meta.env.VITE_CONTRACT_ADDRESS = contract;
    import.meta.env.VITE_NETWORK_CHAIN_ID = '31337';
    vi.spyOn(WalletModule, 'useWallet').mockReturnValue({
      provider: provider as never, signer: signer as never, address: user, chainId: 31337, revision: 1,
      getSnapshot: () => ({ address: user, chainId: 31337, revision: 1 }),
      isCorrectNetwork: true, connect: vi.fn(), switchNetwork: vi.fn(), error: null,
    });
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      wallet: user, isAuthenticated: true, isLoading: false, login: vi.fn(), logout: vi.fn(), error: null,
    });
  });

  it('dashboard Complete links to the selected draft', async () => {
    vi.mocked(api.issuance.getDrafts).mockResolvedValue({ drafts: [savedDraft] });
    openIssue('/dashboard');
    const complete = await screen.findByText('Complete');
    expect(complete.closest('a')).toHaveAttribute('href', `/issue?draft=${draftId}`);
  });

  it('opens the selected draft at Review & Sign with its ID and hash, without uploading', async () => {
    vi.mocked(api.issuance.getDraft).mockResolvedValue(savedDraft);
    openIssue(`/issue?draft=${draftId}`);
    expect(await screen.findByText('Review Cryptographic Parameters')).toBeInTheDocument();
    expect(api.issuance.getDraft).toHaveBeenCalledWith(draftId);
    expect(screen.queryByText('Loading saved draft…')).not.toBeInTheDocument();
    expect(screen.getByText(certificateId)).toBeInTheDocument();
    expect(screen.getByText(documentHash)).toBeInTheDocument();
    expect(screen.queryByText('Upload & Prepare Draft')).not.toBeInTheDocument();
    expect(api.issuance.uploadDraft).not.toHaveBeenCalled();
  });

  it('completes the resumed draft using its own draft ID, ID and digest', async () => {
    vi.mocked(api.issuance.getDraft).mockResolvedValue(savedDraft);
    const data = registryInterface.encodeFunctionData('issueCertificate', [certificateId, documentHash]);
    vi.mocked(api.issuance.prepareIssue).mockResolvedValue({
      status: 'AWAITING_SIGNATURE',
      transaction: { to: contract, from: user, chainId: 31337, data, value: '0x0' },
    } as never);
    const tx = { hash: '0xresumetx', wait: vi.fn().mockResolvedValue({ status: 1 }) };
    signer.sendTransaction.mockResolvedValue(tx);
    vi.mocked(api.issuance.submitIssueTx).mockResolvedValue({ transactionHash: '0xresumetx', status: 'CONFIRMED', metadataStatus: 'SYNCED' } as never);

    openIssue(`/issue?draft=${draftId}`);
    fireEvent.click(await screen.findByText('Sign & Anchor to Blockchain'));
    expect(await screen.findByText('Certificate Successfully Anchored')).toBeInTheDocument();
    expect(api.issuance.prepareIssue).toHaveBeenCalledWith(draftId);
    expect(signer.sendTransaction).toHaveBeenCalledWith({ to: contract, from: user, chainId: 31337, data, value: 0n });
    expect(api.issuance.submitIssueTx).toHaveBeenCalledWith(draftId, '0xresumetx');
    expect(api.issuance.uploadDraft).not.toHaveBeenCalled();
  });

  it('expired or missing draft shows an error instead of a blank form or review', async () => {
    vi.mocked(api.issuance.getDraft).mockRejectedValue(new ApiError(404, 'DRAFT_NOT_FOUND', 'DRAFT_NOT_FOUND'));
    openIssue(`/issue?draft=${draftId}`);
    expect(await screen.findByText(/not found or has expired/)).toBeInTheDocument();
    expect(screen.queryByText('Review Cryptographic Parameters')).not.toBeInTheDocument();
    expect(api.issuance.uploadDraft).not.toHaveBeenCalled();
  });

  it('rejects a draft response for a different draft', async () => {
    vi.mocked(api.issuance.getDraft).mockResolvedValue({ ...savedDraft, draftId: '0x' + 'ee'.repeat(32) });
    openIssue(`/issue?draft=${draftId}`);
    expect(await screen.findByText(/does not match the selected draft/)).toBeInTheDocument();
    expect(screen.queryByText('Review Cryptographic Parameters')).not.toBeInTheDocument();
  });

  it('malformed draft link is rejected without calling the API', async () => {
    openIssue('/issue?draft=not-a-draft');
    expect(await screen.findByText(/Invalid draft link/)).toBeInTheDocument();
    expect(api.issuance.getDraft).not.toHaveBeenCalled();
  });

  it('dashboard offers Complete only for drafts not yet on-chain', async () => {
    const issuedDraft = { ...savedDraft, draftId: '0x' + 'd2'.repeat(32), certificateId: '0x' + '33'.repeat(32), issued: true };
    vi.mocked(api.issuance.getDrafts).mockResolvedValue({ drafts: [{ ...savedDraft, issued: false }, issuedDraft] });
    openIssue('/dashboard');
    expect(await screen.findByText('Already Issued')).toBeInTheDocument();
    const links = screen.getAllByText('Complete').map((el) => el.closest('a')?.getAttribute('href'));
    expect(links).toEqual([`/issue?draft=${draftId}`]);
  });

  it('resuming an already-issued draft explains it and never prepares a transaction', async () => {
    vi.mocked(api.issuance.getDraft).mockResolvedValue({ ...savedDraft, issued: true });
    openIssue(`/issue?draft=${draftId}`);
    expect(await screen.findByText(ALREADY_ISSUED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('Sign & Anchor to Blockchain')).not.toBeInTheDocument();
    expect(api.issuance.prepareIssue).not.toHaveBeenCalled();
    expect(api.issuance.uploadDraft).not.toHaveBeenCalled();
  });

  it('a 409 CertificateAlreadyExists from prepare is explained and nothing is sent to the wallet', async () => {
    vi.mocked(api.issuance.getDraft).mockResolvedValue({ ...savedDraft, issued: false });
    vi.mocked(api.issuance.prepareIssue).mockRejectedValue(
      new ApiError(409, 'TRANSACTION_WOULD_REVERT', 'TRANSACTION_WOULD_REVERT', {
        error: { code: 'TRANSACTION_WOULD_REVERT', contractError: 'CertificateAlreadyExists' },
      }),
    );
    openIssue(`/issue?draft=${draftId}`);
    fireEvent.click(await screen.findByText('Sign & Anchor to Blockchain'));
    expect(await screen.findByText(ALREADY_ISSUED_MESSAGE)).toBeInTheDocument();
    expect(api.issuance.prepareIssue).toHaveBeenCalledWith(draftId);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(screen.queryByText('Certificate Successfully Anchored')).not.toBeInTheDocument();
  });

  it('new issuance (no draft param) still starts at upload and creates a draft', async () => {
    vi.mocked(api.issuance.uploadDraft).mockResolvedValue({ ...savedDraft, draftId: '0x' + 'aa'.repeat(32) });
    openIssue('/issue');
    expect(screen.getByText('Upload & Prepare Draft')).toBeInTheDocument();
    const file = new File(['%PDF-1.4 new %%EOF'], 'new.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByText('Upload & Prepare Draft'));
    expect(await screen.findByText('Review Cryptographic Parameters')).toBeInTheDocument();
    await waitFor(() => expect(api.issuance.uploadDraft).toHaveBeenCalledTimes(1));
    expect(api.issuance.getDraft).not.toHaveBeenCalled();
  });
});
