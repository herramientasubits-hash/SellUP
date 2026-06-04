'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Copy, Check, Database, ExternalLink, Layers, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  formatDatasetLabel,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';
import type { SourceViewModel } from '@/modules/source-catalog/queries';
import type {
  SocrataPreviewBatchListItem,
  SocrataPreviewBatchListViewModel,
} from '@/modules/source-catalog/socrata-batches-queries';
export type { SocrataPreviewBatchListItem, SocrataPreviewBatchListViewModel } from '@/modules/source-catalog/socrata-batches-queries';

interface SourceDetailDrawerProps {
  source: SourceViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socrataBatches: SocrataPreviewBatchListViewModel;
}

export function SourceDetailDrawer({
  source,
  open,
  onOpenChange,
  socrataBatches,
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

  const isRues = source.key === 'co_rues';

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

        {isRues && (
          <SurfaceCard noPadding>
            <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Lotes Socrata
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Revisión interna de lotes creados desde RUES. Solo lectura.
                  </p>
                </div>
              </div>
              <Link
                href="/settings/source-catalog/socrata-batches"
                className="shrink-0 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-su-brand/40 hover:bg-su-brand-soft hover:text-su-brand transition-colors"
              >
                Ver página completa
              </Link>
            </div>

            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-border/40 bg-muted/30">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Solo lectura para candidatos.</span>{' '}
                No permite editar, aprobar, descartar ni sincronizar.
              </p>
            </div>

            {socrataBatches.batches.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Database className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Aún no hay lotes Socrata creados.
                </p>
              </div>
            ) : (
              <SocrataBatchesTable batches={socrataBatches.batches} />
            )}
          </SurfaceCard>
        )}
      </div>
    </DrawerShell>
  );
}

function SocrataBatchesTable({
  batches,
}: {
  batches: SocrataPreviewBatchListItem[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 text-left">
            <th className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Nombre
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Estado
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Dataset
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Candidatos
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Flags
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Fecha
            </th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {batches.map((batch) => (
            <tr
              key={batch.id}
              className="transition-colors hover:bg-muted/20"
            >
              <td className="px-5 py-3">
                <span className="font-medium text-foreground">{batch.name}</span>
                {batch.countryCode && (
                  <span className="ml-2 text-[11px] text-muted-foreground/60">
                    {batch.countryCode}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${batchStatusBadgeClass(batch.status)}`}
                >
                  {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDatasetLabel(batch.dataset)}
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">
                {batch.candidatesCount}
                {batch.targetCount ? (
                  <span className="ml-1 text-[11px] text-muted-foreground/50">
                    / {batch.targetCount}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {batch.previewMode && (
                    <Badge className="border-su-brand/30 bg-su-brand-soft text-su-brand border text-[10px]">
                      Preview
                    </Badge>
                  )}
                  {batch.smokeTest && (
                    <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 border text-[10px]">
                      Smoke
                    </Badge>
                  )}
                  {batch.rollbackLogical && (
                    <Badge className="border-border/40 bg-muted/60 text-muted-foreground/60 border text-[10px]">
                      Rollback
                    </Badge>
                  )}
                  {!batch.previewMode && !batch.smokeTest && !batch.rollbackLogical && (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {formatShortDate(batch.createdAt)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/settings/source-catalog/socrata-batches/${batch.id}`}
                  className="rounded-md px-2.5 py-1 text-[11px] font-medium text-su-brand hover:bg-su-brand-soft transition-colors"
                >
                  Ver detalle
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
