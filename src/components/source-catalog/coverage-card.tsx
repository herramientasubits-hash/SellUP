/**
 * Base común de las tarjetas de cobertura / estado del catálogo de fuentes.
 *
 * Todas comparten la misma anatomía: cabecera con icono, grupos de pares
 * etiqueta/valor, listas de limitaciones y un aviso de estado operativo. Aquí
 * vive esa anatomía una sola vez; cada tarjeta solo aporta sus datos.
 *
 * Solo presentación: sin I/O, sin acciones de servidor, sin secretos.
 */

import type { ReactNode } from 'react';

import { type LucideIcon } from '@/icons';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Heading } from '@/components/typography';

// ─── Tarjeta ─────────────────────────────────────────────────────────────────

interface CoverageCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** La tarjeta: superficie, chip del icono, título y el cuerpo con su ritmo. */
export function CoverageCard({ icon: Icon, title, description, actions, children }: CoverageCardProps) {
  return (
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40"
        >
          <Icon className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title={title}
          description={description}
          actions={actions}
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>
      <div className="space-y-5">{children}</div>
    </SurfaceCard>
  );
}

interface CoverageCardErrorProps {
  icon: LucideIcon;
  title: string;
  /** Qué no se pudo cargar, en una frase. */
  message: string;
}

/** La misma tarjeta cuando el resumen no se pudo leer. */
export function CoverageCardError({ icon, title, message }: CoverageCardErrorProps) {
  return (
    <CoverageCard icon={icon} title={title}>
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </CoverageCard>
  );
}

// ─── Secciones ───────────────────────────────────────────────────────────────

interface CoverageSectionProps {
  title: string;
  /** Una línea bajo el título que explica el grupo. */
  description?: ReactNode;
  /** Separa la sección de la anterior con una divisoria. */
  divided?: boolean;
  className?: string;
  children: ReactNode;
}

/** Un grupo con título dentro de la tarjeta. Nunca pinta una caja propia. */
export function CoverageSection({ title, description, divided, className, children }: CoverageSectionProps) {
  return (
    <section className={cn(divided && 'border-t border-border/50 pt-5', className)}>
      <Heading level={6} as="h3" className="text-sm">
        {title}
      </Heading>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Un grupo de pares etiqueta/valor (`dl`) con su título. */
export function CoverageFieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <Heading level={6} as="h3" className="text-sm">
        {title}
      </Heading>
      <dl className="mt-1 divide-y divide-border/50">{children}</dl>
    </section>
  );
}

interface CoverageFieldRowProps {
  label: string;
  value: ReactNode;
  /** Una línea de contexto bajo el par (p. ej. «750.000 de 2.317.298 filas»). */
  detail?: string;
}

/** Un par etiqueta/valor: etiqueta apagada a la izquierda, dato a la derecha. */
export function CoverageFieldRow({ label, value, detail }: CoverageFieldRowProps) {
  return (
    <div className="py-2">
      <div className="grid grid-cols-2 items-baseline gap-x-4">
        <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words text-right text-xs font-medium tabular-nums text-foreground">
          {value}
        </dd>
      </div>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/**
 * Bloque hundido que resume qué tipo de señal es la fuente. Agrupa datos: va
 * sin borde para no ser una caja dentro de la tarjeta.
 */
export function CoverageSignalSummary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-surface-subtle px-4 py-3">
      <Heading level={6} as="h3" className="text-sm">
        {title}
      </Heading>
      <div className="mt-1">{children}</div>
    </section>
  );
}

// ─── Métricas ────────────────────────────────────────────────────────────────

/** Rejilla de cifras cortas. */
export function CoverageMetricGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn('grid grid-cols-2 gap-2', className)}>{children}</dl>;
}

interface CoverageMetricProps {
  label: string;
  value: ReactNode;
  /** Resalta la cifra como resultado positivo. */
  highlight?: boolean;
}

/** Una cifra con su etiqueta, sobre fondo hundido y sin borde. */
export function CoverageMetric({ label, value, highlight }: CoverageMetricProps) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 rounded-xl bg-surface-subtle px-3 py-2.5">
      <dt className="text-xs font-medium leading-snug text-muted-foreground">{label}</dt>
      <dd className={cn('text-xl font-semibold tabular-nums', highlight ? 'text-success' : 'text-foreground')}>
        {value}
      </dd>
    </div>
  );
}

// ─── Listas ──────────────────────────────────────────────────────────────────

export type CoverageBulletTone = 'muted' | 'warning' | 'caution';

const BULLET_TEXT: Record<CoverageBulletTone, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  caution: 'text-muted-foreground',
};

const BULLET_DOT: Record<CoverageBulletTone, string> = {
  muted: 'bg-muted-foreground',
  warning: 'bg-warning',
  caution: 'bg-warning',
};

export function CoverageBulletList({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn('space-y-1.5', className)}>{children}</ul>;
}

/** Una línea de limitación (`muted`) o de salvaguarda (`warning` / `caution`). */
export function CoverageBullet({
  tone = 'muted',
  children,
}: {
  tone?: CoverageBulletTone;
  children: ReactNode;
}) {
  return (
    <li className={cn('flex gap-2 text-xs', BULLET_TEXT[tone])}>
      <span aria-hidden="true" className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', BULLET_DOT[tone])} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

/** El aviso de estado operativo con el que cierran las tarjetas. */
export function CoverageStatusNotice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Alert variant="warning">
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="text-xs leading-relaxed">{children}</AlertDescription>
    </Alert>
  );
}

/** Pie discreto que explica por qué el indicador viene del respaldo auditado. */
export function CoverageSourceReason({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;
  return (
    <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">Motivo: {reason}</p>
  );
}
