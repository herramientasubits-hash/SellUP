import { notFound } from 'next/navigation';
import {
  Building2,
  FlaskConical,
  Lock,
  RotateCcw,
  XCircle,
  Globe,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
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
              { label: 'Catálogo de fuentes', href: '/settings/source-catalog' },
              { label: 'Lotes de datos abiertos', href: '/settings/source-catalog/socrata-batches' },
              batch.name,
            ]}
          />
        }
        title={batch.name}
        description="Las empresas candidatas de este lote y de dónde salió cada dato. Solo consulta."
      />

      {/* Read-only notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Solo consulta.</span>{' '}
          Puedes revisar los candidatos y de dónde salió cada dato, pero desde aquí no se aprueban,
          no se convierten en empresas ni se envían a HubSpot.
        </p>
      </div>

      {/* Smoke test alert */}
      {batch.smokeTest && (
        <div className="rounded-xl border border-info/20 bg-info/10 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div>
              <p className="text-sm font-medium text-info">
                Lote de prueba
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Este lote se creó para probar la fuente. No corresponde a una prospección real.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rollback alert */}
      {batch.rollbackLogical && (
        <div className="rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <div className="flex items-start gap-2.5">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Lote revertido</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                El lote y sus candidatos fueron marcados como cancelados/descartados
                mediante rollback lógico. Los datos persisten para trazabilidad pero no son
                operativos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cancelled alert */}
      {batch.status === 'cancelled' && !batch.rollbackLogical && (
        <div className="rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <div className="flex items-start gap-2.5">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Este lote fue cancelado.</p>
          </div>
        </div>
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Estado
            </p>
            <Badge variant="outline" className={batchStatusBadgeClass(batch.status)}>
              {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
            </Badge>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              País
            </p>
            <p className="font-medium text-foreground">{batch.countryCode ?? '—'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Dataset
            </p>
            <p className="font-mono text-xs text-foreground">{formatDatasetLabel(batch.dataset)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Objetivo
            </p>
            <p className="tabular-nums text-foreground">{batch.targetCount ?? '—'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Candidatos cargados
            </p>
            <p className="tabular-nums text-foreground">{candidates.length}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Preview mode
            </p>
            <p className="text-foreground">{batch.previewMode ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Smoke test
            </p>
            <p className="text-foreground">{batch.smokeTest ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Rollback lógico
            </p>
            <p className="text-foreground">{batch.rollbackLogical ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Profundidad
            </p>
            <p className="text-foreground">{batch.searchDepth ?? '—'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Costo estimado lote
            </p>
            <p className="tabular-nums text-foreground">
              {batch.estimatedCostUsd != null ? `$${batch.estimatedCostUsd.toFixed(4)}` : '—'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Fecha creación
            </p>
            <p className="text-foreground">{formatShortDate(batch.createdAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Última actualización
            </p>
            <p className="text-foreground">{formatShortDate(batch.updatedAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              ID lote
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">{batch.id}</p>
          </div>
        </div>
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

      {/* Warnings panel — only when candidates have warnings */}
      {candidates.some((c) => c.warnings.length > 0) && (
        <SurfaceCard>
          <SurfaceCardHeader title="Advertencias de candidatos" className="mb-3" />
          <div className="space-y-2">
            {candidates
              .filter((c) => c.warnings.length > 0)
              .map((c) => (
                <div key={c.id} className="rounded-lg bg-warning/15 px-3 py-2 text-xs leading-relaxed">
                  <span className="font-medium text-foreground">{c.name ?? c.id}:</span>{' '}
                  <span className="text-muted-foreground">{c.warnings.join(' · ')}</span>
                </div>
              ))}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
