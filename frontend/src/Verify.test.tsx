import '@testing-library/jest-dom/vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Verify from './pages/Verify';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from './services/api';

vi.mock('./services/api', () => ({
  api: {
    certificates: {
      verify: vi.fn(),
      verifyPdf: vi.fn(),
    }
  }
}));

describe('Verify Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders verify form', () => {
    render(<Verify />);
    expect(screen.getByText('Verify a Certificate')).toBeInTheDocument();
    expect(screen.getByLabelText(/Certificate ID/)).toBeInTheDocument();
  });

  it('button is disabled when submitting without ID', async () => {
    render(<Verify />);
    const button = screen.getByText('Verify Certificate');
    expect(button).toBeDisabled();
  });

  it('calls verify API when valid ID is submitted', async () => {
    (api.certificates.verify as any).mockResolvedValue({ 
      status: 'VALID', 
      record: { issuer: '0x123', documentHash: '0xabc', issuedBlock: 10 }, 
      confirmations: 5 
    });
    
    render(<Verify />);
    
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0x123456789' } });
    
    fireEvent.click(screen.getByText('Verify Certificate'));
    
    await waitFor(() => {
      expect(api.certificates.verify).toHaveBeenCalledWith('0x123456789');
    });
    
    expect(await screen.findByText('Certificate Record Found')).toBeInTheDocument();
  });

  it('renders tampered/modified status banner when document does not match', async () => {
    (api.certificates.verify as any).mockResolvedValue({ 
      status: 'MODIFIED', 
      record: { issuer: '0x123', documentHash: '0xabc' }, 
      confirmations: 12 
    });

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0x999' } });
    fireEvent.click(screen.getByText('Verify Certificate'));

    expect(await screen.findByText('Tampered Document')).toBeInTheDocument();
  });

  it('renders revoked status banner when certificate is revoked', async () => {
    (api.certificates.verify as any).mockResolvedValue({ 
      status: 'REVOKED', 
      record: { issuer: '0x123', documentHash: '0xabc' }, 
      confirmations: 8 
    });

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xrevoked' } });
    fireEvent.click(screen.getByText('Verify Certificate'));

    expect(await screen.findByText('Revoked Certificate')).toBeInTheDocument();
  });

  it('renders pending confirmation status when confirmations are below threshold', async () => {
    (api.certificates.verify as any).mockResolvedValue({ 
      status: 'UNAVAILABLE',
      reason: 'CONFIRMATION_PENDING',
      record: { issuer: '0x123', documentHash: '0xabc' }, 
      confirmations: 0 
    });

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xpending' } });
    fireEvent.click(screen.getByText('Verify Certificate'));

    const pendingElements = await screen.findAllByText('Pending Confirmation');
    expect(pendingElements.length).toBeGreaterThan(0);
  });

  it('renders registry unavailable status when node is unreachable', async () => {
    (api.certificates.verify as any).mockResolvedValue({ 
      status: 'UNAVAILABLE',
      reason: 'RPC_UNAVAILABLE'
    });

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xunavailable' } });
    fireEvent.click(screen.getByText('Verify Certificate'));

    expect(await screen.findByText('Registry Unavailable')).toBeInTheDocument();
  });

  it('presents API network errors as error alert and never claims certificate is invalid', async () => {
    (api.certificates.verify as any).mockRejectedValue(new Error('Connection to registry node timed out'));

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xnetworkerror' } });
    fireEvent.click(screen.getByText('Verify Certificate'));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/Verification Error/);
    expect(errorAlert).toHaveTextContent(/Connection to registry node timed out/);
    expect(screen.queryByText('Tampered Document')).not.toBeInTheDocument();
    expect(screen.queryByText('Revoked Certificate')).not.toBeInTheDocument();
  });

  it('verifies PDF upload when file is attached and calls verifyPdf', async () => {
    (api.certificates.verifyPdf as any).mockResolvedValue({ 
      status: 'VALID',
      documentMatch: true, 
      record: { issuer: '0x123', documentHash: '0xabcdef' }, 
      confirmations: 10 
    });

    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0x123456789' } });

    const file = new File(['%PDF-1.4 mock content %%EOF'], 'test-cert.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText('test-cert.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Verify Certificate'));

    await waitFor(() => {
      expect(api.certificates.verifyPdf).toHaveBeenCalledWith('0x123456789', file);
    });

    expect(await screen.findByText('Authentic Certificate')).toBeInTheDocument();
  });

  it('rejects files larger than 10 MiB with validation error', async () => {
    render(<Verify />);
    // Create an oversized mock file
    const oversizedFile = new File(['dummy'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversizedFile, 'size', { value: 11 * 1024 * 1024 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(await screen.findByText(/File exceeds 10 MiB limit/)).toBeInTheDocument();
  });

  it('clears A’s result when the ID is edited to B', async () => {
    vi.mocked(api.certificates.verify).mockResolvedValue({ certificateId: '0xaaa', status: 'VALID', documentMatch: null, record: { issuer: 'issuer-A', issuedBlock: 10 } });
    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xaaa' } });
    fireEvent.click(screen.getByText('Verify Certificate'));
    await screen.findByText('Certificate Record Found');
    expect(screen.getByText('0xaaa')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '0xbbb' } });
    expect(screen.queryByText('Certificate Record Found')).not.toBeInTheDocument();
    expect(screen.queryByText('issuer-A')).not.toBeInTheDocument();
    expect(screen.queryByText('0xbbb')).not.toBeInTheDocument();
  });

  it('discards a late response for A after editing and verifying B', async () => {
    let resolveA!: (value: unknown) => void;
    vi.mocked(api.certificates.verify).mockReturnValueOnce(new Promise(resolve => { resolveA = resolve; }));
    render(<Verify />);
    const input = screen.getByLabelText(/Certificate ID/);
    fireEvent.change(input, { target: { value: '0xaaa' } });
    fireEvent.click(screen.getByText('Verify Certificate'));
    fireEvent.change(input, { target: { value: '0xbbb' } });
    vi.mocked(api.certificates.verify).mockResolvedValueOnce({ certificateId: '0xbbb', status: 'UNKNOWN' });
    fireEvent.click(screen.getByText('Verify Certificate'));
    await screen.findByText('Certificate Not Found');
    await act(async () => { resolveA({ certificateId: '0xaaa', status: 'VALID', record: { issuer: 'issuer-A' } }); });
    expect(screen.getByText('Certificate Not Found')).toBeInTheDocument();
    expect(screen.queryByText('issuer-A')).not.toBeInTheDocument();
  });

  it('does not claim an ID-only PDF match or finality', async () => {
    vi.mocked(api.certificates.verify).mockResolvedValue({ certificateId: '0xaaa', mode: 'id', documentMatch: null, status: 'VALID', record: { issuer: 'issuer', issuedBlock: 10 }, confirmations: 1 });
    render(<Verify />);
    fireEvent.change(screen.getByLabelText(/Certificate ID/), { target: { value: '0xaaa' } });
    fireEvent.click(screen.getByText('Verify Certificate'));
    await screen.findByText('Certificate Record Found');
    expect(screen.getByText(/This ID lookup does not establish that a PDF matches/)).toBeInTheDocument();
    expect(screen.queryByText('Authentic Certificate')).not.toBeInTheDocument();
    expect(screen.queryByText('Finalized')).not.toBeInTheDocument();
    expect(screen.getByText('Observed confirmations')).toBeInTheDocument();
  });

  it('rejects a response belonging to another certificate', async () => {
    vi.mocked(api.certificates.verify).mockResolvedValue({ certificateId: '0xbbb', status: 'VALID' });
    render(<Verify />);
    fireEvent.change(screen.getByLabelText(/Certificate ID/), { target: { value: '0xaaa' } });
    fireEvent.click(screen.getByText('Verify Certificate'));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the submitted certificate ID');
    expect(screen.queryByText('Certificate Record Found')).not.toBeInTheDocument();
  });

  it('invalidates a previous result when a different PDF is selected', async () => {
    vi.mocked(api.certificates.verify).mockResolvedValue({ certificateId: '0xaaa', status: 'VALID', documentMatch: null });
    render(<Verify />);
    fireEvent.change(screen.getByLabelText(/Certificate ID/), { target: { value: '0xaaa' } });
    fireEvent.click(screen.getByText('Verify Certificate'));
    await screen.findByText('Certificate Record Found');
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['%PDF-1.4\n%%EOF'], 'different.pdf', { type: 'application/pdf' })] } });
    expect(screen.queryByText('Certificate Record Found')).not.toBeInTheDocument();
  });
});
