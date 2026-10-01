import { notFound } from 'next/navigation';
import { Building2, Globe } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { TableShell } from '@/components/data-display';
import { getSocrataPreviewBatchDetail } from '@/modules/source-catalog/socrata-batches-queries';
import type { SocrataPreviewCandidateItem } from '@/modules/source-catalog/socrata-batches-queries';
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  CANDIDATE_STATUS_LABELS,
  candidateStatusBadgeClass,
  REVIEW_STATUS_LABELS,
  reviewStatusBadgeClass,
  DUPLICATE_STATUS_LABELS,
  duplicateStatusBadgeClass,
  EMPLOYEE_COUNT_STATUS_LABELS,
  employeeCountStatusBadgeClass,
  HUBSPOT_MATCH_STATUS_LABELS,
  hubspotMatchStatusBadgeClass,
  REVIEW_FLAG_LABELS,
  reviewFlagBadgeClass,
  formatDatasetLabel,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Props {
  params: Promise<{ batchId: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { batchId } = await params;
  return { title: `Lote Socrata ${batchId.slice(0, 8)}… — Catálogo de fuentes` };
}

// ─── Flag chips (max 3 + overflow) ────────────────────────────────────────────

function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-xs text-text-muted">—</span>;
  const visible = flags.slice(0, 3);
  const overflow = flags.length - 3;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((flag) => (
        <Badge key={flag} variant="outline" className={reviewFlagBadgeClass(flag)}>
          {REVIEW_FLAG_LABELS[flag] ?? flag}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="neutral" className="tabular-nums">+{overflow}</Badge>
      )}
    </div>
  );
}

// ─── Size cell ────────────────────────────────────────────────────────────────

function SizeCell({ candidate }: { candidate: SocrataPreviewCandidateItem }) {
  const { employeeCount, employeeCountStatus } = candidate;
  if (employeeCountStatus === 'unknown_requires_manual_validation') {
    return (
      <div>
        <Badge variant="outline" className={employeeCountStatusBadgeClass('unknown_requires_manual_validation')}>
          {EMPLOYEE_COUNT_STATUS_LABELS['unknown_requires_manual_validation']}
        </Badge>
        <p className="mt-0.5 text-xs text-muted-foreground">Validar manualmente</p>
      </div>
    );
  }
  if (employeeCount !== null) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums text-foreground">{employeeCount}</span>
        {employeeCountStatus && (
          <Badge variant="outline" className={employeeCountStatusBadgeClass(employeeCountStatus)}>
            {EMPLOYEE_COUNT_STATUS_LABELS[employeeCountStatus] ?? employeeCountStatus}
          </Badge>
        )}
      </div>
    );
  }
  return <span className="text-xs text-text-muted">—</span>;
}

// ─── HubSpot cell ─────────────────────────────────────────────────────────────

function HubSpotCell({ status }: { status: string | null }) {
  const s = status ?? 'not_attempted';
  return (
    <Badge variant="outline" className={hubspotMatchStatusBadgeClass(s)}>
      {HUBSPOT_MATCH_STATUS_LABELS[s] ?? s}
    </Badge>
  );
}

// ─── Source cell ──────────────────────────────────────────────────────────────

