export const API_URL = import.meta.env.VITE_API_URL || "/api/v1";

export interface SessionData {
  wallet: string | null;
  expiresAt: string;
  csrfToken: string;
}

export interface PreparedTransaction {
  to: string;
  from: string;
  chainId: number;
  data: string;
  value: string;
}

export interface ReconciliationResult {
  transactionHash: string;
  status: 'PENDING' | 'UNRESOLVED' | 'REVERTED' | 'CONFIRMATION_PENDING' | 'CONFIRMED';
  metadataStatus: 'NOT_UPDATED' | 'SYNCED' | 'RECONCILIATION_REQUIRED';
  reason?: string;
  retry?: { transactionHash: string };
  blockNumber?: number;
  blockHash?: string;
  confirmations?: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  payload: unknown;
  constructor(status: number, code: string, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

let currentCsrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  currentCsrfToken = token;
}

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  
  if (options.method && options.method !== 'GET') {
    if (currentCsrfToken) {
      headers.set('X-CSRF-Token', currentCsrfToken);
    }
    if (!options.body || !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // If backend returns HTTP 503 for verification query, it still carries authoritative status='UNAVAILABLE'
    if (response.status === 503 && data && data.status === 'UNAVAILABLE') {
      return data as T;
    }
    throw new ApiError(
      response.status, 
      data?.error?.code || data?.code || data?.reason || 'UNKNOWN_ERROR', 
      data?.error?.message || data?.error?.code || data?.reason || 'Request failed',
      data
    );
  }

  return data as T;
}

export const api = {
  auth: {
    getSession: () => fetchApi<SessionData>('/auth/session'),
    challenge: (wallet: string) => fetchApi<{ message: string; expiresAt: string }>('/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ wallet })
    }),
    verify: (message: string, signature: string) => fetchApi<SessionData>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature })
    }),
    logout: () => fetchApi('/auth/session', { method: 'DELETE' })
  },
  certificates: {
    verify: (id: string) => fetchApi<any>(`/certificates/${id}/verification`),
    verifyPdf: (id: string, file: File) => {
      const formData = new FormData();
      formData.append('pdf', file);
      return fetchApi<any>(`/certificates/${id}/verify-pdf`, {
        method: 'POST',
        body: formData,
      });
    },
    revokePrepare: (id: string) => fetchApi<{ status: string; transaction: PreparedTransaction }>(`/certificates/${id}/revocation/prepare`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
    revokeTransaction: (id: string, transactionHash: string) => fetchApi<ReconciliationResult>(`/certificates/${id}/revocation/transaction`, {
      method: 'POST',
      body: JSON.stringify({ transactionHash })
    })
  },
  issuance: {
    uploadDraft: (file: File, certificateId?: string) => {
      const formData = new FormData();
      formData.append('pdf', file);
      if (certificateId) formData.append('certificateId', certificateId);
      return fetchApi<{ draftId: string; certificateId: string; documentHash: string; expiresAt: string }>('/issuance-drafts', {
        method: 'POST',
        body: formData,
      });
    },
    // Owner-scoped on the backend: only the issuer's own unexpired drafts are returned.
    getDraft: (draftId: string) => fetchApi<{ draftId: string; certificateId: string; documentHash: string; expiresAt: string; issued?: boolean }>(`/issuance-drafts/${draftId}`),
    getDrafts: (cursor: number = 0, limit: number = 25) => fetchApi<any>(`/issuer/drafts?cursor=${cursor}&limit=${limit}`),
    prepareIssue: (draftId: string) => fetchApi<{ status: string; transaction: PreparedTransaction }>(`/issuance-drafts/${draftId}/prepare`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
    submitIssueTx: (draftId: string, transactionHash: string) => fetchApi<ReconciliationResult>(`/issuance-drafts/${draftId}/transaction`, {
      method: 'POST',
      body: JSON.stringify({ transactionHash })
    }),
    prepareBatch: (draftIds: string[]) => fetchApi<{ status: string; transaction: PreparedTransaction; maxBatchSize: number }>('/issuance-batches/prepare', {
      method: 'POST',
      body: JSON.stringify({ draftIds })
    }),
    submitBatchTx: (draftIds: string[], transactionHash: string) => fetchApi<ReconciliationResult>('/issuance-batches/transaction', {
      method: 'POST',
      body: JSON.stringify({ draftIds, transactionHash })
    })
  },
  admin: {
    getIssuers: (cursor: number = 0, limit: number = 25) => fetchApi<any>(`/admin/issuers?cursor=${cursor}&limit=${limit}`),
    getProfile: (wallet: string) => fetchApi<any>(`/admin/issuers/${wallet}/profile`),
    updateProfile: (wallet: string, institutionName: string) => fetchApi<any>(`/admin/issuers/${wallet}/profile`, {
      method: 'PUT',
      body: JSON.stringify({ institutionName })
    })
  },
  transactions: {
    get: (hash: string) => fetchApi<any>(`/transactions/${hash}`)
  }
};
