import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { 
  Search, 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  WifiOff, 
  X, 
  ShieldCheck, 
  Copy, 
  Check, 
  HelpCircle, 
  Hash, 
  User, 
  Shield, 
  Layers, 
  Lock 
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';

export default function Verify() {
  const [certId, setCertId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);

  const invalidateResult = () => {
    requestVersion.current++;
    setResult(null);
    setError(null);
    setIsLoading(false);
  };

  const changeCertificateId = (value: string) => {
    invalidateResult();
    setCertId(value);
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const validateAndSetFile = (selectedFile: File) => {
    invalidateResult();
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('File exceeds 10 MiB limit. Please select a smaller PDF.');
      return false;
    }
    if (selectedFile.type !== 'application/pdf' && !selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setError('Unsupported format. Only authentic PDF documents (.pdf) can be verified.');
      return false;
    }
    setFile(selectedFile);
    setError(null);
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = certId.trim();
    if (!trimmedId) {
      setError('Certificate ID is required to look up records on the registry');
      return;
    }

    const version = ++requestVersion.current;
    const submittedFile = file;
    try {
      setIsLoading(true);
      setError(null);
      setResult(null);

      let res;
      if (submittedFile) {
        res = await api.certificates.verifyPdf(trimmedId, submittedFile);
      } else {
        res = await api.certificates.verify(trimmedId);
      }
      if (version !== requestVersion.current) return;
      if (res?.certificateId && res.certificateId.toLowerCase() !== trimmedId.toLowerCase()) {
        throw new Error('The verification response does not match the submitted certificate ID.');
      }
      setResult({
        ...res,
        certificateId: trimmedId,
        mode: submittedFile ? 'pdf' : 'id',
        status: res?.reason === 'CONFIRMATION_PENDING' || res?.transactionStatus === 'CONFIRMATION_PENDING'
          ? 'CONFIRMATION_PENDING' : res?.status,
      });
    } catch (err: any) {
      if (version === requestVersion.current) setError(err.message || 'Verification failed. The network or registry could not be queried.');
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  };

  const statusConfig: Record<string, {
    badgeStatus: 'VALID' | 'MODIFIED' | 'REVOKED' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFIRMATION_PENDING';
    title: string;
    description: string;
    headerBg: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
  }> = {
    VALID: {
      badgeStatus: 'VALID',
      title: result?.mode === 'pdf' && result?.documentMatch === true ? 'Authentic Certificate' : 'Certificate Record Found',
      description: result?.mode === 'pdf' && result?.documentMatch === true
        ? 'The uploaded PDF hash matches the blockchain record, which has not been revoked.'
        : result?.mode === 'pdf'
          ? 'An unrevoked certificate record exists on-chain, but a PDF hash match has not been established.'
          : 'An unrevoked certificate record exists on-chain. This ID lookup does not establish that a PDF matches the stored hash.',
      headerBg: 'bg-emerald-50/60 border-emerald-200/80 text-emerald-950',
      icon: CheckCircle2,
      accentColor: 'text-emerald-600',
    },
    MODIFIED: {
      badgeStatus: 'MODIFIED',
      title: 'Tampered Document',
      description: 'Warning: The computed hash of this document does NOT match the cryptographic anchor stored on the blockchain.',
      headerBg: 'bg-amber-50/60 border-amber-200/80 text-amber-950',
      icon: AlertTriangle,
      accentColor: 'text-amber-600',
    },
    REVOKED: {
      badgeStatus: 'REVOKED',
      title: 'Revoked Certificate',
      description: 'This credential was previously valid but has been permanently revoked by the issuing institution.',
      headerBg: 'bg-rose-50/60 border-rose-200/80 text-rose-950',
      icon: XCircle,
      accentColor: 'text-rose-600',
    },
    UNKNOWN: {
      badgeStatus: 'UNKNOWN',
      title: 'Certificate Not Found',
      description: 'No certificate matching this identifier exists on the registry. Please double check the Certificate ID.',
      headerBg: 'bg-slate-100/70 border-slate-200 text-slate-900',
      icon: HelpCircle,
      accentColor: 'text-slate-600',
    },
    UNAVAILABLE: {
      badgeStatus: 'UNAVAILABLE',
      title: 'Registry Unavailable',
      description: 'The verification node or blockchain network is currently unreachable. Please try again shortly.',
      headerBg: 'bg-orange-50/60 border-orange-200/80 text-orange-950',
      icon: WifiOff,
      accentColor: 'text-orange-600',
    },
    CONFIRMATION_PENDING: {
      badgeStatus: 'CONFIRMATION_PENDING',
      title: 'Pending Confirmation',
      description: 'The certificate transaction has been submitted to the blockchain network and is awaiting final block confirmation.',
      headerBg: 'bg-sky-50/60 border-sky-200/80 text-sky-950',
      icon: Clock,
      accentColor: 'text-sky-600',
    },
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Page Header */}
      <div className="text-center space-y-3 pt-4 sm:pt-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
          <span>Non-Custodial Cryptographic Verification</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          Verify a Certificate
        </h1>
        <p className="max-w-2xl mx-auto text-sm sm:text-base text-slate-500 leading-relaxed">
          Verify document integrity directly against the blockchain registry. Enter a Certificate ID, or upload the original PDF to run an end-to-end cryptographic integrity comparison.
        </p>
      </div>

      {/* Main Verification Card */}
      <Card className="shadow-sm">
        <form onSubmit={handleVerify}>
          <div className="p-6 sm:p-8 space-y-6">
            {/* Certificate ID Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="certId" className="block text-sm font-semibold text-slate-800">
                  Certificate ID <span className="text-rose-500" aria-hidden="true">*</span>
                </label>
                <span className="text-xs text-slate-400">Unique cryptographic ID</span>
              </div>
              <div className="relative rounded-lg shadow-2xs">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  id="certId"
                  name="certId"
                  value={certId}
                  onChange={(e) => changeCertificateId(e.target.value)}
                  placeholder="e.g. 0x8f2d... or CERT-2026-001"
                  className="block w-full pl-10 pr-20 py-2.5 sm:py-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors placeholder:text-slate-400 font-mono"
                  aria-required="true"
                  autoComplete="off"
                  spellCheck="false"
                />
                {certId && (
                  <button
                    type="button"
                    onClick={() => changeCertificateId('')}
                    className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 hover:text-slate-600"
                    aria-label="Clear certificate ID"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Drag & Drop PDF Upload Area */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-800">
                  Document Integrity Check <span className="text-xs font-normal text-slate-400">(Optional)</span>
                </label>
                {file && (
                  <span className="text-xs font-medium text-teal-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> PDF Attached
                  </span>
                )}
              </div>

              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
                className={cn(
                  "relative border-2 border-dashed rounded-xl p-6 transition-all duration-150 text-center cursor-pointer",
                  isDragging
                    ? "border-teal-500 bg-teal-50/50 scale-[1.005]"
                    : file
                    ? "border-slate-200 bg-slate-50/60 cursor-default"
                    : "border-slate-300 hover:border-slate-400 bg-slate-50/40 hover:bg-slate-50/80"
                )}
              >
                <input
                  ref={fileInputRef}
                  id="file-upload"
                  name="file-upload"
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
                      <span className="font-semibold text-teal-600 hover:text-teal-700">
                        Click to upload
                      </span>{' '}
                      or drag and drop original PDF
                    </div>
                    <p className="text-xs text-slate-400">
                      Cryptographic SHA-256 hash comparison • PDF under 10 MiB
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 sm:p-3 bg-white rounded-lg border border-slate-200">
                    <div className="flex items-center gap-3 overflow-hidden text-left">
                      <div className="h-10 w-10 shrink-0 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center border border-teal-100">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="truncate">
                        <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                        <p className="text-xs text-slate-400 font-mono">
                          {(file.size / 1024).toFixed(1)} KB • application/pdf
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        invalidateResult();
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Remove attached PDF"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Error Banner */}
            {error && (
              <div 
                className="rounded-lg bg-rose-50 border border-rose-200 p-4 flex items-start gap-3 text-rose-800"
                role="alert"
              >
                <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <span className="font-semibold">Verification Error: </span>
                  {error}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div>
              <Button
                type="submit"
                disabled={isLoading || !certId.trim()}
                isLoading={isLoading}
                loadingText="Verifying with Smart Contract..."
                size="lg"
                variant="primary"
                className="w-full font-semibold shadow-xs"
              >
                Verify Certificate
              </Button>
            </div>
          </div>
        </form>

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="border-t border-slate-200 p-6 sm:p-8 bg-slate-50/50 space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
            </div>
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        )}

        {/* Verification Result Dossier */}
        {result && !isLoading && (
          <div 
            className="border-t border-slate-200" 
            aria-live="polite"
          >
            {(() => {
              const cfg = statusConfig[result.status] || statusConfig.UNAVAILABLE;
              const StatusIcon = cfg.icon;
              return (
                <div className="p-6 sm:p-8 space-y-6">
                  {/* Status Banner */}
                  <div className={cn("p-4 sm:p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4", cfg.headerBg)}>
                    <div className="flex items-start gap-3.5">
                      <div className={cn("p-2 rounded-lg bg-white shadow-2xs shrink-0", cfg.accentColor)}>
                        <StatusIcon className="h-6 w-6" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold tracking-tight text-slate-900">
                            {cfg.title}
                          </h3>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600 leading-normal max-w-xl">
                          {cfg.description}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 self-start sm:self-center">
                      <Badge status={cfg.badgeStatus} size="lg" />
                    </div>
                  </div>

                  {/* Blockchain Record Metadata Table */}
                  {result.record ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          On-Chain Registry Record
                        </h4>
                        <span className="text-xs font-mono text-slate-400">
                          Issued at Block #{result.record.issuedBlock ?? 'Unknown'}
                        </span>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs divide-y divide-slate-100">
                        {/* Certificate ID */}
                        <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 transition-colors">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <Shield className="h-3.5 w-3.5 text-slate-400" />
                            <span>Certificate Identifier</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-900 break-all">
                            <span>{result.certificateId}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(result.certificateId, 'certId')}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                              title="Copy Certificate ID"
                            >
                              {copiedField === 'certId' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Issuer Address */}
                        <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 transition-colors">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <User className="h-3.5 w-3.5 text-slate-400" />
                            <span>Authorized Issuer</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-900 break-all">
                            <span>{result.record.issuer}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(result.record.issuer, 'issuer')}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                              title="Copy Issuer Address"
                            >
                              {copiedField === 'issuer' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Document Hash */}
                        <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 transition-colors">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <Hash className="h-3.5 w-3.5 text-slate-400" />
                            <span>SHA-256 Digest</span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-xs text-slate-900 break-all">
                            <span>{result.record.documentHash}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(result.record.documentHash, 'docHash')}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                              title="Copy Document Hash"
                            >
                              {copiedField === 'docHash' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        {/* Block Confirmations */}
                        <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 transition-colors">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <Layers className="h-3.5 w-3.5 text-slate-400" />
                            <span>Confirmations</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">{result.confirmations ?? 0}</span> blocks
                            <span className="text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              Observed confirmations
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 text-center rounded-xl border border-slate-200 bg-slate-50/50">
                      <p className="text-xs text-slate-500">
                        No active blockchain record found associated with this identifier.
                      </p>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const summary = `CertiVerify Report: Certificate ${result.certificateId} is ${result.status}. Mode: ${result.mode}. Issuer: ${result.record?.issuer || 'N/A'}`;
                        handleCopy(summary, 'summary');
                      }}
                      leftIcon={copiedField === 'summary' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    >
                      {copiedField === 'summary' ? 'Copied Summary' : 'Copy Verification Summary'}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        changeCertificateId('');
                        setFile(null);
                        setResult(null);
                      }}
                    >
                      Verify Another
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Card>

      {/* Protocol Architecture Features Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4">
        <Card variant="muted" className="p-5 space-y-2">
          <div className="h-8 w-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 mb-3">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Cryptographically Provable</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            Certificates are anchored to the smart contract using SHA-256 collision-resistant hashes.
          </p>
        </Card>

        <Card variant="muted" className="p-5 space-y-2">
          <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
            <Lock className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Tamper-Evident Integrity</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            Even a single modified pixel or byte in the PDF produces an immediate hash mismatch.
          </p>
        </Card>

        <Card variant="muted" className="p-5 space-y-2">
          <div className="h-8 w-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 mb-3">
            <Layers className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Direct Smart Contract Registry</h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            Verification queries the on-chain registry state with zero intermediary dependencies.
          </p>
        </Card>
      </div>
    </div>
  );
}
