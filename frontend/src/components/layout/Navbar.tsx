import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../../contexts/WalletContext';
import { useAuth } from '../../contexts/AuthContext';
import { 
  ShieldCheck, 
  AlertTriangle, 
  LogOut, 
  Wallet, 
  Menu, 
  X, 
  FileCheck2, 
  LayoutDashboard,
  CheckCircle2,
  Copy,
  Check
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';

export function Navbar() {
  const { address, isCorrectNetwork, connect } = useWallet();
  const { isAuthenticated, login, logout, isLoading } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const navLinks = [
    { name: 'Verify Certificate', path: '/', icon: FileCheck2 },
    { name: 'Issuer Dashboard', path: '/dashboard', icon: LayoutDashboard },
  ];

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Brand & Desktop Navigation */}
          <div className="flex items-center gap-8">
            <Link 
              to="/" 
              className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-md"
              aria-label="CertiVerify Home"
            >
              <div className="h-9 w-9 rounded-lg bg-slate-900 flex items-center justify-center text-teal-400 shadow-xs transition-transform group-hover:scale-105">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg text-slate-900 tracking-tight leading-tight">CertiVerify</span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">Blockchain Registry</span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center space-x-1" aria-label="Main Navigation">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path || (link.path !== '/' && location.pathname.startsWith(link.path));
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-slate-100 text-slate-900 font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isActive ? "text-teal-600" : "text-slate-400")} />
                    <span>{link.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Wallet & Auth Controls (Desktop) */}
          <div className="hidden md:flex items-center gap-3">
            {address && !isCorrectNetwork && (
              <div 
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200"
                title="Please switch to the target network in your wallet"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>Wrong Network</span>
              </div>
            )}

            {!address ? (
              <Button
                onClick={connect}
                variant="navy"
                size="sm"
                leftIcon={<Wallet className="h-4 w-4 text-teal-400" />}
              >
                Connect Wallet
              </Button>
            ) : !isAuthenticated ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyAddress}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200"
                  title="Click to copy wallet address"
                >
                  <span>{formatAddress(address)}</span>
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-slate-400" />}
                </button>
                <Button
                  onClick={login}
                  disabled={isLoading || !isCorrectNetwork}
                  isLoading={isLoading}
                  loadingText="Signing..."
                  size="sm"
                  variant="primary"
                >
                  Sign In (SIWE)
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200/80 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Authenticated</span>
                </div>

                <button
                  type="button"
                  onClick={copyAddress}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200"
                  title="Click to copy wallet address"
                >
                  <span>{formatAddress(address)}</span>
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-slate-400" />}
                </button>

                <Button
                  onClick={logout}
                  disabled={isLoading}
                  variant="outline"
                  size="sm"
                  title="Sign out of SIWE session"
                  leftIcon={<LogOut className="h-3.5 w-3.5 text-slate-500" />}
                >
                  Sign Out
                </Button>
              </div>
            )}
          </div>

          {/* Mobile Menu Hamburger Button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-4">
          <nav className="flex flex-col space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path || (link.path !== '/' && location.pathname.startsWith(link.path));
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  <Icon className={cn("h-4 w-4", isActive ? "text-teal-600" : "text-slate-400")} />
                  <span>{link.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-slate-100 flex flex-col gap-3">
            {address && !isCorrectNetwork && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 text-amber-800 text-xs border border-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Wrong Network. Switch wallet network to continue.</span>
              </div>
            )}

            {!address ? (
              <Button
                onClick={() => {
                  connect();
                  setMobileMenuOpen(false);
                }}
                variant="navy"
                size="md"
                className="w-full"
                leftIcon={<Wallet className="h-4 w-4 text-teal-400" />}
              >
                Connect Wallet
              </Button>
            ) : !isAuthenticated ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-slate-100 text-xs font-mono text-slate-700">
                  <span>{formatAddress(address)}</span>
                  <span className="text-slate-400 text-[11px]">Connected</span>
                </div>
                <Button
                  onClick={() => {
                    login();
                    setMobileMenuOpen(false);
                  }}
                  disabled={isLoading || !isCorrectNetwork}
                  isLoading={isLoading}
                  size="md"
                  variant="primary"
                  className="w-full"
                >
                  Sign In (SIWE)
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-3 py-2 rounded-md bg-emerald-50 text-xs text-emerald-800 border border-emerald-200">
                  <span className="font-mono">{formatAddress(address)}</span>
                  <span className="font-medium">Authenticated</span>
                </div>
                <Button
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  disabled={isLoading}
                  variant="outline"
                  size="md"
                  className="w-full"
                  leftIcon={<LogOut className="h-4 w-4" />}
                >
                  Sign Out
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
