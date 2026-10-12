import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { apiErrorMessage, ALREADY_ISSUED_MESSAGE } from '../services/apiErrors';
import { submitPreparedTransaction } from '../services/preparedTransaction';
import { useWallet } from '../contexts/WalletContext';
import { useAuth } from '../contexts/AuthContext';
import { 
  Upload, 
  CheckCircle2, 
  FileText, 
  X, 
  ShieldCheck, 
  ArrowLeft, 
  Copy, 
  Check, 
  AlertCircle,
  Lock,
  ChevronRight
} from 'lucide-react';
import { useCertificateTransaction } from '../hooks/useCertificateTransaction';
import { TransactionProgress } from '../components/TransactionProgress';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/utils';

export default function Issue() {
  const navigate = useNavigate();
  const { signer, provider, getSnapshot, isCorrectNetwork, address } = useWallet();
  const { isAuthenticated } = useAuth();
  
  const [certId, setCertId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [stage, setStep] = useState(1);
  const [draft, setDraft] = useState<any>(null);
  const transaction = useCertificateTransaction();
  const txHash = transaction.hash;
  const step = transaction.confirmed ? 3 : stage;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Resuming an existing draft (`/issue?draft=<id>` from the dashboard) loads it for review only;
  // it never re-uploads or re-hashes the PDF.
  const [searchParams] = useSearchParams();
  const resumeDraftId = searchParams.get('draft');
  const invalidResumeLink = resumeDraftId !== null && !/^0x[0-9a-fA-F]{64}$/.test(resumeDraftId);
  const [resuming, setResuming] = useState(resumeDraftId !== null && !invalidResumeLink);
  const loadedDraftId = useRef<string | null>(null);

  useEffect(() => {
    if (!resumeDraftId || invalidResumeLink || !isAuthenticated || !isCorrectNetwork) return;
    // Marked only once applied: StrictMode (dev) cancels the first run, which must not block the retry.
    if (loadedDraftId.current === resumeDraftId) return;
    let active = true;
    api.issuance.getDraft(resumeDraftId)
      .then((loaded) => {
        if (!active) return;
        if (loaded?.draftId?.toLowerCase() !== resumeDraftId.toLowerCase()) {
          throw new Error('Draft response does not match the selected draft.');
        }
        loadedDraftId.current = resumeDraftId;
        // The backend reports on-chain state; an issued draft has nothing left to sign.
        if (loaded.issued) {
          setError(ALREADY_ISSUED_MESSAGE);
          return;
        }
        setDraft(loaded);
        setStep(2);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as { code?: string })?.code === 'DRAFT_NOT_FOUND'
          ? 'This draft was not found or has expired. Upload the PDF again to create a new draft.'
          : apiErrorMessage(err, 'Failed to load the selected draft.'));
      })
      .finally(() => { if (active) setResuming(false); });
    return () => { active = false; };
  }, [resumeDraftId, invalidResumeLink, isAuthenticated, isCorrectNetwork]);
  const shownError = error ?? (invalidResumeLink ? 'Invalid draft link. Open the draft again from the Issuer Dashboard.' : null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const validateAndSetFile = (selected: File) => {
    if (selected.size > 10 * 1024 * 1024) {
      setError('File must be under 10 MiB');
      return;
    }
    if (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Only authentic PDF documents (.pdf) are supported');
      return;
    }
    setFile(selected);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('PDF file is required');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await api.issuance.uploadDraft(file, certId.trim() || undefined);
      setDraft(res);
      setStep(2);
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to upload document'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleIssue = async () => {
    if (!signer || !provider || !draft) return;
    
    await transaction.run(() => submitPreparedTransaction({
      provider, signer, getSnapshot,
      intent: { kind: 'issue', ids: [draft.certificateId], digests: [draft.documentHash] },
      prepare: () => api.issuance.prepareIssue(draft.draftId).catch((err) => {
        throw new Error(apiErrorMessage(err, 'Failed to prepare the transaction.'));
      }),
    }), (hash) => api.issuance.submitIssueTx(draft.draftId, hash));
  };

  if (!isAuthenticated || !isCorrectNetwork) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <Card className="p-8">
          <ShieldCheck className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-900">Issuer Authorization Required</h2>
          <p className="mt-2 text-sm text-slate-500">
            Please connect your wallet and ensure you are on the target registry network before issuing certificates.
          </p>
          <div className="mt-6">
            <Button onClick={() => navigate('/dashboard')} variant="outline" size="sm">
              Return to Dashboard
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const steps = [
    { number: 1, name: 'Prepare & Hash' },
    { number: 2, name: 'Review & Sign' },
    { number: 3, name: 'Confirmed' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      {/* Top Breadcrumb & Heading */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Dashboard</span>
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Issue Certificate
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          Upload a PDF credential and anchor its cryptographic SHA-256 digest onto the blockchain.
        </p>
      </div>

      <TransactionProgress transaction={transaction} />

      {/* Stepper Progress Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        {steps.map((s, idx) => (
          <div key={s.number} className="flex items-center gap-2">
            <div
              className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold",
                step === s.number
                  ? "bg-teal-600 text-white"
                  : step > s.number
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-400"
              )}
            >
              {step > s.number ? <Check className="h-3.5 w-3.5" /> : s.number}
            </div>
            <span
              className={cn(
                "text-xs font-medium hidden sm:inline",
                step === s.number ? "text-slate-900 font-semibold" : "text-slate-400"
              )}
            >
              {s.name}
            </span>
            {idx < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 text-slate-300 ml-2 hidden sm:inline" />
            )}
          </div>
        ))}
      </div>

      {/* Error Alert */}
      {shownError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 flex items-start gap-3 text-rose-800">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">Error: </span>
            {shownError}
          </div>
        </div>
      )}

      {/* Card Content based on Step */}
      <Card className="shadow-xs">
        {step === 1 && resuming && (
          <div className="p-6 sm:p-8 text-sm text-slate-500" role="status">Loading saved draft…</div>
        )}

        {/* Step 1: Upload & Prepare */}
        {step === 1 && !resuming && (
          <form onSubmit={handleUpload}>
            <div className="p-6 sm:p-8 space-y-6">
              <div>
                <label htmlFor="issue-certId" className="block text-sm font-semibold text-slate-800">
                  Certificate Identifier <span className="text-xs font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  id="issue-certId"
                  type="text"
                  value={certId}
                  onChange={(e) => setCertId(e.target.value)}
                  placeholder="Auto-generated if left blank"
                  className="mt-1 block w-full px-3.5 py-2.5 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Custom ID or alphanumeric registration number. A unique hash is generated if omitted.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Certificate Document (PDF) <span className="text-rose-500">*</span>
                </label>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !file && fileInputRef.current?.click()}
                  className={cn(
                    "mt-2 relative border-2 border-dashed rounded-xl p-6 transition-all text-center cursor-pointer",
                    isDragging
                      ? "border-teal-500 bg-teal-50/50"
                      : file
                      ? "border-slate-200 bg-slate-50/60 cursor-default"
                      : "border-slate-300 hover:border-slate-400 bg-slate-50/40"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="sr-only"
                    onChange={handleFileChange}
                  />

                  {!file ? (
                    <div className="space-y-2">
                      <div className="mx-auto h-11 w-11 rounded-full bg-white shadow-2xs border border-slate-200 flex items-center justify-center text-slate-500">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div className="text-sm text-slate-600">
                        <span className="font-semibold text-teal-600 hover:text-teal-700">Click to upload</span> or drag and drop
                      </div>
                      <p className="text-xs text-slate-400">Authentic PDF file up to 10 MiB</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center gap-3 overflow-hidden text-left">
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center border border-teal-100">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                          <p className="text-xs text-slate-400 font-mono">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading || !file}
                isLoading={isLoading}
                loadingText="Hashing and Preparing Draft..."
                size="lg"
                variant="primary"
                className="w-full font-semibold"
              >
                Upload & Prepare Draft
              </Button>
            </div>
          </form>
        )}

        {/* Step 2: Review & Sign On-Chain */}
        {step === 2 && draft && (
          <div className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <ShieldCheck className="h-5 w-5 text-teal-600" />
              <h3 className="text-base font-semibold text-slate-900">Review Cryptographic Parameters</h3>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3 font-mono text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5 font-sans font-medium text-[11px] uppercase tracking-wider">
                  Assigned Certificate ID
                </span>
                <span className="text-slate-900 font-semibold break-all">{draft.certificateId}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60">
                <span className="text-slate-400 block mb-0.5 font-sans font-medium text-[11px] uppercase tracking-wider">
                  Computed SHA-256 Hash
                </span>
                <span className="text-slate-900 break-all">{draft.documentHash}</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between font-sans">
                <span className="text-slate-500 text-xs">Signing Wallet</span>
                <span className="text-slate-900 font-mono text-xs">{address}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200/80 text-teal-900 text-xs flex items-start gap-2.5">
              <Lock className="h-4 w-4 text-teal-600 shrink-0 mt-0.5" />
              <span>
                Non-custodial signing: Clicking below will prompt your Web3 wallet (MetaMask) to approve the on-chain issuance transaction with your private key.
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setStep(1)}
                disabled={isLoading || transaction.busy || !!txHash}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleIssue}
                disabled={isLoading || transaction.busy || !!txHash}
                isLoading={transaction.busy}
                loadingText={transaction.phase === 'signature' ? 'Awaiting Wallet Signature...' : 'Checking Transaction...'}
                size="md"
                variant="primary"
                className="flex-1 font-semibold"
              >
                Sign & Anchor to Blockchain
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmed Receipt */}
        {step === 3 && (
          <div className="p-6 sm:p-10 text-center space-y-6">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Certificate Successfully Anchored
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                The issuance transaction was signed and broadcasted to the blockchain registry.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left space-y-3 text-xs">
              <div>
                <span className="text-slate-400 font-medium uppercase tracking-wider text-[11px] block">
                  Certificate ID
                </span>
                <div className="flex items-center justify-between font-mono text-slate-900 font-semibold mt-0.5">
                  <span className="break-all">{draft?.certificateId}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(draft?.certificateId, 'cert')}
                    className="p-1 rounded text-slate-400 hover:text-slate-600"
                    title="Copy Certificate ID"
                  >
                    {copied === 'cert' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/60">
                <span className="text-slate-400 font-medium uppercase tracking-wider text-[11px] block">
                  Transaction Hash
                </span>
                <div className="flex items-center justify-between font-mono text-teal-700 mt-0.5">
                  <span className="break-all">{txHash}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(txHash || '', 'tx')}
                    className="p-1 rounded text-slate-400 hover:text-slate-600"
                    title="Copy Transaction Hash"
                  >
                    {copied === 'tx' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/')}
              >
                Verify on Public Portal
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => navigate('/dashboard')}
              >
                Return to Dashboard
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
