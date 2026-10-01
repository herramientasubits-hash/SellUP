'use client';

/**
 * detail-shared.tsx — piezas internas que comparten las pestañas del panel de
 * un proveedor. Todas son composición de piezas del sistema (`DrawerSection`,
 * `Alert`, `Spinner`, `EmptyState`, `Badge`); ninguna pinta superficie propia.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerSection, type DrawerSectionTone } from '@/components/shared/drawer-section';
import type { ActionFeedback } from './detail-format';

// ── Pares etiqueta / valor ────────────────────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-2 first:pt-0 last:border-0 last:pb-0">
      <dt className="shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** Lista de definiciones que agrupa los `InfoRow` (dt/dd) de una sección. */
export function InfoList({ children }: { children: ReactNode }) {
  return <dl>{children}</dl>;
}

// ── Avisos, cargas y vacíos ───────────────────────────────────────────────────

export function ProgressiveNote({ children }: { children: ReactNode }) {
  return (
    <Alert variant="info">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Una espera dentro de una sección: el arco que gira y qué se está cargando. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-6" role="status">
      <Spinner size="xs" decorative />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** El vacío de una sección que ya tiene su propia tarjeta: sin marco. */
export function EmptyBlock({ message, sub }: { message: string; sub?: string }) {
  return <EmptyState variant="plain" title={message} description={sub} className="p-6" />;
}

/** El resultado de la última acción, bajo los botones que la dispararon. */
export function InlineFeedback({ feedback }: { feedback: ActionFeedback | null }) {
  if (!feedback) return null;
  return (
    <Alert variant={feedback.ok ? 'success' : 'destructive'} role="status" className="px-3 py-2">
      <AlertDescription className="text-xs">{feedback.msg}</AlertDescription>
    </Alert>
  );
}

interface RetryAlertProps {
  title: string;
  /** Líneas de detalle bajo el título. */
  children?: ReactNode;
  onRetry: () => void;
}

/** Un fallo de carga contenido: no tumba el panel y deja reintentar. */
export function RetryAlert({ title, children, onRetry }: RetryAlertProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2 text-xs">
        {children}
        <Button size="xs" variant="outline" type="button" onClick={onRetry}>
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ── Indicadores ───────────────────────────────────────────────────────────────

interface StatSectionProps {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: DrawerSectionTone;
  loading?: boolean;
  children: ReactNode;
}

/** Un indicador del panel: la sección con su título, qué mide y la cifra. */
export function StatSection({ title, hint, icon, tone = 'neutral', loading = false, children }: StatSectionProps) {
  return (
    <DrawerSection title={title} hint={hint} icon={icon} tone={tone} className="min-w-0">
      {loading ? (
        <div className="flex items-center gap-1.5" role="status">
          <Spinner size="xs" decorative />
          <span className="text-xs text-muted-foreground">Cargando…</span>
        </div>
      ) : (
        children
      )}
    </DrawerSection>
  );
}

/** La cifra de un `StatSection`, con una nota apagada a su derecha. */
export function StatValue({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
      {children}
      {caption && (
        <span className="ml-1.5 text-xs font-normal tracking-normal text-muted-foreground">{caption}</span>
      )}
    </p>
  );
}

/** Lo que dice un `StatSection` cuando todavía no hay con qué calcular. */
export function StatEmpty({ children = 'Sin datos suficientes' }: { children?: ReactNode }) {
  return <p className="text-xs text-text-muted">{children}</p>;
}

// ── Estado de conexión ────────────────────────────────────────────────────────

export type StatusBadgeVariant = 'positive' | 'warning' | 'negative' | 'neutral';

const CONNECTION_STATUS_BADGE: Record<string, { label: string; variant: StatusBadgeVariant }> = {
  connected:      { label: 'Conectado',      variant: 'positive' },
  not_tested:     { label: 'Sin probar',     variant: 'warning' },
  not_configured: { label: 'No configurado', variant: 'neutral' },
  error:          { label: 'Error',          variant: 'negative' },
  disconnected:   { label: 'Desconectado',   variant: 'neutral' },
};

export function ConnectionStatusBadge({ status }: { status: string }) {
  const cfg = CONNECTION_STATUS_BADGE[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
