import type { useCertificateTransaction } from '../hooks/useCertificateTransaction';
import { Button } from './ui/Button';

export function TransactionProgress({ transaction }: { transaction: ReturnType<typeof useCertificateTransaction> }) {
  if (transaction.phase === 'idle' || transaction.confirmed) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm" aria-live="polite">
      <p role={transaction.phase === 'failed' ? 'alert' : 'status'}>
        {transaction.message || (transaction.phase === 'signature'
          ? 'Awaiting wallet signature.'
          : transaction.phase === 'receipt'
            ? 'Transaction submitted. Waiting for receipt confirmation.'
            : 'Checking receipt and reconciling with the registry.')}
      </p>
      {transaction.hash && <>
        <p className="break-all font-mono text-xs">Transaction hash: {transaction.hash}</p>
        <p>The transaction may already exist on-chain. Do not submit it again. This check reuses the existing transaction hash.</p>
        <Button type="button" variant="outline" size="sm" disabled={transaction.busy} onClick={transaction.retry}>
          Check transaction status
        </Button>
      </>}
    </div>
  );
}
