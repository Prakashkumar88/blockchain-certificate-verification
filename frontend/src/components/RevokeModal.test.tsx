import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RevokeModal } from './RevokeModal';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from '../services/api';
import * as WalletModule from '../contexts/WalletContext';
import { registryInterface } from '../services/preparedTransaction';

vi.mock('../services/api', () => ({
  api: {
    certificates: {
      revokePrepare: vi.fn(),
      revokeTransaction: vi.fn(),
    }
  }
}));

describe('RevokeModal Component', () => {
  const userAddress = '0x1111111111111111111111111111111111111111';
  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const testCertId = '0x' + 'aa'.repeat(32);

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
      error: null,
    });
  });

  it('does not render when isOpen is false', () => {
    render(<RevokeModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Revoke Certificate Record')).not.toBeInTheDocument();
  });

  it('renders irreversible warning and requires explicit acknowledgement', () => {
    render(<RevokeModal isOpen={true} onClose={vi.fn()} initialCertId={testCertId} />);
    
    expect(screen.getByText('Revoke Certificate Record')).toBeInTheDocument();
    expect(screen.getByText('Irreversible Cryptographic Revocation')).toBeInTheDocument();
    expect(screen.getByText(/Warning: Revoking a certificate is permanently anchored/)).toBeInTheDocument();
    
    const submitBtn = screen.getByText('Confirm & Permanently Revoke');
    expect(submitBtn).toBeDisabled();

    // Check the acknowledgement checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(submitBtn).not.toBeDisabled();
  });

  it('executes revocation flow: prepare, sign, wait receipt, and reconcile', async () => {
    const expectedData = registryInterface.encodeFunctionData('revokeCertificate', [testCertId]);
    const mockTx = {
      hash: '0xrevoketx123',
      wait: vi.fn().mockResolvedValue({ status: 1 }),
    };
    mockSigner.sendTransaction.mockResolvedValue(mockTx);
    (api.certificates.revokePrepare as any).mockResolvedValue({
      status: 'AWAITING_SIGNATURE',
      transaction: {
        to: contractAddress,
        from: userAddress,
        chainId: 31337,
        data: expectedData,
        value: '0x0',
      }
    });
    (api.certificates.revokeTransaction as any).mockResolvedValue({
      transactionHash: '0xrevoketx123',
      status: 'CONFIRMED',
      metadataStatus: 'SYNCED'
    });

    render(<RevokeModal isOpen={true} onClose={vi.fn()} initialCertId={testCertId} />);
    
    // Check acknowledgement
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Confirm & Permanently Revoke'));

    await waitFor(() => {
      expect(api.certificates.revokePrepare).toHaveBeenCalledWith(testCertId);
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: contractAddress,
        from: userAddress,
        chainId: 31337,
        data: expectedData,
        value: 0n,
      });
      expect(mockTx.wait).toHaveBeenCalledWith(1);
      expect(api.certificates.revokeTransaction).toHaveBeenCalledWith(testCertId, '0xrevoketx123');
    });

    expect(await screen.findByText('Revocation Successfully Confirmed')).toBeInTheDocument();
  });

  it('handles user rejection gracefully without reporting success', async () => {
    const expectedData = registryInterface.encodeFunctionData('revokeCertificate', [testCertId]);
    (api.certificates.revokePrepare as any).mockResolvedValue({
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

    render(<RevokeModal isOpen={true} onClose={vi.fn()} initialCertId={testCertId} />);
    
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Confirm & Permanently Revoke'));

    expect(await screen.findByText(/User rejected the transaction signature/)).toBeInTheDocument();
    expect(screen.queryByText('Revocation Successfully Confirmed')).not.toBeInTheDocument();
  });
});
