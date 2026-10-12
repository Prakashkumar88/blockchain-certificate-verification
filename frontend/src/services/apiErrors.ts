// The backend checks ISSUER_ROLE live on-chain; explain its 403 instead of showing the bare code.
export const ISSUER_REQUIRED_MESSAGE =
  'The connected wallet does not hold the issuer role on this registry. Switch MetaMask to an authorized issuer account, then sign in again.';

export function isIssuerRequired(err: unknown) {
  return (err as { code?: unknown } | null)?.code === 'ISSUER_REQUIRED';
}

// Prepare simulates the contract call; this revert means the certificate ID is already on-chain.
export const ALREADY_ISSUED_MESSAGE =
  'This certificate is already recorded on the blockchain, so there is nothing left to sign. Verify it on the Verify page, or upload the PDF again to create a new draft.';

export function isAlreadyIssued(err: unknown) {
  const e = err as { code?: unknown; payload?: { error?: { contractError?: unknown } } } | null;
  return e?.code === 'TRANSACTION_WOULD_REVERT' && e?.payload?.error?.contractError === 'CertificateAlreadyExists';
}

export function apiErrorMessage(err: unknown, fallback: string) {
  if (isIssuerRequired(err)) return ISSUER_REQUIRED_MESSAGE;
  if (isAlreadyIssued(err)) return ALREADY_ISSUED_MESSAGE;
  return err instanceof Error && err.message ? err.message : fallback;
}
