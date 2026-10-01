'use client';

import * as React from 'react';
import { formatAppDateTime } from '@/lib/format-date';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Globe,
  Info,
  Key,
  MapPin,
  Settings2,
  ShieldAlert,
  XCircle,
} from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CollapsibleDrawerSection } from '@/components/shared/collapsible-drawer-section';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import {
  classifyRisk,
  sanitizeTextForChile,
  val,
  type SheetCandidateMetadata,
  type SheetValidationMetadata,
} from './candidate-detail-helpers';
import { Field, FieldGrid } from './candidate-detail-parts';

const RISK_SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface CandidateRisksSectionProps {
  risks: string[];
  isChileOfficialCandidate: boolean;
}

/** «Riesgos e incertidumbres», ordenados de más a menos grave. */
export function CandidateRisksSection({ risks, isChileOfficialCandidate }: CandidateRisksSectionProps) {
  const sortedRisks = React.useMemo(
    () =>
      [...risks].sort((a, b) => RISK_SEVERITY_ORDER[classifyRisk(a)] - RISK_SEVERITY_ORDER[classifyRisk(b)]),
    [risks],
  );
  const riskCounts = sortedRisks.reduce<Record<string, number>>((counts, risk) => {
    const severity = classifyRisk(risk);
    return { ...counts, [severity]: (counts[severity] ?? 0) + 1 };
  }, {});
  const riskSummary = (
    [
      ['critical', 'crítico', 'críticos'],
      ['high', 'alto', 'altos'],
      ['medium', 'medio', 'medios'],
      ['low', 'bajo', 'bajos'],
    ] as const
  )
    .filter(([severity]) => (riskCounts[severity] ?? 0) > 0)
    .map(
      ([severity, singular, plural]) =>
        `${riskCounts[severity]} ${riskCounts[severity] === 1 ? singular : plural}`,
    )
    .join(' · ');
  const hasSeriousRisk = (riskCounts.critical ?? 0) > 0 || (riskCounts.high ?? 0) > 0;

  if (sortedRisks.length === 0) return null;

  return (
    <CollapsibleDrawerSection
      title="Riesgos e incertidumbres"
      icon={ShieldAlert}
      tone={hasSeriousRisk ? 'negative' : 'warning'}
      badge={sortedRisks.length}
      summary={riskSummary}
      defaultOpen={hasSeriousRisk}
    >
      <ul className="divide-y divide-border/50">
        {sortedRisks.map((risk, i) => {
          const severity = classifyRisk(risk);
          const toneMap = {
            critical: 'text-destructive',
            high: 'text-warning',
            medium: 'text-warning',
            low: 'text-muted-foreground',
          };
          const badgeMap = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
          const badgeVariantMap = {
            critical: 'negative',
            high: 'warning',
            medium: 'warning',
            low: 'neutral',
          } as const;
          return (
            <li
              key={i}
              className="flex items-start justify-between gap-3 py-2.5 text-sm text-foreground first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 mt-0.5 ${toneMap[severity]}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words leading-relaxed">
                  {isChileOfficialCandidate ? sanitizeTextForChile(risk) : risk}
                </span>
              </div>
              <Badge variant={badgeVariantMap[severity]} className="shrink-0 select-none">
                {badgeMap[severity]}
              </Badge>
            </li>
          );
        })}
      </ul>
    </CollapsibleDrawerSection>
  );
}

interface CandidateMissingFieldsSectionProps {
  missingFields: string[];
  isChileOfficialCandidate: boolean;
}

/** «Datos faltantes» según la evaluación de IA. */
export function CandidateMissingFieldsSection({
  missingFields,
  isChileOfficialCandidate,
}: CandidateMissingFieldsSectionProps) {
  return (
    <CollapsibleDrawerSection
      title="Datos faltantes"
      icon={CircleDashed}
      tone="neutral"
      badge={missingFields.length}
      summary={missingFields
        .slice(0, 3)
        .map((field) => (isChileOfficialCandidate ? sanitizeTextForChile(field) : field))
        .join(' · ')}
    >
      <ul className="space-y-1.5">
        {missingFields.map((field, i) => (
          <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {isChileOfficialCandidate ? sanitizeTextForChile(field) : field}
            </span>
          </li>
        ))}
      </ul>
    </CollapsibleDrawerSection>
  );
}

