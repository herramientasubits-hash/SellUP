'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Copy, Check, Database, ExternalLink, Layers, Lock, Info, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard } from '@/components/shared/surface-card';
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {statusLabel}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/60 bg-surface-subtle px-3 py-1 text-xs font-medium text-muted-foreground">
          {PRIORITY_LABELS[source.priority]}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/60 bg-surface-subtle px-3 py-1 text-xs font-medium text-muted-foreground">
          {TYPE_LABELS[source.type]}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/60 bg-surface-subtle px-3 py-1 text-xs font-medium text-muted-foreground">
          Automatización: {AUTOMATION_LEVEL_LABELS[source.automationLevel]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${sellupUseBadgeClass(source.sellupUse)}`}>
          {SELLUP_USE_LABELS[source.sellupUse]}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${aiFlowStatusBadgeClass(source.aiFlowStatus)}`}>
          {AI_FLOW_STATUS_LABELS[source.aiFlowStatus]}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${connectionModeBadgeClass(source.connectionMode)}`}>
          {CONNECTION_MODE_LABELS[source.connectionMode]}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SurfaceCard>
          <h2 className="text-sm font-semibold text-foreground mb-4">Información general</h2>
          {/* Design Refresh v6: filas horizontales (label izquierda / valor a la
              derecha) consistentes con los drawers de Empresa y Contacto. */}
          <dl className="space-y-2.5 text-sm">
            <SourceInfoRow label="Key">
              <span className="font-mono break-all">{source.key}</span>
            </SourceInfoRow>
            <SourceInfoRow label="País">{countryLabels}</SourceInfoRow>
            <SourceInfoRow label="Uso en SellUp">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${sellupUseBadgeClass(source.sellupUse)}`}>
                {SELLUP_USE_LABELS[source.sellupUse]}
              </span>
            </SourceInfoRow>
            <SourceInfoRow label="Estado flujo IA">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${aiFlowStatusBadgeClass(source.aiFlowStatus)}`}>
                {AI_FLOW_STATUS_LABELS[source.aiFlowStatus]}
              </span>
            </SourceInfoRow>
            <SourceInfoRow label="Conexión">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${connectionModeBadgeClass(source.connectionMode)}`}>
                {CONNECTION_MODE_LABELS[source.connectionMode]}
              </span>
            </SourceInfoRow>
            <SourceInfoRow label="Siguiente acción">{source.nextAction}</SourceInfoRow>
            {source.sectors.length > 0 && (
              <SourceInfoRow label="Sectores">{source.sectors.join(', ')}</SourceInfoRow>
            )}
            {source.url && (
              <SourceInfoRow label="URL">
                <Link href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                  {source.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </Link>
              </SourceInfoRow>
            )}
          </dl>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="text-sm font-semibold text-foreground mb-4">Uso recomendado</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{source.recommendedUse}</p>
        </SurfaceCard>

        {source.limitations.length > 0 && (
          <SurfaceCard>
            <h2 className="text-sm font-semibold text-foreground mb-4">Limitaciones</h2>
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
            <h2 className="text-sm font-semibold text-foreground mb-4">Notas de riesgo</h2>
            <ul className="space-y-2">
              {source.riskNotes.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-warning">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning/60" />
                  {item}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        )}
      </div>

      {loading || !drawerData ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {isManualSignalOnly ? (
            <SurfaceCard>
              <h2 className="text-sm font-semibold text-foreground mb-2">Estado de integración</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Esta fuente se conserva como referencia manual. No existe una integración automática aprobada para SellUp.
              </p>
            </SurfaceCard>
          ) : isHnContrataciones ? (
            <SurfaceCard>
              <h2 className="text-sm font-semibold text-foreground mb-2">Acceso técnico</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">Credenciales:</dt>
                  <dd>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                      No requeridas
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground mb-0.5">
                    Publisher institucional
                  </dt>
                  <dd className="text-foreground">ONCAE Honduras</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground mb-0.5">
                    Feed técnico consumido por SellUp
                  </dt>
                  <dd className="text-foreground">OCP Data Registry · publicación Honduras ONCAE</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground mb-0.5">
                    Formato
                  </dt>
                  <dd className="text-foreground">JSONL.gz / OCDS</dd>
                </div>
              </dl>
            </SurfaceCard>
          ) : drawerData.connectionRecord ? (
            <SourceCredentialPanel
              sourceKey={source.key}
              record={drawerData.connectionRecord}
              isAdmin={drawerData.isAdmin}
            />
          ) : source.type === 'public_dataset' || source.key === 'co_rues' || (source.operationalStatus === 'operational_verified' && !source.url?.includes('api')) ? (
            <SurfaceCard>
              <h2 className="text-sm font-semibold text-foreground mb-2">Credencial de API</h2>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Requiere credencial:</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    No requiere credencial
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Esta fuente es de acceso público. La prueba de conexión valida que la API responde correctamente.
                  No crea candidatos ni sincroniza datos.
                </p>
              </div>
            </SurfaceCard>
          ) : (
            <SurfaceCard>
              <h2 className="text-sm font-semibold text-foreground mb-2">Credencial de API</h2>
              <p className="text-sm text-muted-foreground">
                Esta fuente aún no tiene configuración de credencial registrada en el sistema.
              </p>
            </SurfaceCard>
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
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface-subtle px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Lotes Socrata</p>
                  <p className="text-xs text-muted-foreground">
                    Revisión interna de lotes creados desde esta fuente. Solo lectura — no aprueba ni sincroniza candidatos.
                  </p>
                </div>
              </div>
              <Link
                href="/settings/source-catalog/socrata-batches"
                className="shrink-0 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors"
              >
                Ver lotes Socrata
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );

  const batchesBody = (
    <div className="space-y-4">
      <SurfaceCard>
        <div className="flex items-center gap-2.5 mb-2">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Lotes Socrata</p>
            <p className="text-xs text-muted-foreground">Revisión interna de lotes creados desde RUES. Solo lectura.</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-border/60 bg-surface-subtle">
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Solo lectura para candidatos.</span>{' '}
            No permite editar, aprobar, descartar ni sincronizar.
          </p>
        </div>

        {batchesCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Database className="h-7 w-7 text-text-muted" />
            <p className="text-sm text-muted-foreground">Aún no hay lotes Socrata creados.</p>
          </div>
        ) : (
          <SocrataBatchesTable batches={socrataBatches.batches} />
        )}
      </SurfaceCard>
    </div>
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
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
      }
      actions={
        <div className="flex items-center justify-between gap-3 w-full">
          <CopyKeyInline sourceKey={source.key} />
          <div className="flex items-center gap-2">
            {source.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir URL
                </a>
              </Button>
            )}
            <Button variant="default" size="sm" asChild>
              <Link href={`/settings/source-catalog/${source.key}`}>
                Ver página completa
                <ExternalLink className="h-3.5 w-3.5 ml-1" />
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
          <tr className="border-b border-border/60 text-left">
            <th className="px-5 py-2.5 text-xs font-semibold text-muted-foreground">Nombre</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Dataset</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Candidatos</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Flags</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {batches.map((batch) => (
            <tr key={batch.id} className="transition-colors hover:bg-surface-muted">
              <td className="px-5 py-3">
                <span className="font-medium text-foreground">{batch.name}</span>
                {batch.countryCode && (
                  <span className="ml-2 text-xs text-muted-foreground">{batch.countryCode}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${batchStatusBadgeClass(batch.status)}`}>
                  {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">{formatDatasetLabel(batch.dataset)}</span>
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">
                {batch.candidatesCount}
                {batch.targetCount ? (
                  <span className="ml-1 text-xs text-muted-foreground">/ {batch.targetCount}</span>
                ) : null}
              </td>
              <td className="px-4 py-3">
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
              <td className="px-4 py-3 text-xs text-muted-foreground">{formatShortDate(batch.createdAt)}</td>
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
    <div className="flex items-start gap-3">
      <dt className="shrink-0 min-w-[116px] pt-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right text-foreground">{children}</dd>
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copiado' : 'Copiar key'}
    </button>
  );
}
