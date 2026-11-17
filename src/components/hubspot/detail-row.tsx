import * as React from 'react';
import { formatInAppZone } from '@/lib/format-date';

/** Fila «etiqueta — valor» de las fichas de consulta (igual que la de la ficha de empresa). */
export function HubSpotDetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex min-w-[104px] shrink-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <dt className="text-xs text-muted-foreground">{label}</dt>
      </div>
      <dd className="min-w-0 flex-1 break-words text-sm text-foreground sm:text-right">
        {children ?? <span className="text-text-muted">—</span>}
      </dd>
    </div>
  );
}

/** Fecha corta de una fecha de HubSpot (ISO), o null si no se puede leer. */
export function formatHubSpotShortDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return formatInAppZone(new Date(t).toISOString(), { day: '2-digit', month: 'short', year: 'numeric' }, 'es-CO');
}
