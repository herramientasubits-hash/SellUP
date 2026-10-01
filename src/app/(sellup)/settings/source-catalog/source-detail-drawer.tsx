'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CircleSlash, Copy, Check, Database, ExternalLink, KeyRound, Layers, Lightbulb, Lock, Info, Plug,
} from "@/icons";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  SELLUP_USE_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
  sellupUseBadgeClass,
  aiFlowStatusBadgeClass,
  connectionModeBadgeClass,
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
import type { SourceDetailDrawerData } from '@/modules/source-catalog/actions';
import { getSourceDetailDrawerDataAction } from '@/modules/source-catalog/actions';
import {
  isManualSignalOnly as checkIsManualSignalOnly,
  shouldSkipGenericConnectionPanels,
} from '@/modules/source-catalog/connection-panel-guards';
import { SourceCredentialPanel } from './[sourceKey]/source-credential-panel';
import { TestConnectionPanel } from './[sourceKey]/test-connection-panel';
import { ConnectionTestHistory } from './[sourceKey]/connection-test-history';
import { SourceDryRunPanel } from './[sourceKey]/source-dry-run-panel';
import { DenuePreviewBatchPanel } from './[sourceKey]/denue-preview-batch-panel';
import { ChileResDryRunPanel } from './[sourceKey]/chile-res-dry-run-panel';
import { HnContratacionesAbiertasCard } from '@/components/source-catalog/hn-contrataciones-abiertas-card';
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
  const [drawerData, setDrawerData] = React.useState<SourceDetailDrawerData | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && source) {
      setLoading(true);
      setDrawerData(null);
      getSourceDetailDrawerDataAction(source.key).then((data) => {
        setDrawerData(data);
        setLoading(false);
      });
    } else {
      setDrawerData(null);
    }
  }, [open, source]);

  if (!source) {
    return (
      <DrawerShell
        open={open}
        onOpenChange={onOpenChange}
        side="right"
        className="!w-[90vw] !max-w-[90vw] sm:!max-w-[90vw]"
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
  const isDenue = source.key === 'mx_denue';
  const isClRes = source.key === 'cl_res';
  const isHnContrataciones = source.key === 'hn_contrataciones_abiertas';
  const isManualSignalOnly = checkIsManualSignalOnly(source);
  const skipConnectionPanels = shouldSkipGenericConnectionPanels(source);
  const batchesCount = socrataBatches.batches.length;

  const infoContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={statusClass}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {statusLabel}
        </Badge>
        <Badge variant="neutral">
          {PRIORITY_LABELS[source.priority]}
        </Badge>
        <Badge variant="neutral">
          {TYPE_LABELS[source.type]}
        </Badge>
        <Badge variant="neutral">
          Automatización: {AUTOMATION_LEVEL_LABELS[source.automationLevel]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={sellupUseBadgeClass(source.sellupUse)}>
          {SELLUP_USE_LABELS[source.sellupUse]}
        </Badge>
        <Badge variant="outline" className={aiFlowStatusBadgeClass(source.aiFlowStatus)}>
          {AI_FLOW_STATUS_LABELS[source.aiFlowStatus]}
        </Badge>
        <Badge variant="outline" className={connectionModeBadgeClass(source.connectionMode)}>
          {CONNECTION_MODE_LABELS[source.connectionMode]}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DrawerSection title="Información general" icon={Info} tone="brand">
          {/* Design Refresh v6: filas horizontales (label izquierda / valor a la
              derecha) consistentes con los drawers de Empresa y Contacto. */}
          <dl className="divide-y divide-border/50 text-sm">
            <SourceInfoRow label="Key">
              <span className="font-mono break-all">{source.key}</span>
            </SourceInfoRow>
            <SourceInfoRow label="País">{countryLabels}</SourceInfoRow>
            <SourceInfoRow label="Uso en SellUp">
              <Badge variant="outline" className={sellupUseBadgeClass(source.sellupUse)}>
                {SELLUP_USE_LABELS[source.sellupUse]}
              </Badge>
            </SourceInfoRow>
            <SourceInfoRow label="Estado flujo IA">
              <Badge variant="outline" className={aiFlowStatusBadgeClass(source.aiFlowStatus)}>
                {AI_FLOW_STATUS_LABELS[source.aiFlowStatus]}
              </Badge>
            </SourceInfoRow>
            <SourceInfoRow label="Conexión">
              <Badge variant="outline" className={connectionModeBadgeClass(source.connectionMode)}>
                {CONNECTION_MODE_LABELS[source.connectionMode]}
              </Badge>
            </SourceInfoRow>
            <SourceInfoRow label="Siguiente acción">{source.nextAction}</SourceInfoRow>
            {source.sectors.length > 0 && (
              <SourceInfoRow label="Sectores">{source.sectors.join(', ')}</SourceInfoRow>
            )}
            {source.url && (
              <SourceInfoRow label="URL">
                <Link href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                  {source.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </Link>
              </SourceInfoRow>
            )}
          </dl>
        </DrawerSection>

        <DrawerSection title="Uso recomendado" icon={Lightbulb} tone="brand">
          <p className="text-sm text-muted-foreground leading-relaxed">{source.recommendedUse}</p>
        </DrawerSection>

        {source.limitations.length > 0 && (
          <DrawerSection title="Limitaciones" icon={CircleSlash} tone="neutral">
            <ul className="space-y-2">
              {source.limitations.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}

        {source.riskNotes.length > 0 && (
          <DrawerSection title="Notas de riesgo" icon={AlertTriangle} tone="warning">
            <ul className="space-y-2">
              {source.riskNotes.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-warning">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  {item}
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}
      </div>

      {loading || !drawerData ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {isManualSignalOnly ? (
            <DrawerSection title="Estado de integración" icon={Plug} tone="neutral">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Esta fuente se conserva como referencia manual. No existe una integración automática aprobada para SellUp.
              </p>
            </DrawerSection>
          ) : isHnContrataciones ? (
            <DrawerSection title="Acceso técnico" icon={KeyRound} tone="positive">
              <dl className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-muted-foreground">Credenciales:</dt>
                  <dd>
                    <Badge variant="positive">No requeridas</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Publisher institucional
                  </dt>
                  <dd className="text-foreground">ONCAE Honduras</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Feed técnico consumido por SellUp
                  </dt>
                  <dd className="text-foreground">OCP Data Registry · publicación Honduras ONCAE</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Formato
                  </dt>
                  <dd className="text-foreground">JSONL.gz / OCDS</dd>
                </div>
              </dl>
            </DrawerSection>
          ) : drawerData.connectionRecord ? (
            <SourceCredentialPanel
              sourceKey={source.key}
              record={drawerData.connectionRecord}
              isAdmin={drawerData.isAdmin}
            />
          ) : source.type === 'public_dataset' || source.key === 'co_rues' || (source.operationalStatus === 'operational_verified' && !source.url?.includes('api')) ? (
            <DrawerSection title="Credencial de API" icon={KeyRound} tone="neutral">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Requiere credencial:</span>
                  <Badge variant="neutral">No requiere credencial</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Esta fuente es de acceso público. La prueba de conexión valida que la API responde correctamente.
                  No crea candidatos ni sincroniza datos.
                </p>
              </div>
            </DrawerSection>
          ) : (
            <DrawerSection title="Credencial de API" icon={KeyRound} tone="neutral">
              <p className="text-sm text-muted-foreground">
                Esta fuente aún no tiene configuración de credencial registrada en el sistema.
              </p>
            </DrawerSection>
          )}

          {isDenue && drawerData.connectionRecord && (
            <SourceDryRunPanel
              sourceKey={drawerData.connectionRecord.source_key ?? 'denue_mexico'}
              hasStoredCredential={drawerData.connectionRecord.credentials_status === 'stored'}
              isAdmin={drawerData.isAdmin}
            />
          )}

          {isClRes && (
            <ChileResDryRunPanel isAdmin={drawerData.isAdmin} />
          )}

          {isDenue && drawerData.connectionRecord && (
            <DenuePreviewBatchPanel
              hasStoredCredential={drawerData.connectionRecord.credentials_status === 'stored'}
              isAdmin={drawerData.isAdmin}
            />
          )}

          {isHnContrataciones && (
            <HnContratacionesAbiertasCard coverage={drawerData.hnCoverage} />
          )}

          {!skipConnectionPanels && (
            <TestConnectionPanel sourceKey={source.key} sourceName={source.name} />
          )}

          {!skipConnectionPanels && (
            <ConnectionTestHistory history={drawerData.testHistory} />
          )}

          {isRues && (
            <DrawerSection
              title="Lotes Socrata"
              icon={Database}
              tone="neutral"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/source-catalog/socrata-batches">Ver lotes Socrata</Link>
                </Button>
              }
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Revisión interna de lotes creados desde esta fuente. Solo lectura — no aprueba ni sincroniza candidatos.
              </p>
            </DrawerSection>
          )}
        </>
      )}
    </div>
  );

  const batchesBody = (
    <DrawerSection
      title="Lotes Socrata"
      hint="Revisión interna de lotes creados desde RUES. Solo lectura."
      icon={Layers}
      tone="neutral"
      contentClassName="space-y-3"
    >
      <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Solo lectura para candidatos.</span>{' '}
          No permite editar, aprobar, descartar ni sincronizar.
        </p>
      </div>

      {batchesCount === 0 ? (
        <EmptyState variant="plain" icon={Database} title="Aún no hay lotes Socrata creados." />
      ) : (
        <SocrataBatchesTable batches={socrataBatches.batches} />
      )}
    </DrawerSection>
  );

  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      className="!w-[90vw] !max-w-[90vw] sm:!max-w-[90vw]"
      title={source.name}
      description={source.key}
      icon={
        <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
      }
      actions={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <CopyKeyInline sourceKey={source.key} />
          <div className="flex flex-wrap items-center gap-2">
            {source.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" />
                  Abrir URL
                </a>
              </Button>
            )}
            <Button variant="default" size="sm" asChild>
              <Link href={`/settings/source-catalog/${source.key}`}>
                Ver página completa
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      }
    >
      {isRues ? (
        <Tabs defaultValue="info" className="w-full">
          <TabsList variant="segmented" className="mb-2">
            <TabsTrigger value="info"><Info className="h-4 w-4" /> Información</TabsTrigger>
            <TabsTrigger value="batches">
              <Layers className="h-4 w-4" /> Lotes
              {batchesCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/60 bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                  {batchesCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="info">{infoContent}</TabsContent>
          <TabsContent value="batches">{batchesBody}</TabsContent>
        </Tabs>
      ) : (
        infoContent
      )}
    </DrawerShell>
  );
}

function SocrataBatchesTable({ batches }: { batches: SocrataPreviewBatchListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 text-left">
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Nombre</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Dataset</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Candidatos</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Flags</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {batches.map((batch) => (
            <tr key={batch.id} className="transition-colors hover:bg-surface-muted">
              <td className="px-3 py-3">
                <span className="font-medium text-foreground">{batch.name}</span>
                {batch.countryCode && (
                  <span className="ml-2 text-xs text-muted-foreground">{batch.countryCode}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <Badge variant="outline" className={batchStatusBadgeClass(batch.status)}>
                  {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                </Badge>
              </td>
              <td className="px-3 py-3">
                <span className="font-mono text-xs text-muted-foreground">{formatDatasetLabel(batch.dataset)}</span>
              </td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">
                {batch.candidatesCount}
                {batch.targetCount ? (
                  <span className="ml-1 text-xs text-muted-foreground">/ {batch.targetCount}</span>
                ) : null}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {batch.previewMode && (
                    <Badge variant="brand">Preview</Badge>
                  )}
                  {batch.smokeTest && (
                    <Badge variant="info">Smoke</Badge>
                  )}
                  {batch.rollbackLogical && (
                    <Badge variant="neutral">Rollback</Badge>
                  )}
                  {!batch.previewMode && !batch.smokeTest && !batch.rollbackLogical && (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{formatShortDate(batch.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Design Refresh v6: fila horizontal label/valor para el drawer de fuente.
// Label fijo a la izquierda; valor alineado a la derecha (envuelve para textos
// largos como "Siguiente acción" o URL). Consistente con Empresa y Contacto.
function SourceInfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="w-28 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-right text-foreground">{children}</dd>
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
    <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
      {copied ? (
        <Check aria-hidden="true" className="text-success" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {copied ? 'Copiado' : 'Copiar key'}
    </Button>
  );
}
