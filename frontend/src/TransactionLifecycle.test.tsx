import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Issue from './pages/Issue';
import BatchIssue from './pages/BatchIssue';
import { RevokeModal } from './components/RevokeModal';
import * as WalletModule from './contexts/WalletContext';
import * as AuthModule from './contexts/AuthContext';
import { api, ApiError } from './services/api';
import { registryInterface } from './services/preparedTransaction';

vi.mock('./services/api', async (original) => ({
  ...await original<typeof import('./services/api')>(),
  api: {
    issuance: {
      uploadDraft: vi.fn(), getDrafts: vi.fn(), prepareIssue: vi.fn(),
      prepareBatch: vi.fn(), submitIssueTx: vi.fn(), submitBatchTx: vi.fn(),
    },
    certificates: { revokePrepare: vi.fn(), revokeTransaction: vi.fn() },
  },
}));

const hash = '0x' + 'ab'.repeat(32);
const confirmed = { transactionHash: hash, status: 'CONFIRMED', metadataStatus: 'SYNCED' } as const;
const draft = { draftId: 'draft-1', certificateId: '0x' + '12'.repeat(32), documentHash: '0x' + '34'.repeat(32), expiresAt: '2099-01-01' };

const issuerAddress = '0x1111111111111111111111111111111111111111';
const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

const signer = {
  getAddress: vi.fn().mockResolvedValue(issuerAddress),
  sendTransaction: vi.fn(),
};
const receiptWait = vi.fn();

