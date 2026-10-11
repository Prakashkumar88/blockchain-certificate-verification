import React from 'react';
import { Shield, Lock, Layers } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-slate-100">
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-slate-900 flex items-center justify-center text-teal-400">
                <Shield className="h-4 w-4" />
              </div>
              <span className="font-semibold text-slate-900 tracking-tight text-base">CertiVerify</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 font-semibold tracking-wider">
                Registry v1.0
              </span>
            </div>
            <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
              Enterprise-grade, non-custodial cryptographic certificate verification. Direct on-chain registry verification with SIWE authentication and immutable document anchoring.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 mb-3">Protocol</h4>
            <ul className="space-y-2 text-xs text-slate-500">
              <li className="flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-teal-600" />
                <span>Zero-Knowledge Proof Ready</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-teal-600" />
                <span>SHA-256 PDF Hashes</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-teal-600" />
                <span>EIP-4361 SIWE Auth</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 mb-3">Network & Security</h4>
            <div className="space-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span className="font-medium text-slate-700">Contract Registry: Active</span>
              </div>
              <p className="font-mono text-[11px] text-slate-400 truncate">
                Target Chain: EIP-155 / Anvil 31337
              </p>
              <p className="text-[11px] text-slate-400">
                Non-custodial: Private keys never touch servers
              </p>
            </div>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© 2026 CertiVerify. Designed for cryptographic document integrity.</p>
          <div className="flex items-center gap-4 text-slate-500">
            <span>Production Grade</span>
            <span>•</span>
            <span>Audit-ready Architecture</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
