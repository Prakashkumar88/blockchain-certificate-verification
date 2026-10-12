import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { apiErrorMessage } from '../services/apiErrors';
import { submitPreparedTransaction } from '../services/preparedTransaction';
import { useWallet } from '../contexts/WalletContext';
import { useAuth } from '../contexts/AuthContext';
import { 
  Layers, 
  CheckCircle2, 
  ArrowLeft, 
  Check, 
  Copy, 
  AlertCircle,
  FileText,
  FilePlus,
  ShieldCheck,
  CheckSquare,
  Square
} from 'lucide-react';
import { useCertificateTransaction } from '../hooks/useCertificateTransaction';
import { TransactionProgress } from '../components/TransactionProgress';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';

export default function BatchIssue() {
  const navigate = useNavigate();
  const { signer, provider, getSnapshot, isCorrectNetwork } = useWallet();
  const { isAuthenticated } = useAuth();
  
  const [drafts, setDrafts] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  

  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const transaction = useCertificateTransaction();
  const txHash = transaction.hash;
  const step = transaction.confirmed ? 2 : 1;
  const [copied, setCopied] = useState<string | null>(null);

  const loadDrafts = async () => {
    try {
      setLoadingDrafts(true);
      const res = await api.issuance.getDrafts();
      // Already-issued drafts would only revert on-chain, so they are not selectable.
      setDrafts((res.drafts || []).filter((d: { issued?: boolean }) => !d.issued));
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load drafts from server'));
    } finally {
      setLoadingDrafts(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadDrafts();
    }
  }, [isAuthenticated]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleSelect = (id: string) => {
    if (transaction.busy || txHash) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= 50) {
        setError('Maximum batch size is 50 certificates');
        return;
      }
      next.add(id);
      setError(null);
    }
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (transaction.busy || txHash) return;
    if (selectedIds.size === drafts.length) {
      setSelectedIds(new Set());
    } else {
      const all = new Set(drafts.slice(0, 50).map(d => d.draftId));
      setSelectedIds(all);
    }
  };

  const handleBatchIssue = async () => {
    if (!signer || !provider || selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    const selected = ids.map(id => drafts.find(draft => draft.draftId === id)).filter((d): d is typeof drafts[number] => !!d);
    if (selected.length !== ids.length) return;

    await transaction.run(() => submitPreparedTransaction({
      provider, signer, getSnapshot,
      intent: { kind: 'batch', ids: selected.map(draft => draft.certificateId), digests: selected.map(draft => draft.documentHash) },
      prepare: () => api.issuance.prepareBatch(ids),
    }), (hash) => api.issuance.submitBatchTx(ids, hash));
  };

  if (!isAuthenticated || !isCorrectNetwork) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <Card className="p-8">
          <ShieldCheck className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-900">Issuer Authorization Required</h2>
          <p className="mt-2 text-sm text-slate-500">
            Please sign in with your authorized wallet to issue certificate batches.
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

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Dashboard</span>
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Batch Issue Certificates
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Anchor up to 50 prepared certificate drafts in a single cryptographic transaction.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-teal-50 text-teal-700 border border-teal-200">
              High Gas Efficiency
            </span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 flex items-start gap-3 text-rose-800">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">Batch Error: </span>
            {error}
          </div>
        </div>
      )}

      <TransactionProgress transaction={transaction} />

      {/* Step 1: Draft Selection Table */}
      {step === 1 && (
        <Card className="shadow-xs overflow-hidden">
          {/* Table Toolbar */}
          <div className="p-4 sm:px-6 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={transaction.busy || !!txHash || drafts.length === 0}
                className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
              >
                {drafts.length > 0 && selectedIds.size === drafts.length ? (
                  <CheckSquare className="h-4 w-4 text-teal-600" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400" />
                )}
                <span>Select All ({drafts.length})</span>
              </button>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500">
                Selected: <span className="font-semibold text-teal-700">{selectedIds.size}</span> / 50 max
              </span>
            </div>

            <Button
              type="button"
              onClick={handleBatchIssue}
              disabled={transaction.busy || !!txHash || selectedIds.size === 0}
              isLoading={transaction.busy}
              loadingText={transaction.phase === 'signature' ? 'Awaiting Wallet Signature...' : 'Checking Transaction...'}
              size="sm"
              variant="primary"
              leftIcon={<Layers className="h-4 w-4" />}
            >
              Sign & Anchor Batch ({selectedIds.size})
            </Button>
          </div>

          {/* Table List */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 sm:px-6 w-12">Select</th>
                  <th className="py-3 px-4 sm:px-6">Certificate ID</th>
                  <th className="py-3 px-4 sm:px-6">Document Hash (SHA-256)</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingDrafts ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-4" /></td>
                      <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-32" /></td>
                      <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-48" /></td>
                      <td className="py-4 px-4 sm:px-6 text-right"><Skeleton className="h-5 w-16 ml-auto" /></td>
                    </tr>
                  ))
                ) : drafts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 px-4 text-center">
                      <div className="max-w-sm mx-auto space-y-3">
                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                          <FileText className="h-5 w-5" />
                        </div>
                        <h4 className="text-sm font-semibold text-slate-800">No active drafts found</h4>
                        <p className="text-xs text-slate-500">
                          Upload single certificate documents first to create drafts eligible for batch processing.
                        </p>
                        <div className="pt-2">
                          <Link to="/issue">
                            <Button size="sm" variant="primary" leftIcon={<FilePlus className="h-3.5 w-3.5" />}>
                              Create a Draft
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  drafts.map((draft) => {
                    const isSelected = selectedIds.has(draft.draftId);
                    return (
                      <tr 
                        key={draft.draftId}
                        onClick={() => toggleSelect(draft.draftId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-teal-50/40 hover:bg-teal-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3.5 px-4 sm:px-6" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={transaction.busy || !!txHash}
                            onChange={() => toggleSelect(draft.draftId)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3.5 px-4 sm:px-6 font-semibold font-mono text-slate-900">
                          {draft.certificateId}
                        </td>
                        <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-500 truncate max-w-xs">
                          {draft.documentHash}
                        </td>
                        <td className="py-3.5 px-4 sm:px-6 text-right">
                          <Badge status="info" size="sm">
                            Ready
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Step 2: Confirmed Receipt */}
      {step === 2 && (
        <Card className="p-8 sm:p-12 text-center space-y-6 shadow-xs">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Batch Issuance Confirmed
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Successfully registered <span className="font-semibold text-slate-800">{selectedIds.size}</span> certificates onto the blockchain registry.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 max-w-lg mx-auto text-left space-y-2 text-xs">
            <span className="text-slate-400 font-medium uppercase tracking-wider text-[11px] block">
              Batch Transaction Hash
            </span>
            <div className="flex items-center justify-between font-mono text-teal-700">
              <span className="break-all">{txHash}</span>
              <button
                type="button"
                onClick={() => handleCopy(txHash || '', 'tx')}
                className="p-1 rounded text-slate-400 hover:text-slate-600 shrink-0 ml-2"
                title="Copy Transaction Hash"
              >
                {copied === 'tx' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/dashboard')}
            >
              Return to Dashboard
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
