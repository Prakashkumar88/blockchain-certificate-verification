import { useRef, useState } from 'react';
import type { TransactionResponse } from 'ethers';
import type { ReconciliationResult } from '../services/api';

type Phase = 'idle' | 'signature' | 'receipt' | 'reconciling' | 'pending' | 'failed' | 'confirmed';
type Reconcile = (hash: string) => Promise<ReconciliationResult>;

// Retain the original intent and hash: recovery must never send another transaction.
export function useCertificateTransaction() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const submitted = useRef<{ hash: string; reconcile: Reconcile } | null>(null);

  function applyResult(result: ReconciliationResult, expectedHash: string) {
    if (!result || result.transactionHash?.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error('Invalid reconciliation response. Confirmation has not been established.');
    }
    if (result.status === 'REVERTED') {
      setPhase('failed');
      setMessage('Transaction reverted on-chain. The requested operation did not succeed.');
    } else if (result.status === 'CONFIRMED' && result.metadataStatus === 'SYNCED') {
      // The backend checks the successful canonical receipt, expected intent, events and state.
      setPhase('confirmed');
      setMessage(null);
    } else {
      setPhase('pending');
      setMessage(result.status === 'CONFIRMED'
        ? 'Confirmed on-chain, but metadata reconciliation is incomplete. Check the existing transaction again.'
        : `Confirmation is not established (${result.status || 'UNRESOLVED'}). Check the existing transaction again.`);
    }
  }

  function handleError(error: unknown) {
    // API errors retain the backend's receipt/reconciliation evidence (including HTTP 409/503).
    const payload = error && typeof error === 'object' && 'payload' in error ? error.payload : null;
    if (submitted.current && payload && typeof payload === 'object' && 'status' in payload) {
      try {
        applyResult(payload as ReconciliationResult, submitted.current.hash);
        return;
      } catch { /* Keep the original error visible if the payload is not usable. */ }
    }
    setPhase('failed');
    setMessage(error instanceof Error ? error.message : 'Transaction confirmation could not be established.');
  }

  async function run(send: () => Promise<TransactionResponse>, reconcile: Reconcile) {
    if (lock.current || submitted.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setPhase('signature');
    try {
      const tx = await send();
      submitted.current = { hash: tx.hash, reconcile };
      setHash(tx.hash);
      setPhase('receipt');
      const receipt = await tx.wait(1);
      if (receipt?.status === 0) throw new Error('Transaction reverted on-chain. The requested operation did not succeed.');
      if (receipt?.status !== 1) throw new Error('Receipt confirmation is unavailable. Check the existing transaction.');
      setPhase('reconciling');
      applyResult(await reconcile(tx.hash), tx.hash);
    } catch (error) {
      handleError(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function retry() {
    const previous = submitted.current;
    if (!previous || lock.current || phase === 'confirmed') return;
    lock.current = true;
    setBusy(true);
    setPhase('reconciling');
    setMessage(null);
    try {
      // This endpoint independently verifies the receipt even if the wallet's wait() failed.
      applyResult(await previous.reconcile(previous.hash), previous.hash);
    } catch (error) {
      handleError(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function clearCompleted() {
    if (lock.current || phase !== 'confirmed') return;
    submitted.current = null;
    setHash(null);
    setMessage(null);
    setPhase('idle');
  }

  return { phase, hash, message, busy, confirmed: phase === 'confirmed', run, retry, clearCompleted };
}
