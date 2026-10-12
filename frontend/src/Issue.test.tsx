import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Issue from './pages/Issue';
import * as WalletModule from './contexts/WalletContext';
import * as AuthModule from './contexts/AuthContext';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from './services/api';
import { registryInterface } from './services/preparedTransaction';

vi.mock('./services/api', () => ({
  api: {
    issuance: {
      uploadDraft: vi.fn(),
      prepareIssue: vi.fn(),
      submitIssueTx: vi.fn(),
    }
  }
}));

describe('Issue Page', () => {
  const userAddress = '0x1111111111111111111111111111111111111111';
  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const testCertId = '0x' + '11'.repeat(32);
  const testHash = '0x' + '22'.repeat(32);

  const mockSigner = {
    getAddress: vi.fn().mockResolvedValue(userAddress),
    sendTransaction: vi.fn(),
  };

  const mockProvider = {
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'eth_accounts') return Promise.resolve([userAddress]);
      if (method === 'eth_chainId') return Promise.resolve('0x7a69');
      return Promise.resolve(null);
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    import.meta.env.VITE_CONTRACT_ADDRESS = contractAddress;
    import.meta.env.VITE_NETWORK_CHAIN_ID = '31337';

    vi.spyOn(WalletModule, 'useWallet').mockReturnValue({
      provider: mockProvider as any,
      signer: mockSigner as any,
      address: userAddress,
      chainId: 31337,
      revision: 1,
      getSnapshot: () => ({ address: userAddress, chainId: 31337, revision: 1 }),
      isCorrectNetwork: true,
      connect: vi.fn(),
    switchNetwork: vi.fn(),
      error: null,
    });
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      wallet: userAddress,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      error: null,
    });
  });

  it('renders issue page and requires PDF upload', () => {
    render(
      <BrowserRouter>
        <Issue />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Issue Certificate' })).toBeInTheDocument();
    const uploadBtn = screen.getByText('Upload & Prepare Draft');
    expect(uploadBtn).toBeDisabled();
  });

  it('uploads draft, advances to review step, signs on-chain, and confirms receipt', async () => {
    (api.issuance.uploadDraft as any).mockResolvedValue({
      draftId: '0xdraft1',
      certificateId: testCertId,
      documentHash: testHash,
    });
    const expectedData = registryInterface.encodeFunctionData('issueCertificate', [testCertId, testHash]);
    (api.issuance.prepareIssue as any).mockResolvedValue({
      status: 'AWAITING_SIGNATURE',
      transaction: {
        to: contractAddress,
        from: userAddress,
        chainId: 31337,
        data: expectedData,
        value: '0x0',
      }
    });
    const mockTx = {
      hash: '0xissuetx1',
      wait: vi.fn().mockResolvedValue({ status: 1 }),
    };
    mockSigner.sendTransaction.mockResolvedValue(mockTx);
    (api.issuance.submitIssueTx as any).mockResolvedValue({
      transactionHash: '0xissuetx1',
      status: 'CONFIRMED',
      metadataStatus: 'SYNCED',
    });

    render(
      <BrowserRouter>
        <Issue />
      </BrowserRouter>
    );

    // Attach PDF file
    const file = new File(['%PDF-1.4 content %%EOF'], 'diploma.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    const submitBtn = screen.getByText('Upload & Prepare Draft');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Await review step
    expect(await screen.findByText('Review Cryptographic Parameters')).toBeInTheDocument();
    expect(screen.getByText(testCertId)).toBeInTheDocument();
    expect(screen.getByText(testHash)).toBeInTheDocument();

    // Click Sign & Anchor
    const signBtn = screen.getByText('Sign & Anchor to Blockchain');
    fireEvent.click(signBtn);

    await waitFor(() => {
      expect(api.issuance.prepareIssue).toHaveBeenCalledWith('0xdraft1');
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: contractAddress,
        from: userAddress,
        chainId: 31337,
        data: expectedData,
        value: 0n,
      });
      expect(mockTx.wait).toHaveBeenCalledWith(1);
      expect(api.issuance.submitIssueTx).toHaveBeenCalledWith('0xdraft1', '0xissuetx1');
    });

    // Check confirmed receipt
    expect(await screen.findByText('Certificate Successfully Anchored')).toBeInTheDocument();
  });

  it('prevents success and displays error when user rejects transaction', async () => {
    (api.issuance.uploadDraft as any).mockResolvedValue({
      draftId: '0xdraft2',
      certificateId: testCertId,
      documentHash: testHash,
    });
    const expectedData = registryInterface.encodeFunctionData('issueCertificate', [testCertId, testHash]);
    (api.issuance.prepareIssue as any).mockResolvedValue({
      status: 'AWAITING_SIGNATURE',
      transaction: {
        to: contractAddress,
        from: userAddress,
        chainId: 31337,
        data: expectedData,
        value: '0x0',
      }
    });
    mockSigner.sendTransaction.mockRejectedValue(new Error('User rejected the transaction signature'));

    render(
      <BrowserRouter>
        <Issue />
      </BrowserRouter>
    );

    const file = new File(['%PDF-1.4 dummy %%EOF'], 'test.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByText('Upload & Prepare Draft'));
    expect(await screen.findByText('Review Cryptographic Parameters')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sign & Anchor to Blockchain'));

    expect(await screen.findByText(/User rejected the transaction signature/)).toBeInTheDocument();
    expect(screen.queryByText('Certificate Successfully Anchored')).not.toBeInTheDocument();
  });
});
