import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZeroAddress, ZeroHash } from 'ethers';
import {
  registryConfig,
  registryInterface,
  submitPreparedTransaction,
  type CertificateIntent,
} from './preparedTransaction';
import type { PreparedTransaction } from './api';

describe('preparedTransaction service (Finding 4 regression tests)', () => {
  const contractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const userAddress = '0x1111111111111111111111111111111111111111';
  const targetChainId = 31337;

  const validCertId = '0x' + 'aa'.repeat(32);
  const validCertId2 = '0x' + 'bb'.repeat(32);
  const validDigest = '0x' + 'cc'.repeat(32);
  const validDigest2 = '0x' + 'dd'.repeat(32);

  let mockSigner: any;
  let mockProvider: any;
  let snapshot: { address: string | null; chainId: number | null; revision: number };

  beforeEach(() => {
    vi.clearAllMocks();
    import.meta.env.VITE_CONTRACT_ADDRESS = contractAddress;
    import.meta.env.VITE_NETWORK_CHAIN_ID = '31337';

    snapshot = {
      address: userAddress,
      chainId: targetChainId,
      revision: 1,
    };

    mockSigner = {
      getAddress: vi.fn().mockResolvedValue(userAddress),
      sendTransaction: vi.fn().mockResolvedValue({ hash: '0xgoodtx', wait: vi.fn() }),
    };

    mockProvider = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'eth_accounts') return Promise.resolve([userAddress]);
        if (method === 'eth_chainId') return Promise.resolve('0x7a69'); // 31337 in hex
        return Promise.resolve(null);
      }),
    };
  });

  describe('registryConfig', () => {
    it('returns configured registry address and chain ID', () => {
      const config = registryConfig();
      expect(config.address.toLowerCase()).toBe(contractAddress.toLowerCase());
      expect(config.chainId).toBe(31337);
    });

    it('rejects ZeroAddress or missing address', () => {
      import.meta.env.VITE_CONTRACT_ADDRESS = ZeroAddress;
      expect(() => registryConfig()).toThrow('Configure a valid registry address and chain before submitting transactions.');
    });

    it('rejects invalid or non-numeric chain ID', () => {
      import.meta.env.VITE_NETWORK_CHAIN_ID = '-1';
      expect(() => registryConfig()).toThrow('Configure a valid registry address and chain before submitting transactions.');
    });
  });

  describe('submitPreparedTransaction - happy paths', () => {
    it('validates and submits an individual issuance transaction', async () => {
      const intent: CertificateIntent = {
        kind: 'issue',
        ids: [validCertId],
        digests: [validDigest],
      };
      const expectedData = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: expectedData,
          value: '0x0',
        } as PreparedTransaction,
      });

      const res = await submitPreparedTransaction({
        intent,
        prepare,
        provider: mockProvider,
        signer: mockSigner,
        getSnapshot: () => snapshot,
      });

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: contractAddress,
        from: userAddress,
        chainId: targetChainId,
        data: expectedData,
        value: 0n,
      });
      expect(res).toBeDefined();
    });

    it('validates and submits a batch issuance transaction', async () => {
      const intent: CertificateIntent = {
        kind: 'batch',
        ids: [validCertId, validCertId2],
        digests: [validDigest, validDigest2],
      };
      const expectedData = registryInterface.encodeFunctionData('issueBatch', [
        [validCertId, validCertId2],
        [validDigest, validDigest2],
      ]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: expectedData,
          value: '0x0',
        } as PreparedTransaction,
      });

      const res = await submitPreparedTransaction({
        intent,
        prepare,
        provider: mockProvider,
        signer: mockSigner,
        getSnapshot: () => snapshot,
      });

      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: contractAddress,
        from: userAddress,
        chainId: targetChainId,
        data: expectedData,
        value: 0n,
      });
      expect(res).toBeDefined();
    });

    it('validates and submits a revocation transaction', async () => {
      const intent: CertificateIntent = {
        kind: 'revoke',
        ids: [validCertId],
      };
      const expectedData = registryInterface.encodeFunctionData('revokeCertificate', [validCertId]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: expectedData,
          value: '0x0',
        } as PreparedTransaction,
      });

      const res = await submitPreparedTransaction({
        intent,
        prepare,
        provider: mockProvider,
        signer: mockSigner,
        getSnapshot: () => snapshot,
      });

      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: contractAddress,
        from: userAddress,
        chainId: targetChainId,
        data: expectedData,
        value: 0n,
      });
      expect(res).toBeDefined();
    });
  });

  describe('submitPreparedTransaction - security rejections (never reach sendTransaction)', () => {
    it('rejects transaction if destination does not match configured contract', async () => {
      const attackerContract = '0x9999999999999999999999999999999999999999';
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: attackerContract,
          from: userAddress,
          chainId: targetChainId,
          data,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if prepared chain ID does not match configured chain ID', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: 1, // mainnet instead of local
          data,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if active RPC chain ID does not match configured chain ID', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      mockProvider.send = vi.fn().mockImplementation((method: string) => {
        if (method === 'eth_accounts') return Promise.resolve([userAddress]);
        if (method === 'eth_chainId') return Promise.resolve('0x1'); // Mainnet!
        return Promise.resolve(null);
      });

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('The active wallet account or chain does not match this transaction.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if prepared sender does not match connected account', async () => {
      const otherAccount = '0x2222222222222222222222222222222222222222';
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: otherAccount,
          chainId: targetChainId,
          data,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if active RPC account does not match connected account', async () => {
      const otherAccount = '0x2222222222222222222222222222222222222222';
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      mockProvider.send = vi.fn().mockImplementation((method: string) => {
        if (method === 'eth_accounts') return Promise.resolve([otherAccount]);
        if (method === 'eth_chainId') return Promise.resolve('0x7a69');
        return Promise.resolve(null);
      });

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('The active wallet account or chain does not match this transaction.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if prepared operation does not match intended operation', async () => {
      // User requested issue, but prepared transaction has revoke function data
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const revokeData = registryInterface.encodeFunctionData('revokeCertificate', [validCertId]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: revokeData,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if certificate ID in calldata is substituted', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const tamperedId = '0x' + '99'.repeat(32);
      const tamperedData = registryInterface.encodeFunctionData('issueCertificate', [tamperedId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: tamperedData,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if SHA-256 digest in calldata is substituted', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const tamperedDigest = '0x' + '88'.repeat(32);
      const tamperedData = registryInterface.encodeFunctionData('issueCertificate', [validCertId, tamperedDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data: tamperedData,
          value: '0x0',
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if value is non-zero (attempting ETH transfer)', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockResolvedValue({
        transaction: {
          to: contractAddress,
          from: userAddress,
          chainId: targetChainId,
          data,
          value: '0x1', // 1 wei
        },
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Prepared transaction does not match the reviewed certificate operation.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects transaction if wallet account switches during preparation', async () => {
      const intent: CertificateIntent = { kind: 'issue', ids: [validCertId], digests: [validDigest] };
      const data = registryInterface.encodeFunctionData('issueCertificate', [validCertId, validDigest]);

      const prepare = vi.fn().mockImplementation(async () => {
        // User switched accounts in MetaMask while prepare request was pending!
        snapshot.address = '0x2222222222222222222222222222222222222222';
        snapshot.revision = 2;
        return {
          transaction: {
            to: contractAddress,
            from: userAddress,
            chainId: targetChainId,
            data,
            value: '0x0',
          },
        };
      });

      await expect(
        submitPreparedTransaction({
          intent,
          prepare,
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Wallet account or network changed. Review the operation again.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects invalid non-bytes32 certificate IDs before preparation', async () => {
      const invalidIntent: CertificateIntent = {
        kind: 'issue',
        ids: ['0xinvalid'],
        digests: [validDigest],
      };

      await expect(
        submitPreparedTransaction({
          intent: invalidIntent,
          prepare: vi.fn(),
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Invalid certificate identifier or SHA-256 digest.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects zero bytes32 certificate ID before preparation', async () => {
      const zeroIntent: CertificateIntent = {
        kind: 'issue',
        ids: [ZeroHash],
        digests: [validDigest],
      };

      await expect(
        submitPreparedTransaction({
          intent: zeroIntent,
          prepare: vi.fn(),
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Invalid certificate identifier or SHA-256 digest.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects batch with duplicate certificate IDs', async () => {
      const duplicateIntent: CertificateIntent = {
        kind: 'batch',
        ids: [validCertId, validCertId],
        digests: [validDigest, validDigest2],
      };

      await expect(
        submitPreparedTransaction({
          intent: duplicateIntent,
          prepare: vi.fn(),
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Invalid certificate selection.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects batch exceeding 50 certificates', async () => {
      const fiftyOneIds = Array.from({ length: 51 }, (_, i) => '0x' + (i + 1).toString(16).padStart(64, '0'));
      const fiftyOneDigests = Array.from({ length: 51 }, () => validDigest);

      const oversizedIntent: CertificateIntent = {
        kind: 'batch',
        ids: fiftyOneIds,
        digests: fiftyOneDigests,
      };

      await expect(
        submitPreparedTransaction({
          intent: oversizedIntent,
          prepare: vi.fn(),
          provider: mockProvider,
          signer: mockSigner,
          getSnapshot: () => snapshot,
        })
      ).rejects.toThrow('Invalid certificate selection.');

      expect(mockSigner.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
