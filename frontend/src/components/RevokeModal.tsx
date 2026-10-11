import { useState } from 'react';
import { api } from '../services/api';
import { submitPreparedTransaction } from '../services/preparedTransaction';
import { useWallet } from '../contexts/WalletContext';
import { 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  Copy, 
  Check, 
  ShieldAlert
} from 'lucide-react';
import { useCertificateTransaction } from '../hooks/useCertificateTransaction';
import { TransactionProgress } from './TransactionProgress';
import { Button } from './ui/Button';

interface RevokeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCertId?: string;
}

export function RevokeModal({ isOpen, onClose, initialCertId = '' }: RevokeModalProps) {
  const { signer, provider, getSnapshot, isCorrectNetwork } = useWallet();
  const [certId, setCertId] = useState(initialCertId);
  const [confirmedIrreversible, setConfirmedIrreversible] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const transaction = useCertificateTransaction();
  const txHash = transaction.hash;
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = certId.trim();
    if (!targetId) {
      setError('Certificate ID is required.');
      return;
    }
    if (!confirmedIrreversible) {
      setError('You must explicitly confirm acknowledgement of irreversible revocation.');
      return;
    }
    if (!signer || !provider || !isCorrectNetwork) {
      setError('Wallet must be connected on the correct network to revoke.');
      return;
    }

    setError(null);
    await transaction.run(() => submitPreparedTransaction({
      provider, signer, getSnapshot,
      intent: { kind: 'revoke', ids: [targetId] },
      prepare: () => api.certificates.revokePrepare(targetId),
    }), (hash) => api.certificates.revokeTransaction(targetId, hash));
  };

  const handleClose = () => {
    setError(null);
    // Closing a pending modal must preserve its hash and recovery action.
    if (transaction.confirmed) transaction.clearCompleted();
    if (!txHash || transaction.confirmed) setConfirmedIrreversible(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-rose-700">
            <ShieldAlert className="h-5 w-5" />
            <h3 className="text-base font-bold text-slate-900">Revoke Certificate Record</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5">
          <TransactionProgress transaction={transaction} />
          {!transaction.confirmed ? (
            <form onSubmit={handleRevoke} className="space-y-5">
              {/* Irreversible Notice Banner */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900 space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>Irreversible Cryptographic Revocation</span>
                </div>
                <p className="leading-relaxed text-rose-700">
                  Warning: Revoking a certificate is permanently anchored onto the blockchain smart contract registry. 
                  Once confirmed, this certificate will indefinitely report as <strong className="text-rose-900">REVOKED</strong> on public verification audits. This action <span className="underline font-semibold">cannot</span> be undone or restored by any entity.
                </p>
              </div>

              {/* Certificate ID Input */}
              <div className="space-y-1">
                <label htmlFor="revoke-certId" className="block text-xs font-semibold text-slate-700">
                  Certificate ID to Revoke <span className="text-rose-500">*</span>
                </label>
                <input
                  id="revoke-certId"
                  type="text"
                  value={certId}
                  disabled={transaction.busy || !!txHash}
                  onChange={(e) => setCertId(e.target.value)}
                  placeholder="0x... (32-byte hexadecimal ID)"
                  className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>

              {/* Acknowledgement Checkbox */}
              <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmedIrreversible}
                  disabled={transaction.busy || !!txHash}
                  onChange={(e) => setConfirmedIrreversible(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                />
                <span>
                  I understand that this action is permanent, irrevocable, and will be publicly recorded on the blockchain registry.
                </span>
              </label>

              {/* Error Message */}
              {error && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={transaction.busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  disabled={transaction.busy || !!txHash || !certId.trim() || !confirmedIrreversible}
                  isLoading={transaction.busy}
                  loadingText={transaction.phase === 'signature' ? 'Awaiting Wallet Signature...' : 'Checking Transaction...'}
                >
                  Confirm & Permanently Revoke
                </Button>
              </div>
            </form>
          ) : (
            /* Success Receipt */
            <div className="text-center py-4 space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-slate-900">Revocation Successfully Confirmed</h4>
                <p className="text-xs text-slate-500">
                  The revocation transaction has been verified on the blockchain registry.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left space-y-1 text-xs">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">Transaction Hash</span>
                <div className="flex items-center justify-between font-mono text-teal-700">
                  <span className="truncate">{txHash}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(txHash || '')}
                    className="p-1 rounded text-slate-400 hover:text-slate-600 shrink-0 ml-2"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <Button type="button" variant="primary" size="sm" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
