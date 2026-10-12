import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { apiErrorMessage, isIssuerRequired } from '../services/apiErrors';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext';
import { 
  FilePlus, 
  Layers, 
  ShieldCheck, 
  RefreshCw, 
  Search, 
  Copy, 
  Check, 
  FileText, 
  ArrowRight,
  Wallet,
  AlertCircle,
  FileCheck2,
  ShieldAlert
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { RevokeModal } from '../components/RevokeModal';

export default function Dashboard() {
  const { isAuthenticated, login, isLoading: authLoading } = useAuth();
  const { address, connect, isCorrectNetwork } = useWallet();
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  // Derived only from the backend's issuer-only endpoint, which checks ISSUER_ROLE on-chain.
  const [issuerRole, setIssuerRole] = useState<'checking' | 'verified' | 'missing' | 'unknown'>('checking');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setIssuerRole('checking');
      const draftsData = await api.issuance.getDrafts();
      setDrafts(draftsData.drafts || []);
      setIssuerRole('verified');
    } catch (err: any) {
      setIssuerRole(isIssuerRequired(err) ? 'missing' : 'unknown');
      setError(apiErrorMessage(err, 'Failed to retrieve drafts from server.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredDrafts = drafts.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.certificateId?.toLowerCase().includes(q) ||
      d.documentHash?.toLowerCase().includes(q) ||
      d.draftId?.toLowerCase().includes(q)
    );
  });

  // Unauthenticated State
  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6">
        <Card className="text-center p-8 sm:p-12 shadow-sm">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-slate-900 flex items-center justify-center text-teal-400 mb-5 shadow-xs">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Authorized Issuer Portal
          </h2>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Connect an authorized institutional wallet and sign in via Sign-In with Ethereum (SIWE) to draft, manage, and anchor certificates to the blockchain registry.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            {!address ? (
              <Button
                onClick={connect}
                variant="navy"
                size="lg"
                leftIcon={<Wallet className="h-4 w-4 text-teal-400" />}
              >
                Connect Wallet
              </Button>
            ) : (
              <Button
                onClick={login}
                disabled={authLoading || !isCorrectNetwork}
                isLoading={authLoading}
                loadingText="Authenticating..."
                variant="primary"
                size="lg"
                leftIcon={<ShieldCheck className="h-4 w-4" />}
              >
                Sign In with SIWE
              </Button>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/60">
              <span className="text-xs font-semibold text-slate-900 block mb-1">Non-Custodial Issuance</span>
              <span className="text-xs text-slate-500">
                You retain complete cryptographic authority. All registration transactions are signed with your private key.
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/60">
              <span className="text-xs font-semibold text-slate-900 block mb-1">Batch Registry Support</span>
              <span className="text-xs text-slate-500">
                Anchor up to 50 credentials simultaneously in an optimized single multi-hash transaction.
              </span>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Issuer Dashboard
            </h1>
            <Badge status="success" size="sm">Active Session</Badge>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Manage certificate drafts, review document hashes, and broadcast on-chain registrations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadData}
            isLoading={loading}
            title="Refresh drafts"
            leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          <Link to="/issue">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FilePlus className="h-4 w-4" />}
            >
              Issue Single
            </Button>
          </Link>

          <Link to="/issue/batch">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Layers className="h-4 w-4 text-slate-500" />}
            >
              Batch Issue
            </Button>
          </Link>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsRevokeOpen(true)}
            leftIcon={<ShieldAlert className="h-4 w-4 text-rose-500" />}
          >
            Revoke
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Prepared Drafts</span>
            <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
              <FileText className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{drafts.length}</p>
          <p className="text-xs text-slate-400 mt-1">Awaiting smart contract signature</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Batch Capacity</span>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">50 max</p>
          <p className="text-xs text-slate-400 mt-1">Batch gas-savings active</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Network Authority</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <FileCheck2 className="h-4 w-4" />
            </div>
          </div>
          <p className="text-sm font-bold font-mono text-slate-900 mt-2 truncate">
            {address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'Connected'}
          </p>
          {issuerRole === 'verified' ? (
            <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Verified Issuer Role
            </p>
          ) : issuerRole === 'missing' ? (
            <p className="text-xs text-rose-600 mt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span> Not an Authorized Issuer
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
              {issuerRole === 'checking' ? 'Checking Issuer Role…' : 'Issuer Role Unverified'}
            </p>
          )}
        </Card>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 flex items-center justify-between text-rose-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>Retry</Button>
        </div>
      )}

      {/* Drafts Table Card */}
      <Card className="shadow-xs overflow-hidden">
        {/* Table Search & Filter Toolbar */}
        <div className="p-4 sm:px-6 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID or hash..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <span className="text-xs text-slate-500 self-end sm:self-center">
            Showing <span className="font-semibold text-slate-800">{filteredDrafts.length}</span> drafts
          </span>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 sm:px-6">Certificate ID</th>
                <th className="py-3 px-4 sm:px-6">Document Hash (SHA-256)</th>
                <th className="py-3 px-4 sm:px-6">Status</th>
                <th className="py-3 px-4 sm:px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                // Skeletons
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-32" /></td>
                    <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-48" /></td>
                    <td className="py-4 px-4 sm:px-6"><Skeleton className="h-4 w-20" /></td>
                    <td className="py-4 px-4 sm:px-6 text-right"><Skeleton className="h-7 w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredDrafts.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={4} className="py-12 px-4 text-center">
                    <div className="max-w-sm mx-auto space-y-3">
                      <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                        <FileText className="h-5 w-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-slate-800">
                        {searchQuery ? 'No matching drafts found' : 'No active drafts ready'}
                      </h4>
                      <p className="text-xs text-slate-500 leading-normal">
                        {searchQuery
                          ? 'Try clearing your search query to see all prepared drafts.'
                          : 'Upload a certificate PDF to generate a cryptographic draft ready for blockchain registration.'}
                      </p>
                      {!searchQuery && (
                        <div className="pt-2">
                          <Link to="/issue">
                            <Button size="sm" variant="primary" leftIcon={<FilePlus className="h-3.5 w-3.5" />}>
                              Issue First Certificate
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                // Active Draft Rows
                filteredDrafts.map((draft) => (
                  <tr key={draft.draftId} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3.5 px-4 sm:px-6 font-semibold text-slate-900 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[200px]">{draft.certificateId}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(draft.certificateId, `id-${draft.draftId}`)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition-opacity"
                          title="Copy ID"
                        >
                          {copiedId === `id-${draft.draftId}` ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-500">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[240px]">{draft.documentHash}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(draft.documentHash, `hash-${draft.draftId}`)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition-opacity"
                          title="Copy Document Hash"
                        >
                          {copiedId === `hash-${draft.draftId}` ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 sm:px-6">
                      {/* `issued` comes from the chain; only unissued drafts can still be signed. */}
                      {draft.issued ? (
                        <Badge status="success" size="sm">
                          Already Issued
                        </Badge>
                      ) : (
                        <Badge status="info" size="sm">
                          Ready to Sign
                        </Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-right">
                      {draft.issued ? (
                        <span className="text-xs text-slate-400">On-chain</span>
                      ) : (
                        <Link to={`/issue?draft=${draft.draftId}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            rightIcon={<ArrowRight className="h-3 w-3 text-slate-400" />}
                            className="text-xs h-7 px-2.5"
                          >
                            Complete
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <RevokeModal
        isOpen={isRevokeOpen}
        onClose={() => setIsRevokeOpen(false)}
      />
    </div>
  );
}