/** «Evidencia de país»: qué tan confirmado está el país de la empresa. */
export function CandidateCountryEvidenceSection({
  countryEvidence,
}: {
  countryEvidence: Record<string, unknown>;
}) {
  return (
    <CollapsibleDrawerSection
      title="Evidencia de país"
      icon={MapPin}
      summary={
        (
          {
            strong: 'Evidencia fuerte',
            weak: 'Evidencia débil',
            query_only: 'Solo aparece en la búsqueda',
          } as Record<string, string>
        )[String(countryEvidence.evidence_level ?? '')] ?? 'Nivel de evidencia sin clasificar'
      }
      defaultOpen
    >
      {(() => {
        const level = countryEvidence.evidence_level as string | undefined;
        const sources = countryEvidence.evidence_sources as string[] | undefined;
        const warning = countryEvidence.warning as string | undefined;

        const levelConfig = {
          strong: { label: 'Fuerte', variant: 'positive', icon: <CheckCircle2 aria-hidden="true" /> },
          weak: { label: 'Débil', variant: 'warning', icon: <AlertTriangle aria-hidden="true" /> },
          query_only: { label: 'Solo en query', variant: 'negative', icon: <XCircle aria-hidden="true" /> },
        } as const;
        const cfg = level
          ? (levelConfig[level as keyof typeof levelConfig] ?? {
              label: level,
              variant: 'neutral' as const,
              icon: <Info aria-hidden="true" />,
            })
          : null;

        return (
          <div className="space-y-3">
            {cfg && (
              <Badge variant={cfg.variant}>
                {cfg.icon}
                Nivel: {cfg.label}
              </Badge>
            )}
            {sources && sources.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Señales detectadas</p>
                <div className="flex flex-wrap gap-1.5">
                  {sources.map((s, i) => (
                    <Badge key={i} variant="neutral" className="max-w-full font-mono">
                      <span className="truncate">{s}</span>
                    </Badge>
                  ))}
                </div>
                {level === 'strong' && sources.some((s) => s.includes('.com.co')) && (
                  <p className="text-xs text-muted-foreground italic pt-0.5">
                    El dominio .com.co indica presencia en Colombia.
                  </p>
                )}
              </div>
            )}
            {level === 'query_only' && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs leading-relaxed text-current">
                  El país solo aparece en la búsqueda, no está confirmado por la fuente.
                </AlertDescription>
              </Alert>
            )}
            {level === 'weak' && (
              <Alert variant="warning">
                <AlertDescription className="text-xs leading-relaxed text-current">
                  Evidencia de país débil. Requiere revisión manual.
                </AlertDescription>
              </Alert>
            )}
            {warning && level !== 'query_only' && level !== 'weak' && (
              <p className="text-xs text-muted-foreground italic">{warning}</p>
            )}
          </div>
        );
      })()}
    </CollapsibleDrawerSection>
  );
}

