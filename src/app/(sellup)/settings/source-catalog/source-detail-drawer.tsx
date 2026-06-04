'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Copy, Check, Database, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard } from '@/components/shared/surface-card';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
} from '@/modules/source-catalog/labels';
import type { SourceViewModel } from '@/modules/source-catalog/queries';

interface SourceDetailDrawerProps {
  source: SourceViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SourceDetailDrawer({
  source,
  open,
  onOpenChange,
}: SourceDetailDrawerProps) {
  if (!source) {
    return (
      <DrawerShell
        open={open}
        onOpenChange={onOpenChange}
        side="right"
        className="!w-[80vw] !max-w-[80vw] sm:!max-w-[80vw]"
        title="Detalle de la fuente"
        description="Cargando información…"
      />
    );
  }

  const statusClass = operationalStatusBadgeClass(source.operationalStatus);
  const dotClass = operationalStatusDotClass(source.operationalStatus);
  const statusLabel = OPERATIONAL_STATUS_LABELS[source.operationalStatus];
  const countryLabels =
    source.countryCodes.length > 0
      ? source.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
      : 'Global';

  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      className="!w-[80vw] !max-w-[80vw] sm:!max-w-[80vw]"
      title={source.name}
      description={source.key}
      icon={
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
      }
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <CopyKeyInline sourceKey={source.key} />
          <div className="flex items-center gap-2">
            {source.url && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-lg"
                asChild
              >
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir URL
                </a>
              </Button>
            )}
            <Button size="sm" className="h-9 rounded-lg" asChild>
              <Link href={`/settings/source-catalog/${source.key}`}>
                <ArrowRight className="h-3.5 w-3.5" />
                Abrir página completa
              </Link>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Status badges row */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            {statusLabel}
          </span>
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
            {PRIORITY_LABELS[source.priority]}
          </span>
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
            {TYPE_LABELS[source.type]}
          </span>
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
            Automatización: {AUTOMATION_LEVEL_LABELS[source.automationLevel]}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SurfaceCard>
            <h2 className="text-[0.8125rem] font-semibold text-foreground mb-4">
              Información general
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                  Key
                </dt>
                <dd className="font-mono text-foreground break-all">{source.key}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                  País
                </dt>
                <dd className="text-foreground">{countryLabels}</dd>
              </div>
              {source.sectors.length > 0 && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                    Sectores
                  </dt>
                  <dd className="text-foreground">{source.sectors.join(', ')}</dd>
                </div>
              )}
              {source.url && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                    URL
                  </dt>
                  <dd>
                    <Link
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-su-brand hover:underline break-all"
                    >
                      {source.url}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </SurfaceCard>

          <SurfaceCard>
            <h2 className="text-[0.8125rem] font-semibold text-foreground mb-4">
              Uso recomendado
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {source.recommendedUse}
            </p>
          </SurfaceCard>

          {source.limitations.length > 0 && (
            <SurfaceCard>
              <h2 className="text-[0.8125rem] font-semibold text-foreground mb-4">
                Limitaciones
              </h2>
              <ul className="space-y-2">
                {source.limitations.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                    {item}
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}

          {source.riskNotes.length > 0 && (
            <SurfaceCard>
              <h2 className="text-[0.8125rem] font-semibold text-foreground mb-4">
                Notas de riesgo
              </h2>
              <ul className="space-y-2">
                {source.riskNotes.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-amber-600 dark:text-amber-400"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}
        </div>

        {source.key === 'co_rues' && (
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Lotes Socrata
                </p>
                <p className="text-xs text-muted-foreground">
                  Revisión interna de lotes creados desde esta fuente.
                </p>
              </div>
            </div>
            <Link
              href="/settings/source-catalog/socrata-batches"
              className="shrink-0 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-su-brand/40 hover:bg-su-brand-soft hover:text-su-brand transition-colors"
            >
              Ver lotes
            </Link>
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

function CopyKeyInline({ sourceKey }: { sourceKey: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sourceKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copiado' : 'Copiar key'}
    </button>
  );
}
