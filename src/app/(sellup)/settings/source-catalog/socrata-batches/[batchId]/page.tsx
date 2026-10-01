import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  FlaskConical,
  Lock,
  RotateCcw,
  XCircle,
  Globe,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
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
        <span
          key={flag}
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${reviewFlagBadgeClass(flag)}`}
        >
          {REVIEW_FLAG_LABELS[flag] ?? flag}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full border border-border/60 bg-surface-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
          +{overflow}
        </span>
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
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${employeeCountStatusBadgeClass('unknown_requires_manual_validation')}`}
        >
          {EMPLOYEE_COUNT_STATUS_LABELS['unknown_requires_manual_validation']}
        </span>
        <p className="mt-0.5 text-xs text-muted-foreground">Validar manualmente</p>
      </div>
    );
  }
  if (employeeCount !== null) {
    return (
      <div>
        <span className="tabular-nums text-foreground">{employeeCount}</span>
        {employeeCountStatus && (
          <span
            className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${employeeCountStatusBadgeClass(employeeCountStatus)}`}
          >
            {EMPLOYEE_COUNT_STATUS_LABELS[employeeCountStatus] ?? employeeCountStatus}
          </span>
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
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${hubspotMatchStatusBadgeClass(s)}`}
    >
      {HUBSPOT_MATCH_STATUS_LABELS[s] ?? s}
    </span>
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
        <div className="truncate max-w-[120px] text-muted-foreground">
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
      {/* Breadcrumb */}
      <Link
        href="/settings/source-catalog/socrata-batches"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Lotes Socrata
      </Link>

      <PageHeader
        title={batch.name}
        description="Revisión interna de lote estructurado Socrata. Vista de solo lectura."
      />

      {/* Read-only notice */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-surface-subtle px-5 py-3.5">
        <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Modo revisión estructurada.</span>{' '}
          Puedes consultar los candidatos y su trazabilidad, pero no aprobarlos, convertirlos
          ni sincronizarlos con HubSpot desde esta vista.
        </p>
      </div>

      {/* Smoke test alert */}
      {batch.smokeTest && (
        <div className="rounded-xl border border-info/30 bg-info/5 px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div>
              <p className="text-sm font-medium text-info">
                Lote de smoke test
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Este lote fue creado durante una prueba controlada del pipeline Socrata y no
                corresponde a una operación de prospección real.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rollback alert */}
      {batch.rollbackLogical && (
        <div className="rounded-xl border border-border/50 bg-surface-subtle px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Rollback lógico aplicado</p>
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
        <div className="rounded-xl border border-border/50 bg-surface-subtle px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Este lote fue cancelado.</p>
          </div>
        </div>
      )}

      {/* Candidate summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total candidatos', value: batch.summary.total, cls: 'text-foreground' },
          {
            label: 'Necesitan revisión',
            value: batch.summary.needsReview,
            cls: 'text-warning',
          },
          {
            label: 'Descartados',
            value: batch.summary.discarded,
            cls: 'text-muted-foreground',
          },
          {
            label: 'Rechazados',
            value: batch.summary.rejected,
            cls: 'text-destructive',
          },
          {
            label: 'Convertidos',
            value: batch.summary.converted,
            cls: 'text-primary',
          },
          {
            label: 'Costo estimado',
            value:
              batch.summary.totalCostUsd > 0
                ? `$${batch.summary.totalCostUsd.toFixed(4)}`
                : '—',
            cls: 'text-muted-foreground',
          },
        ].map((card) => (
          <SurfaceCard key={card.label} className="py-3.5">
            <p className="text-xs font-semibold text-muted-foreground">
              {card.label}
            </p>
            <p className={`mt-1.5 text-xl font-semibold tabular-nums ${card.cls}`}>
              {card.value}
            </p>
          </SurfaceCard>
        ))}
      </div>

      {/* Batch summary */}
      <SurfaceCard>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Estado
            </p>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${batchStatusBadgeClass(batch.status)}`}
            >
              {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              País
            </p>
            <p className="font-medium text-foreground">{batch.countryCode ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Dataset
            </p>
            <p className="font-mono text-xs text-foreground">{formatDatasetLabel(batch.dataset)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Objetivo
            </p>
            <p className="tabular-nums text-foreground">{batch.targetCount ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Candidatos cargados
            </p>
            <p className="tabular-nums text-foreground">{candidates.length}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Preview mode
            </p>
            <p className="text-foreground">{batch.previewMode ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Smoke test
            </p>
            <p className="text-foreground">{batch.smokeTest ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Rollback lógico
            </p>
            <p className="text-foreground">{batch.rollbackLogical ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Profundidad
            </p>
            <p className="text-foreground">{batch.searchDepth ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Costo estimado lote
            </p>
            <p className="tabular-nums text-foreground">
              {batch.estimatedCostUsd != null ? `$${batch.estimatedCostUsd.toFixed(4)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Fecha creación
            </p>
            <p className="text-foreground">{formatShortDate(batch.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Última actualización
            </p>
            <p className="text-foreground">{formatShortDate(batch.updatedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              ID lote
            </p>
            <p className="font-mono text-xs text-muted-foreground">{batch.id}</p>
          </div>
        </div>
      </SurfaceCard>

      {/* Candidates table */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/60 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {candidates.length === 0
              ? 'Sin candidatos en este lote'
              : `${candidates.length} candidato${candidates.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Building2 className="h-8 w-8 text-text-muted" />
            <p className="text-sm text-muted-foreground">Sin candidatos en este lote.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-muted-foreground">
                    Empresa
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    NIT
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Ciudad / Dpto.
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Sector
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Tamaño
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    HubSpot
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Estado revisión
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Duplicado
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Flags
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Fuente
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {candidates.map((candidate) => (
                  <tr key={candidate.id} className="transition-colors hover:bg-surface-muted">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground">
                        {candidate.name ?? <span className="text-text-muted">—</span>}
                      </p>
                      {candidate.website && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" />
                          <span className="truncate max-w-[140px]">{candidate.domain ?? candidate.website}</span>
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${candidateStatusBadgeClass(candidate.status)}`}
                        >
                          {CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status}
                        </span>
                        {candidate.isConverted && (
                          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                            Convertido
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                      {candidate.taxId ?? <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      <div>{candidate.city ?? '—'}</div>
                      {candidate.department && (
                        <div className="text-muted-foreground">{candidate.department}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {candidate.sectorDescription ?? candidate.sectorCode ?? (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <SizeCell candidate={candidate} />
                    </td>
                    <td className="px-4 py-3.5">
                      <HubSpotCell status={candidate.hubspotMatchStatus} />
                    </td>
                    <td className="px-4 py-3.5">
                      {candidate.reviewStatus ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${reviewStatusBadgeClass(candidate.reviewStatus)}`}
                        >
                          {REVIEW_STATUS_LABELS[candidate.reviewStatus] ?? candidate.reviewStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {candidate.duplicateStatus ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${duplicateStatusBadgeClass(candidate.duplicateStatus)}`}
                        >
                          {DUPLICATE_STATUS_LABELS[candidate.duplicateStatus] ?? candidate.duplicateStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <FlagChips flags={candidate.reviewFlags} />
                    </td>
                    <td className="px-4 py-3.5">
                      <SourceCell candidate={candidate} batchDataset={batch.dataset} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* Warnings panel — only when candidates have warnings */}
      {candidates.some((c) => c.warnings.length > 0) && (
        <SurfaceCard>
          <p className="mb-3 text-sm font-semibold text-foreground">
            Advertencias de candidatos
          </p>
          <div className="space-y-2">
            {candidates
              .filter((c) => c.warnings.length > 0)
              .map((c) => (
                <div key={c.id} className="text-xs">
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