/** «Validación del sitio web»: el resultado de comprobar el dominio. */
export function CandidateWebsiteVerificationSection({
  websiteVerification,
}: {
  websiteVerification: Record<string, unknown>;
}) {
  return (
    <CollapsibleDrawerSection
      title="Validación del sitio web"
      icon={Globe}
      summary={
        websiteVerification.skipped
          ? 'Verificación omitida'
          : [
              (
                {
                  verified: 'Verificado',
                  inferred: 'Inferido',
                  mismatch: 'No coincide',
                  not_found: 'No encontrado',
                  error: 'Error al verificar',
                } as Record<string, string>
              )[String(websiteVerification.status ?? '')] ?? null,
              (websiteVerification.domain as string | undefined) ?? null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sin resultado'
      }
      defaultOpen
    >
      {(() => {
        const wvStatus = websiteVerification.status as string | undefined;
        const wvDomain = websiteVerification.domain as string | undefined;
        const wvConfidence = websiteVerification.confidence as number | undefined;
        const wvHttpStatus = websiteVerification.http_status as number | undefined;
        const wvSkipped = websiteVerification.skipped as boolean | undefined;

        if (wvSkipped) {
          return (
            <EmptyState
              variant="plain"
              title="La verificación del sitio web fue omitida para este candidato."
              className="py-4"
            />
          );
        }

        const statusConfig: Record<
          string,
          {
            label: string;
            variant: 'positive' | 'info' | 'warning' | 'neutral' | 'negative';
            icon: React.ReactNode;
          }
        > = {
          verified: { label: 'Verificado', variant: 'positive', icon: <CheckCircle2 aria-hidden="true" /> },
          inferred: { label: 'Inferido', variant: 'info', icon: <Info aria-hidden="true" /> },
          mismatch: { label: 'No coincide', variant: 'warning', icon: <AlertTriangle aria-hidden="true" /> },
          not_found: { label: 'No encontrado', variant: 'neutral', icon: <XCircle aria-hidden="true" /> },
          error: { label: 'Error', variant: 'negative', icon: <XCircle aria-hidden="true" /> },
        };
        const cfg = wvStatus
          ? (statusConfig[wvStatus] ?? {
              label: wvStatus,
              variant: 'neutral' as const,
              icon: <Info aria-hidden="true" />,
            })
          : null;

        return (
          <div className="space-y-3">
            {cfg && (
              <Badge variant={cfg.variant}>
                {cfg.icon}
                {cfg.label}
              </Badge>
            )}
            <FieldGrid>
              {wvDomain && <Field label="Dominio" value={wvDomain} mono />}
              {wvConfidence !== undefined && <Field label="Confianza" value={`${wvConfidence}%`} />}
              {wvHttpStatus !== undefined && (
                <Field
                  label="HTTP Status"
                  value={
                    <span
                      className={
                        wvHttpStatus === 200
                          ? 'text-success font-semibold tabular-nums'
                          : 'text-warning font-semibold tabular-nums'
                      }
                    >
                      {wvHttpStatus}
                    </span>
                  }
                />
              )}
            </FieldGrid>
          </div>
        );
      })()}
    </CollapsibleDrawerSection>
  );
}

/** «Motivos de revisión»: razones a favor, advertencias y bloqueadores del puntaje. */
export function CandidateReviewReasonsSection({ scoringMeta }: { scoringMeta: Record<string, unknown> }) {
  return (
    <CollapsibleDrawerSection
      title="Motivos de revisión"
      icon={ClipboardCheck}
      summary={[
        [scoringMeta.reasons, 'a favor'],
        [scoringMeta.warnings, 'advertencias'],
        [scoringMeta.blockers, 'bloqueadores'],
      ]
        .filter(([list]) => Array.isArray(list) && list.length > 0)
        .map(([list, label]) => `${(list as unknown[]).length} ${label as string}`)
        .join(' · ')}
      defaultOpen
    >
      <div className="space-y-3">
        {Array.isArray(scoringMeta.reasons) && (scoringMeta.reasons as string[]).length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Razones positivas</p>
            <ul className="space-y-1.5">
              {(scoringMeta.reasons as string[]).map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(scoringMeta.warnings) && (scoringMeta.warnings as string[]).length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Advertencias</p>
            <ul className="space-y-1.5">
              {(scoringMeta.warnings as string[]).map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(scoringMeta.blockers) && (scoringMeta.blockers as string[]).length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Bloqueadores</p>
            <ul className="space-y-1.5">
              {(scoringMeta.blockers as string[]).map((b, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-destructive">
                  <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CollapsibleDrawerSection>
  );
}

interface CandidateValidationDataSectionProps {
  candidate: ProspectCandidateWithReviewer;
  validationMetaSheet: SheetValidationMetadata;
}

/** «Datos de la validación»: campos faltantes, confianza y claves normalizadas. */
export function CandidateValidationDataSection({
  candidate,
  validationMetaSheet,
}: CandidateValidationDataSectionProps) {
  return (
    <CollapsibleDrawerSection
      title="Datos de la validación"
      icon={Key}
      tone="neutral"
      summary={`Última validación: ${formatAppDateTime(validationMetaSheet.validated_at || candidate.updated_at)}`}
    >
      <div className="space-y-3">
        <FieldGrid>
          <Field
            label="Campos faltantes"
            value={(() => {
              const missing = validationMetaSheet.quality_check?.missing_fields;
              if (!missing || missing.length === 0) return 'Ninguno';
              const labels: Record<string, string> = {
                tax_identifier: 'Identificador fiscal',
                linkedin_url: 'LinkedIn',
                website: 'Sitio web',
                industry: 'Sector/Industria',
              };
              return missing.map((f) => labels[f] || f).join(', ');
            })()}
          />
          <Field
            label="Confianza importada"
            value={(() => {
              const conf =
                validationMetaSheet.quality_check?.import_confidence ||
                (candidate.metadata as unknown as SheetCandidateMetadata)?.import?.confidence;
              if (!conf) return 'No disponible';
              const confMap: Record<string, string> = {
                alta: 'Alta',
                media: 'Media',
                baja: 'Baja',
                high: 'Alta',
                medium: 'Media',
                low: 'Baja',
              };
              return confMap[String(conf).toLowerCase()] || String(conf);
            })()}
          />
          <Field
            label="Última validación"
            value={formatAppDateTime(validationMetaSheet.validated_at || candidate.updated_at)}
          />
        </FieldGrid>

        {validationMetaSheet.normalized_keys && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Claves normalizadas</p>
            <FieldGrid>
              {validationMetaSheet.normalized_keys.normalized_name && (
                <Field
                  label="Nombre norm."
                  value={validationMetaSheet.normalized_keys.normalized_name}
                  mono
                />
              )}
              {validationMetaSheet.normalized_keys.normalized_domain && (
                <Field
                  label="Dominio norm."
                  value={validationMetaSheet.normalized_keys.normalized_domain}
                  mono
                />
              )}
              {validationMetaSheet.normalized_keys.normalized_tax_identifier && (
                <Field
                  label="Tax ID norm."
                  value={validationMetaSheet.normalized_keys.normalized_tax_identifier}
                  mono
                />
              )}
            </FieldGrid>
          </div>
        )}
      </div>
    </CollapsibleDrawerSection>
  );
}

interface CandidateTechnicalDetailSectionProps {
  candidate: ProspectCandidateWithReviewer;
  searchTrace: Record<string, unknown> | undefined;
}

/** «Detalle técnico»: identificadores, fechas y la traza de la búsqueda. */
export function CandidateTechnicalDetailSection({
  candidate,
  searchTrace,
}: CandidateTechnicalDetailSectionProps) {
  return (
    <CollapsibleDrawerSection
      title="Detalle técnico"
      icon={Settings2}
      tone="neutral"
      summary="Identificadores, fechas y traza de la búsqueda"
      contentClassName="space-y-4"
    >
      <div>
        <FieldGrid>
          <Field label="ID del prospecto" value={candidate.id} mono />
          <Field label="ID del lote" value={candidate.batch_id} mono />
          <Field label="Fuente primaria" value={val(candidate.source_primary)} mono />
          <Field label="Creado" value={formatAppDateTime(candidate.created_at)} />
          <Field label="Actualizado" value={formatAppDateTime(candidate.updated_at)} />
          {candidate.reviewed_at && (
            <Field label="Revisado" value={formatAppDateTime(candidate.reviewed_at)} />
          )}
          {candidate.confidence_score !== null && (
            <Field label="Puntaje de confianza" value={`${candidate.confidence_score?.toFixed(0)}%`} />
          )}
          {candidate.estimated_cost_usd !== null && Number(candidate.estimated_cost_usd) > 0 && (
            <Field
              label="Costo estimado"
              value={`$${Number(candidate.estimated_cost_usd).toFixed(4)} USD`}
              mono
            />
          )}
        </FieldGrid>

        {candidate.review_notes && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <p className="text-xs text-muted-foreground mb-1">Notas de revisión</p>
            <p className="text-sm text-foreground leading-relaxed break-words">{candidate.review_notes}</p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border/50 pt-3.5">
        <p className="text-xs font-semibold text-muted-foreground">Traza de la búsqueda (JSON)</p>
        {(() => {
          const hasSourceTrace = candidate.source_trace && Object.keys(candidate.source_trace).length > 0;
          const hasSearchTrace = searchTrace && Object.keys(searchTrace).length > 0;
          const rawTrace = hasSourceTrace ? candidate.source_trace : hasSearchTrace ? searchTrace : null;
          if (!rawTrace) {
            return (
              <EmptyState
                variant="plain"
                title="No hay trazabilidad de búsqueda disponible para este candidato."
                className="py-4"
              />
            );
          }
          return (
            <pre className="text-xs text-muted-foreground overflow-auto max-h-48 leading-relaxed font-mono bg-surface-subtle p-2.5 rounded-lg border border-border/50">
              {JSON.stringify(rawTrace, null, 2)}
            </pre>
          );
        })()}
      </div>
    </CollapsibleDrawerSection>
  );
}