const mockProvider = {
  send: vi.fn().mockImplementation((method: string) => {
    if (method === 'eth_accounts') return Promise.resolve([issuerAddress]);
    if (method === 'eth_chainId') return Promise.resolve('0x7a69');
    return Promise.resolve(null);
  }),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flows = [
  { name: 'individual issuance', component: <Issue />, success: 'Certificate Successfully Anchored', reconcile: api.issuance.submitIssueTx },
  { name: 'batch issuance', component: <BatchIssue />, success: 'Batch Issuance Confirmed', reconcile: api.issuance.submitBatchTx },
  { name: 'revocation', component: <RevokeModal isOpen onClose={() => {}} initialCertId={draft.certificateId} />, success: 'Revocation Successfully Confirmed', reconcile: api.certificates.revokeTransaction },
];

async function start(flow: typeof flows[number]) {
  render(<BrowserRouter>{flow.component}</BrowserRouter>);
  if (flow.name === 'individual issuance') {
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [new File(['%PDF-1.4\n%%EOF'], 'certificate.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByText('Upload & Prepare Draft'));
    fireEvent.click(await screen.findByText('Sign & Anchor to Blockchain'));
  } else if (flow.name === 'batch issuance') {
    await screen.findByText(draft.certificateId);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Sign & Anchor Batch (1)'));
  } else {
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Confirm & Permanently Revoke'));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  import.meta.env.VITE_CONTRACT_ADDRESS = contractAddress;
  import.meta.env.VITE_NETWORK_CHAIN_ID = '31337';

  signer.getAddress = vi.fn().mockResolvedValue(issuerAddress);
  mockProvider.send = vi.fn().mockImplementation((method: string) => {
    if (method === 'eth_accounts') return Promise.resolve([issuerAddress]);
    if (method === 'eth_chainId') return Promise.resolve('0x7a69');
    return Promise.resolve(null);
  });

  vi.spyOn(WalletModule, 'useWallet').mockReturnValue({
    signer: signer as any,
    provider: mockProvider as any,
    isCorrectNetwork: true,
    address: issuerAddress,
    chainId: 31337,
    revision: 1,
    getSnapshot: () => ({ address: issuerAddress, chainId: 31337, revision: 1 }),
    connect: vi.fn(),
    switchNetwork: vi.fn(),
    error: null,
  });
  vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
    wallet: issuerAddress,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
  });

  receiptWait.mockResolvedValue({ status: 1 });
  signer.sendTransaction.mockResolvedValue({ hash, wait: receiptWait });
  vi.mocked(api.issuance.uploadDraft).mockResolvedValue(draft);
  vi.mocked(api.issuance.getDrafts).mockResolvedValue({ drafts: [draft] });

  const issueData = registryInterface.encodeFunctionData('issueCertificate', [draft.certificateId, draft.documentHash]);
  const batchData = registryInterface.encodeFunctionData('issueBatch', [[draft.certificateId], [draft.documentHash]]);
  const revokeData = registryInterface.encodeFunctionData('revokeCertificate', [draft.certificateId]);

  vi.mocked(api.issuance.prepareIssue).mockResolvedValue({
    status: 'AWAITING_SIGNATURE',
    transaction: { to: contractAddress, from: issuerAddress, chainId: 31337, data: issueData, value: '0x0' },
  });
  vi.mocked(api.issuance.prepareBatch).mockResolvedValue({
    status: 'AWAITING_SIGNATURE',
    transaction: { to: contractAddress, from: issuerAddress, chainId: 31337, data: batchData, value: '0x0' },
    maxBatchSize: 50,
  });
  vi.mocked(api.certificates.revokePrepare).mockResolvedValue({
    status: 'AWAITING_SIGNATURE',
    transaction: { to: contractAddress, from: issuerAddress, chainId: 31337, data: revokeData, value: '0x0' },
  });
  for (const flow of flows) vi.mocked(flow.reconcile).mockResolvedValue(confirmed);
});

describe.each(flows)('$name lifecycle', (flow) => {
  it('does not succeed while the receipt is pending, then succeeds after reconciliation', async () => {
    const receipt = deferred<{ status: number }>();
    receiptWait.mockReturnValue(receipt.promise);
    await start(flow);
    await screen.findByText('Transaction submitted. Waiting for receipt confirmation.');
    expect(screen.queryByText(flow.success)).not.toBeInTheDocument();
    expect(flow.reconcile).not.toHaveBeenCalled();
    expect(screen.getByText('Check transaction status')).toBeDisabled();
    await act(async () => { receipt.resolve({ status: 1 }); });
    expect(await screen.findByText(flow.success)).toBeInTheDocument();
  });

  it('waits for reconciliation after a successful receipt', async () => {
    const reconciliation = deferred<typeof confirmed>();
    vi.mocked(flow.reconcile).mockReturnValue(reconciliation.promise);
    await start(flow);
    await screen.findByText('Checking receipt and reconciling with the registry.');
    expect(screen.queryByText(flow.success)).not.toBeInTheDocument();
    await act(async () => { reconciliation.resolve(confirmed); });
    expect(await screen.findByText(flow.success)).toBeInTheDocument();
  });

  it.each(['PENDING', 'CONFIRMATION_PENDING', 'UNRESOLVED'] as const)('keeps %s pending and retries the same hash without broadcasting again', async (status) => {
    vi.mocked(flow.reconcile).mockResolvedValue({ transactionHash: hash, status, metadataStatus: 'NOT_UPDATED' });
    await start(flow);
    await screen.findByText(`Confirmation is not established (${status}). Check the existing transaction again.`);
    expect(screen.queryByText(flow.success)).not.toBeInTheDocument();
    expect(screen.getByText(/Do not submit it again/)).toBeInTheDocument();
    const firstCall = vi.mocked(flow.reconcile).mock.calls[0];
    vi.mocked(flow.reconcile).mockResolvedValue(confirmed);
    fireEvent.click(screen.getByText('Check transaction status'));
    expect(await screen.findByText(flow.success)).toBeInTheDocument();
    expect(vi.mocked(flow.reconcile).mock.calls[1]).toEqual(firstCall);
    expect(firstCall.at(-1)).toBe(hash);
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it.each(['receipt failure', 'reverted receipt', 'missing receipt', 'reverted reconciliation', 'network failure', 'wrong hash'])('does not show success for %s and keeps errors visible', async (failure) => {
    if (failure === 'receipt failure') receiptWait.mockRejectedValue(new Error('Receipt RPC failed'));
    if (failure === 'reverted receipt') receiptWait.mockResolvedValue({ status: 0 });
    if (failure === 'missing receipt') receiptWait.mockResolvedValue(null);
    if (failure === 'reverted reconciliation') vi.mocked(flow.reconcile).mockRejectedValue(new ApiError(409, 'REVERTED', 'Reverted', { ...confirmed, status: 'REVERTED', metadataStatus: 'NOT_UPDATED' }));
    if (failure === 'network failure') vi.mocked(flow.reconcile).mockRejectedValue(new Error('API offline'));
    if (failure === 'wrong hash') vi.mocked(flow.reconcile).mockResolvedValue({ ...confirmed, transactionHash: '0xwrong' });
    await start(flow);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText(flow.success)).not.toBeInTheDocument();
    expect(screen.getByText(/Transaction hash:/)).toHaveTextContent(hash);
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('preserves confirmed-on-chain recovery after a 503 and only retries reconciliation', async () => {
    vi.mocked(flow.reconcile).mockRejectedValue(new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable', {
      ...confirmed, metadataStatus: 'RECONCILIATION_REQUIRED', retry: { transactionHash: hash },
    }));
    await start(flow);
    await screen.findByText(/Confirmed on-chain, but metadata reconciliation is incomplete/);
    expect(screen.queryByText(flow.success)).not.toBeInTheDocument();
    vi.mocked(flow.reconcile).mockResolvedValue(confirmed);
    fireEvent.click(screen.getByText('Check transaction status'));
    expect(await screen.findByText(flow.success)).toBeInTheDocument();
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('can establish receipt evidence through the backend after wallet receipt polling failed', async () => {
    receiptWait.mockRejectedValue(new Error('Receipt RPC failed'));
    await start(flow);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Check transaction status'));
    expect(await screen.findByText(flow.success)).toBeInTheDocument();
    await waitFor(() => expect(signer.sendTransaction).toHaveBeenCalledTimes(1));
  });
});

it('keeps revocation recovery when closed and reopened, then clears only a completed operation', async () => {
  vi.mocked(api.certificates.revokeTransaction).mockResolvedValue({ transactionHash: hash, status: 'UNRESOLVED', metadataStatus: 'NOT_UPDATED' });
  const onClose = vi.fn();
  const props = { onClose, initialCertId: draft.certificateId };
  const view = render(<RevokeModal {...props} isOpen />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Confirm & Permanently Revoke'));
  await screen.findByText(/Confirmation is not established/);
  fireEvent.click(screen.getByText('Cancel'));
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<RevokeModal {...props} isOpen={false} />);
  view.rerender(<RevokeModal {...props} isOpen />);
  expect(screen.getByText(/Transaction hash:/)).toHaveTextContent(hash);
  expect(screen.getByText('Confirm & Permanently Revoke')).toBeDisabled();
  vi.mocked(api.certificates.revokeTransaction).mockResolvedValue(confirmed);
  fireEvent.click(screen.getByText('Check transaction status'));
  await screen.findByText('Revocation Successfully Confirmed');
  fireEvent.click(screen.getByText('Done'));
  view.rerender(<RevokeModal {...props} isOpen={false} />);
  view.rerender(<RevokeModal {...props} isOpen />);
  expect(screen.queryByText('Revocation Successfully Confirmed')).not.toBeInTheDocument();
  expect(screen.queryByText(/Transaction hash:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Certificate ID to Revoke/)).not.toBeDisabled();
  expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
});
