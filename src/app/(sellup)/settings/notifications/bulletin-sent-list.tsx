'use client';

import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import { cn } from '@/lib/utils';
import { formatAppDateTime } from '@/lib/format-date';
import { formatPeriod, frequencyLabel, type BulletinDeliveryRow } from './notification-settings-types';

// ============================================================
// Lista compacta de boletines enviados a una persona. Al pulsar uno se abre
// en el visor (no en un panel aparte).
// ============================================================

const DELIVERY_STATUS: Record<string, { status: StatusType; label: string }> = {
  sent: { status: 'completed', label: 'Enviado' },
  failed: { status: 'error', label: 'Falló' },
  not_in_slack: { status: 'warning', label: 'No está en Slack' },
};

export function deliveryStatus(status: string): { status: StatusType; label: string } {
  return DELIVERY_STATUS[status] ?? { status: 'neutral', label: status };
}

interface BulletinSentListProps {
  rows: readonly BulletinDeliveryRow[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  onOpen: (row: BulletinDeliveryRow) => void;
}

export function BulletinSentList({ rows, selectedId, loading, error, emptyMessage, onOpen }: BulletinSentListProps) {
  if (loading) return <p className="text-sm text-muted-foreground">Cargando los enviados…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60" aria-label="Boletines enviados">
      {rows.map((row) => {
        const status = deliveryStatus(row.status);
        const label = `Boletín ${frequencyLabel(row.frequency).toLowerCase()} · ${formatPeriod(row.periodStart, row.periodEnd)}`;
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-label={`Ver ${label}`}
              aria-current={selectedId === row.id ? 'true' : undefined}
              onClick={() => onOpen(row)}
              className={cn(
                'flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none',
                selectedId === row.id && 'bg-primary/10',
              )}
            >
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {formatAppDateTime(row.createdAt)}
                  {row.manual ? ' · Prueba' : ''}
                </span>
              </span>
              <StatusBadge status={status.status} label={status.label} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
