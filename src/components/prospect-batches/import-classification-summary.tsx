'use client';

// ── Import Classification Summary — Hito 16AB.40 ──────────────────────────────
// Shows classification summary stats with visual indicators.

import { CheckCircle2, AlertTriangle, XCircle, Pencil, Info } from "@/icons";
import { cn } from '@/lib/utils';
import type { ClassificationSummaryStats } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Props ─────────────────────────────────────────────────────────────────────

type ClassificationSummaryProps = {
  stats: ClassificationSummaryStats;
  catalogVersion: string;
  className?: string;
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  count,
  total,
  icon: Icon,
  variant,
  className,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ComponentType<{ className?: string }>;
  variant: 'success' | 'warning' | 'destructive' | 'info' | 'default';
  className?: string;
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  const variantStyles: Record<string, string> = {
    success: 'border-success/20 bg-success/10',
    warning: 'border-warning/25 bg-warning/15',
    destructive: 'border-destructive/20 bg-destructive/10',
    info: 'border-primary/20 bg-primary/10',
    default: 'border-border/60 bg-surface-subtle',
  };

  const iconStyles: Record<string, string> = {
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-primary',
    default: 'text-muted-foreground',
  };

  return (
    <div className={cn('rounded-xl border p-3 transition-colors', variantStyles[variant], className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', iconStyles[variant])} />
          <span className="truncate text-xs font-semibold text-muted-foreground" title={label}>
            {label}
          </span>
        </div>
        <span className="text-xs font-bold tabular-nums text-foreground">
          {count}
        </span>
      </div>
      {/* Progress bar */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            variant === 'success' && 'bg-success',
            variant === 'warning' && 'bg-warning',
            variant === 'destructive' && 'bg-destructive',
            variant === 'info' && 'bg-primary',
            variant === 'default' && 'bg-muted-foreground/40',
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {percentage}% del total
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClassificationSummary({
  stats,
  catalogVersion,
  className,
}: ClassificationSummaryProps) {
  const readyCount = stats.valid + stats.normalized;
  const readyPercentage = stats.total > 0 ? Math.round((readyCount / stats.total) * 100) : 0;
  const canProceed = stats.requiresReview === 0 && stats.invalid === 0;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Ready status banner */}
      <div
        className={cn(
          'rounded-xl border p-3 flex items-center gap-3',
          canProceed
            ? 'border-success/20 bg-success/10'
            : 'border-warning/25 bg-warning/15',
        )}
      >
        {canProceed ? (
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {canProceed
              ? `${readyCount} de ${stats.total} filas listas para importar (${readyPercentage}%)`
              : `${stats.requiresReview + stats.invalid} de ${stats.total} filas requieren corrección antes de importar`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Catálogo: v{catalogVersion}
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Listas"
          count={stats.valid}
          total={stats.total}
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          label="Normalizadas"
          count={stats.normalized}
          total={stats.total}
          icon={Info}
          variant="info"
        />
        <StatCard
          label="Advertencias"
          count={stats.warning}
          total={stats.total}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard
          label="Requieren revisión"
          count={stats.requiresReview}
          total={stats.total}
          icon={XCircle}
          variant="destructive"
        />
      </div>
    </div>
  );
}