function SourceCell({
  candidate,
  batchDataset,
}: {
  candidate: SocrataPreviewCandidateItem;
  batchDataset: string | null;
}) {
  const { datasetId, sourceKey, sourceRecordId } = candidate;
  const datasetLabel = formatDatasetLabel(datasetId ?? batchDataset);
  const hasTrace = sourceKey || datasetId;
  return (
    <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
      <div className="font-medium text-foreground">Socrata / {datasetLabel}</div>
      {hasTrace && (
        <div className="text-muted-foreground">
          {[sourceKey, datasetId].filter(Boolean).join(' · ')}
        </div>
      )}
      {sourceRecordId && (
        <div className="max-w-32 truncate text-muted-foreground">
          record: {sourceRecordId}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SocrataBatchDetailPage({ params }: Props) {
  const { batchId } = await params;
  const batch = await getSocrataPreviewBatchDetail(batchId);
  if (!batch) notFound();

  const candidates = batch.candidates;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Catálogo de fuentes', href: '/source-catalog' },
              { label: 'Lotes de datos abiertos', href: '/source-catalog/socrata-batches' },
              batch.name,
            ]}
          />
        }
        title={batch.name}
        description="Las empresas candidatas de este lote y de dónde salió cada dato. Solo consulta."
      />

      {/* Qué es este lote y qué no se puede hacer desde aquí */}
      <Alert variant="info">
        <AlertTitle>Solo consulta</AlertTitle>
        <AlertDescription className="text-xs">
          Puedes revisar los candidatos y de dónde salió cada dato, pero desde aquí no se aprueban,
          no se convierten en empresas ni se envían a HubSpot.
        </AlertDescription>
      </Alert>

      {batch.smokeTest && (
        <Alert variant="info">
          <AlertTitle>Lote de prueba</AlertTitle>
          <AlertDescription className="text-xs">
            Este lote se creó para probar la fuente. No corresponde a una prospección real.
          </AlertDescription>
        </Alert>
      )}

      {batch.rollbackLogical && (
        <Alert variant="warning">
          <AlertTitle>Lote revertido</AlertTitle>
          <AlertDescription className="text-xs">
            El lote y sus candidatos fueron marcados como cancelados/descartados
            mediante rollback lógico. Los datos persisten para trazabilidad pero no son
            operativos.
          </AlertDescription>
        </Alert>
      )}

      {batch.status === 'cancelled' && !batch.rollbackLogical && (
        <Alert variant="warning">Este lote fue cancelado.</Alert>
      )}

      {/* Candidate summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Total candidatos', value: batch.summary.total, tone: 'brand' as const },
          {
            label: 'Necesitan revisión',
            value: batch.summary.needsReview,
            tone: 'warning' as const,
          },
          {
            label: 'Descartados',
            value: batch.summary.discarded,
            tone: 'neutral' as const,
          },
          {
            label: 'Rechazados',
            value: batch.summary.rejected,
            tone: 'negative' as const,
          },
          {
            label: 'Convertidos',
            value: batch.summary.converted,
            tone: 'brand' as const,
          },
          {
            label: 'Costo estimado',
            value:
              batch.summary.totalCostUsd > 0
                ? `$${batch.summary.totalCostUsd.toFixed(4)}`
                : '—',
            tone: 'neutral' as const,
          },
        ].map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            value={card.value}
            tone={card.tone}
            compact
          />
        ))}
      </div>

      {/* Batch summary */}
      <SurfaceCard>
        <SurfaceCardHeader title="Datos del lote" />
        <DetailList columns={4}>
          <DetailItem label="Estado">
            <Badge variant="outline" className={batchStatusBadgeClass(batch.status)}>
              {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
            </Badge>
          </DetailItem>
          <DetailItem label="País">{batch.countryCode}</DetailItem>
          <DetailItem label="Dataset">
            <span className="font-mono text-xs">{formatDatasetLabel(batch.dataset)}</span>
          </DetailItem>
          <DetailItem label="Objetivo">
            {batch.targetCount != null ? <span className="tabular-nums">{batch.targetCount}</span> : null}
          </DetailItem>
          <DetailItem label="Candidatos cargados">
            <span className="tabular-nums">{candidates.length}</span>
          </DetailItem>
          <DetailItem label="Preview mode">{batch.previewMode ? 'Sí' : 'No'}</DetailItem>
          <DetailItem label="Smoke test">{batch.smokeTest ? 'Sí' : 'No'}</DetailItem>
          <DetailItem label="Rollback lógico">{batch.rollbackLogical ? 'Sí' : 'No'}</DetailItem>
          <DetailItem label="Profundidad">{batch.searchDepth}</DetailItem>
          <DetailItem label="Costo estimado lote">
            {batch.estimatedCostUsd != null ? (
              <span className="tabular-nums">{`$${batch.estimatedCostUsd.toFixed(4)}`}</span>
            ) : null}
          </DetailItem>
          <DetailItem label="Fecha creación">{formatShortDate(batch.createdAt)}</DetailItem>
          <DetailItem label="Última actualización">{formatShortDate(batch.updatedAt)}</DetailItem>
          <DetailItem label="ID lote">
            <span className="break-all font-mono text-xs text-muted-foreground">{batch.id}</span>
          </DetailItem>
        </DetailList>
      </SurfaceCard>

      {/* Candidates table */}
      <TableShell
        title={
          <>
            Candidatos
            <Badge variant="neutral" className="tabular-nums">
              {candidates.length} candidato{candidates.length !== 1 ? 's' : ''}
            </Badge>
          </>
        }
        empty={candidates.length === 0}
        emptyState={
          <EmptyState
            variant="plain"
            icon={Building2}
            title="Este lote no trajo candidatos"
            description="Crea otro lote de prueba desde la lista de lotes para volver a intentarlo."
          />
        }
      >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    Empresa
                  </TableHead>
                  <TableHead scope="col">
                    NIT
                  </TableHead>
                  <TableHead scope="col">
                    Ciudad / Dpto.
                  </TableHead>
                  <TableHead scope="col">
                    Sector
                  </TableHead>
                  <TableHead scope="col">
                    Tamaño
                  </TableHead>
                  <TableHead scope="col">
                    HubSpot
                  </TableHead>
                  <TableHead scope="col">
                    Revisión
                  </TableHead>
                  <TableHead scope="col">
                    Duplicado
                  </TableHead>
                  <TableHead scope="col">
                    Avisos
                  </TableHead>
                  <TableHead scope="col">
                    Fuente
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((candidate) => (
                  <TableRow key={candidate.id} className="[&>td]:align-top">
                    <TableCell className="whitespace-normal">
                      <p className="font-medium text-foreground">
                        {candidate.name ?? <span className="text-text-muted">—</span>}
                      </p>
                      {candidate.website && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" />
                          <span className="max-w-36 truncate" title={candidate.domain ?? candidate.website ?? undefined}>{candidate.domain ?? candidate.website}</span>
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className={candidateStatusBadgeClass(candidate.status)}>
                          {CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status}
                        </Badge>
                        {candidate.isConverted && (
                          <Badge variant="brand">Convertido</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {candidate.taxId ?? <span className="text-text-muted">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{candidate.city ?? '—'}</div>
                      {candidate.department && (
                        <div className="text-muted-foreground">{candidate.department}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">
                      {candidate.sectorDescription ?? candidate.sectorCode ?? (
                        <span className="text-text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SizeCell candidate={candidate} />
                    </TableCell>
                    <TableCell>
                      <HubSpotCell status={candidate.hubspotMatchStatus} />
                    </TableCell>
                    <TableCell>
                      {candidate.reviewStatus ? (
                        <Badge variant="outline" className={reviewStatusBadgeClass(candidate.reviewStatus)}>
                          {REVIEW_STATUS_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {candidate.duplicateStatus ? (
                        <Badge variant="outline" className={duplicateStatusBadgeClass(candidate.duplicateStatus)}>
                          {DUPLICATE_STATUS_LABELS[candidate.duplicateStatus] ?? candidate.duplicateStatus}
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <FlagChips flags={candidate.reviewFlags} />
                    </TableCell>
                    <TableCell>
                      <SourceCell candidate={candidate} batchDataset={batch.dataset} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </TableShell>

      {/* Advertencias — solo cuando algún candidato las trae */}
      {candidates.some((c) => c.warnings.length > 0) && (
        <Alert variant="warning">
          <AlertTitle>Advertencias de candidatos</AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="space-y-1">
              {candidates
                .filter((c) => c.warnings.length > 0)
                .map((c) => (
                  <li key={c.id} className="leading-relaxed">
                    <span className="font-medium text-foreground">{c.name ?? c.id}:</span>{' '}
                    {c.warnings.join(' · ')}
                  </li>
                ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
