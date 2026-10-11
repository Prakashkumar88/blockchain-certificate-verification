import React from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle2, AlertTriangle, XCircle, Clock, HelpCircle, WifiOff } from 'lucide-react';

export type StatusType = 
  | 'VALID' 
  | 'MODIFIED' 
  | 'REVOKED' 
  | 'UNKNOWN' 
  | 'UNAVAILABLE' 
  | 'CONFIRMATION_PENDING'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusType;
  children?: React.ReactNode;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; style: string; dot: string }> = {
  VALID: {
    label: 'Valid & Verified',
    icon: CheckCircle2,
    style: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    dot: 'bg-emerald-500'
  },
  MODIFIED: {
    label: 'Tampered / Mismatch',
    icon: AlertTriangle,
    style: 'bg-amber-50 text-amber-800 border-amber-200/80',
    dot: 'bg-amber-500'
  },
  REVOKED: {
    label: 'Revoked',
    icon: XCircle,
    style: 'bg-rose-50 text-rose-700 border-rose-200/80',
    dot: 'bg-rose-500'
  },
  UNKNOWN: {
    label: 'Not Registered',
    icon: HelpCircle,
    style: 'bg-slate-100 text-slate-700 border-slate-200',
    dot: 'bg-slate-400'
  },
  UNAVAILABLE: {
    label: 'Unavailable',
    icon: WifiOff,
    style: 'bg-orange-50 text-orange-800 border-orange-200/80',
    dot: 'bg-orange-500'
  },
  CONFIRMATION_PENDING: {
    label: 'Pending Confirmation',
    icon: Clock,
    style: 'bg-sky-50 text-sky-700 border-sky-200/80',
    dot: 'bg-sky-500'
  },
  success: {
    label: 'Success',
    icon: CheckCircle2,
    style: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    dot: 'bg-emerald-500'
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    style: 'bg-amber-50 text-amber-800 border-amber-200/80',
    dot: 'bg-amber-500'
  },
  danger: {
    label: 'Danger',
    icon: XCircle,
    style: 'bg-rose-50 text-rose-700 border-rose-200/80',
    dot: 'bg-rose-500'
  },
  info: {
    label: 'Info',
    icon: Clock,
    style: 'bg-teal-50 text-teal-700 border-teal-200/80',
    dot: 'bg-teal-500'
  },
  neutral: {
    label: 'Default',
    icon: HelpCircle,
    style: 'bg-slate-50 text-slate-600 border-slate-200',
    dot: 'bg-slate-400'
  }
};

export const Badge: React.FC<BadgeProps> = ({
  status = 'neutral',
  children,
  showIcon = true,
  size = 'md',
  className,
  ...props
}) => {
  const config = statusConfig[status] || statusConfig.neutral;
  const Icon = config.icon;

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-medium',
    lg: 'text-sm px-3 py-1.5 gap-2 font-medium',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border tracking-wide transition-colors',
        sizeStyles[size],
        config.style,
        className
      )}
      {...props}
    >
      {showIcon && <Icon className={cn('shrink-0', iconSizes[size])} />}
      <span>{children || config.label}</span>
    </span>
  );
};
