'use client';

import * as React from 'react';
import { formatInAppZone } from '@/lib/format-date';
import { FileSearch, Globe, Landmark, Link2, Users } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CollapsibleDrawerSection } from '@/components/shared/collapsible-drawer-section';
import { DetailItem } from '@/components/shared/detail-list';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import type {
  resolveEmployeeCountFieldDisplay,
  resolveLinkedInFieldDisplay,
} from '@/modules/prospect-batches/candidate-company-fields-display';
import type { getCandidateLinkedInDisplay } from '@/modules/prospect-batches/candidate-linkedin-url';
import { getIcpSizeGateUiState } from './icp-size-gate-ui';
import {
  SOURCE_TYPE_LABELS,
  extractDomainFromUrl,
  getFlagEmoji,
  getTaxIdLabel,
  val,
} from './candidate-detail-helpers';
import { CopyButton, Field, FieldGrid, MissingText } from './candidate-detail-parts';

interface CandidateOfficialDataSectionProps {
  candidate: ProspectCandidateWithReviewer;
  isChileOfficialCandidate: boolean;
  ciiu: string | null;
  structuredSourceLabel: React.ReactNode;
}

/** «Datos oficiales y legales»: razón social, identificador fiscal y ubicación. */
export function CandidateOfficialDataSection({
  candidate,
  isChileOfficialCandidate,
  ciiu,
  structuredSourceLabel,
}: CandidateOfficialDataSectionProps) {
  // Datos oficiales de Chile, tal como llegaron en la traza de la fuente.
  const chileSourceParams = isChileOfficialCandidate
    ? (candidate.source_trace?.queryParams as Record<string, unknown> | undefined)
    : null;
  const chileCapital = chileSourceParams?.capitalAmount as number | null | undefined;
  const chileCapitalCurrency = (chileSourceParams?.capitalCurrency as string | undefined) ?? 'CLP';
  const chileIncorporationDate = chileSourceParams?.incorporationDate as string | null | undefined;
  const chileCompanyType = chileSourceParams?.companyType as string | null | undefined;

  const officialDataSummary = [
    candidate.legal_name ?? candidate.name,
    candidate.tax_identifier
      ? `${candidate.tax_identifier_type ?? getTaxIdLabel(candidate.country_code)} ${candidate.tax_identifier}`
      : 'sin identificador fiscal',
    [candidate.city, candidate.country ?? candidate.country_code].filter(Boolean).join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <CollapsibleDrawerSection
      title="Datos oficiales y legales"
      icon={Landmark}
      summary={officialDataSummary}
      defaultOpen
    >
      {isChileOfficialCandidate ? (
        <FieldGrid>
          <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
          <DetailItem label="RUT">
            <span className="flex flex-wrap items-center font-mono leading-snug">
              {candidate.tax_identifier ? (
                <>
                  <span className="min-w-0 break-all tabular-nums">{candidate.tax_identifier}</span>
                  <CopyButton value={candidate.tax_identifier} />
                </>
              ) : (
                <MissingText text="Sin dato" />
              )}
            </span>
          </DetailItem>
          <Field
            label="País"
            value={
              candidate.country_code ? (
                <span className="flex items-center gap-1">
                  {getFlagEmoji(candidate.country_code)} {val(candidate.country ?? candidate.country_code)}
                </span>
              ) : (
                <MissingText text="Sin dato" />
              )
            }
          />
          <Field
            label="Ciudad / Región"
            value={val([candidate.city, candidate.region].filter(Boolean).join(', ') || null, 'Sin dato')}
          />
          {chileCompanyType && <Field label="Tipo societario" value={chileCompanyType} />}
          {chileIncorporationDate && (
            <Field
              label="Fecha de constitución"
              value={formatInAppZone(
                chileIncorporationDate,
                {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                },
                'es-CL',
              )}
            />
          )}
          {chileCapital !== null && chileCapital !== undefined && (
            <Field
              label="Capital CLP"
              value={
                <span className="font-mono">
                  ${chileCapital.toLocaleString('es-CL')} {chileCapitalCurrency}
                </span>
              }
            />
          )}
          <Field label="Fuente oficial" value="Fuente oficial Chile" />
        </FieldGrid>
      ) : (
        <>
          <FieldGrid>
            <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
            <DetailItem label={candidate.tax_identifier_type ?? 'Identificador fiscal'}>
              <span className="flex flex-wrap items-center font-mono leading-snug">
                {candidate.tax_identifier ? (
                  <>
                    <span className="min-w-0 break-all tabular-nums">{candidate.tax_identifier}</span>
                    <CopyButton value={candidate.tax_identifier} />
                  </>
                ) : (
                  <MissingText text="Sin dato" />
                )}
              </span>
            </DetailItem>
            <Field
              label="País"
              value={
                candidate.country_code ? (
                  <span className="flex items-center gap-1">
                    {getFlagEmoji(candidate.country_code)} {val(candidate.country ?? candidate.country_code)}
                  </span>
                ) : (
                  <MissingText text="Sin dato" />
                )
              }
            />
            <Field
              label="Ciudad / Región"
              value={val([candidate.city, candidate.region].filter(Boolean).join(', ') || null, 'Sin dato')}
            />
            {ciiu && <Field label="CIIU / Código sector" value={ciiu} mono />}
            {structuredSourceLabel && <Field label="Fuente oficial" value={structuredSourceLabel} />}
          </FieldGrid>
        </>
      )}
    </CollapsibleDrawerSection>
  );
}

export interface CandidateCommercialDataSectionProps {
  candidate: ProspectCandidateWithReviewer;
  hasOfficialWebsite: boolean;
  websiteConfidence: string | null;
  effectiveLinkedinUrl: string | null;
  suggestedLinkedinDisplay: ReturnType<typeof getCandidateLinkedInDisplay>;
  linkedinConfirmedUrl: string | null;
  linkedinConfidence: string | null;
  possibleLinkedInMatches: Array<Record<string, unknown>>;
  linkedInFieldDisplay: ReturnType<typeof resolveLinkedInFieldDisplay>;
  employeeCountFieldDisplay: ReturnType<typeof resolveEmployeeCountFieldDisplay>;
  employeeCount: string | number | null;
  isChileOfficialCandidate: boolean;
  hasNitConflict: boolean;
  isStructured: boolean;
  sourcePrimaryLabel: string | null;
  publicDescription: string | null;
  isDescriptionConfiable: boolean;
}

/** «Datos comerciales y web»: sitio oficial, LinkedIn, tamaño y descripción pública. */
export function CandidateCommercialDataSection({
  candidate,
  hasOfficialWebsite,
  websiteConfidence,
  effectiveLinkedinUrl,
  suggestedLinkedinDisplay,
  linkedinConfirmedUrl,
  linkedinConfidence,
  possibleLinkedInMatches,
  linkedInFieldDisplay,
  employeeCountFieldDisplay,
  employeeCount,
  isChileOfficialCandidate,
  hasNitConflict,
  isStructured,
  sourcePrimaryLabel,
  publicDescription,
  isDescriptionConfiable,
}: CandidateCommercialDataSectionProps) {
  const commercialSummary = [
    hasOfficialWebsite && candidate.website
      ? (candidate.domain ?? extractDomainFromUrl(candidate.website) ?? candidate.website)
      : 'sin sitio web oficial',
    effectiveLinkedinUrl ? 'con LinkedIn' : suggestedLinkedinDisplay ? 'LinkedIn sugerido' : 'sin LinkedIn',
    employeeCountFieldDisplay.value !== null
      ? `${employeeCountFieldDisplay.value.toLocaleString('es-CO')} empleados`
      : employeeCount
        ? `${employeeCount} empleados`
        : 'sin tamaño',
  ].join(' · ');

  return (
    <CollapsibleDrawerSection
      title="Datos comerciales y web"
      icon={Globe}
      summary={commercialSummary}
      defaultOpen={hasOfficialWebsite || Boolean(effectiveLinkedinUrl)}
    >
      <div className="space-y-3">
        <FieldGrid>
          <Field
            label="Sitio web oficial"
            value={
              hasOfficialWebsite && candidate.website ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a
                    href={
                      candidate.website.startsWith('http')
                        ? candidate.website
                        : `https://${candidate.website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1 break-all text-primary hover:underline font-medium rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {candidate.domain ?? candidate.website}
                  </a>
                  {websiteConfidence && (
                    <Badge
                      variant={
                        websiteConfidence === 'high'
                          ? 'positive'
                          : websiteConfidence === 'medium'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {websiteConfidence}
                    </Badge>
                  )}
                </div>
              ) : (
                <MissingText text="Sin sitio web oficial" />
              )
            }
          />
          <Field
            label={
              effectiveLinkedinUrl
                ? 'LinkedIn corporativo'
                : suggestedLinkedinDisplay
                  ? 'LinkedIn sugerido'
                  : isChileOfficialCandidate &&
                      !hasNitConflict &&
                      (possibleLinkedInMatches.length > 0 || linkedinConfirmedUrl)
                    ? 'Coincidencias no confirmadas'
                    : 'LinkedIn corporativo'
            }
            value={
              effectiveLinkedinUrl ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a
                    href={
                      effectiveLinkedinUrl.startsWith('http')
                        ? effectiveLinkedinUrl
                        : `https://${effectiveLinkedinUrl}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline font-medium rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Ver perfil
                  </a>
                  {linkedinConfidence && (
                    <Badge
                      variant={
                        linkedinConfidence === 'high'
                          ? 'positive'
                          : linkedinConfidence === 'medium'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {linkedinConfidence}
                    </Badge>
                  )}
                </div>
              ) : suggestedLinkedinDisplay ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a
                      href={
                        suggestedLinkedinDisplay.url.startsWith('http')
                          ? suggestedLinkedinDisplay.url
                          : `https://${suggestedLinkedinDisplay.url}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-warning hover:underline font-medium rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      Ver perfil
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground italic">Requiere revisión manual</p>
                </div>
              ) : isChileOfficialCandidate &&
                !hasNitConflict &&
                (possibleLinkedInMatches.length > 0 || linkedinConfirmedUrl) ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground italic">No confirmado — requiere revisión</p>
                  {linkedinConfirmedUrl && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <a
                        href={
                          linkedinConfirmedUrl.startsWith('http')
                            ? linkedinConfirmedUrl
                            : `https://${linkedinConfirmedUrl}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                      >
                        <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Posible perfil
                      </a>
                    </div>
                  )}
                </div>
              ) : linkedInFieldDisplay.message ? (
                // Cada estado dice lo suyo: ausencia del proveedor en gris,
                // pérdida interna en ámbar porque es un defecto nuestro.
                <div className="space-y-0.5">
                  <p
                    className={
                      linkedInFieldDisplay.kind === 'internal_loss'
                        ? 'text-xs text-warning'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {linkedInFieldDisplay.message}
                  </p>
                  {linkedInFieldDisplay.sourceLabel && (
                    <p className="text-xs text-muted-foreground">{linkedInFieldDisplay.sourceLabel}</p>
                  )}
                </div>
              ) : (
                <MissingText text="Sin LinkedIn" />
              )
            }
          />
          <Field
            label="Tamaño / Empleados"
            value={
              employeeCountFieldDisplay.kind === 'value' && employeeCountFieldDisplay.value !== null ? (
                <div className="space-y-0.5">
                  <p className="text-sm font-medium tabular-nums">
                    {employeeCountFieldDisplay.value.toLocaleString('es-CO')}
                  </p>
                  {employeeCountFieldDisplay.sourceLabel && (
                    <p className="text-xs text-muted-foreground">{employeeCountFieldDisplay.sourceLabel}</p>
                  )}
                </div>
              ) : employeeCountFieldDisplay.message ? (
                <div className="space-y-0.5">
                  {employeeCountFieldDisplay.value !== null && (
                    <p className="text-sm font-medium tabular-nums">
                      {employeeCountFieldDisplay.value.toLocaleString('es-CO')}
                    </p>
                  )}
                  <p
                    className={
                      employeeCountFieldDisplay.kind === 'internal_loss'
                        ? 'text-xs text-warning'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {employeeCountFieldDisplay.message}
                  </p>
                  {employeeCountFieldDisplay.sourceLabel && (
                    <p className="text-xs text-muted-foreground">{employeeCountFieldDisplay.sourceLabel}</p>
                  )}
                </div>
              ) : (
                val(employeeCount ? String(employeeCount) : null, 'Sin dato')
              )
            }
          />
          {!isStructured && sourcePrimaryLabel && <Field label="Fuente" value={sourcePrimaryLabel} />}
        </FieldGrid>

        {/* Descripción pública */}
        {!hasNitConflict && publicDescription && (!isChileOfficialCandidate || isDescriptionConfiable) ? (
          <div className="space-y-0.5 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">Descripción pública</p>
            <p className="text-sm text-foreground leading-relaxed line-clamp-4 break-words">
              {publicDescription}
            </p>
          </div>
        ) : null}
      </div>
    </CollapsibleDrawerSection>
  );
}

/** «Tamaño ICP»: si la empresa pasa el umbral de más de 200 colaboradores. */
export function CandidateIcpSizeSection({ candidate }: { candidate: ProspectCandidateWithReviewer }) {
  const icpState = getIcpSizeGateUiState(
    candidate.metadata as Record<string, unknown> | null | undefined,
    candidate.company_size,
  );
  const badgeVariant: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
    success: 'positive',
    warning: 'warning',
    danger: 'negative',
    neutral: 'neutral',
  };
  const icpVerdict =
    icpState.decision === 'pass'
      ? 'ICP >200 validado'
      : icpState.decision === 'needs_validation'
        ? 'Tamaño pendiente de validación'
        : icpState.decision === 'block'
          ? 'Fuera de ICP por tamaño'
          : 'Sin evaluación de tamaño';
  return (
    <CollapsibleDrawerSection
      title="Tamaño ICP"
      hint="Umbral: más de 200 colaboradores"
      summary={[icpVerdict, icpState.rangeLabel].filter(Boolean).join(' · ')}
      icon={Users}
      tone={
        icpState.decision === 'block'
          ? 'negative'
          : icpState.decision === 'needs_validation'
            ? 'warning'
            : 'brand'
      }
      // Abierta cuando el tamaño pide una decisión; si pasa o no se midió, plegada.
      defaultOpen={icpState.decision === 'block' || icpState.decision === 'needs_validation'}
    >
      <div className="space-y-3">
        {/* Badge de estado */}
        <Badge variant={badgeVariant[icpState.tone] ?? 'neutral'}>{icpVerdict}</Badge>

        {/* Detalle */}
        {!icpState.decision ? (
          <p className="text-xs text-muted-foreground italic">
            Este prospecto no tiene una evaluación de tamaño registrada: llegó por una vía que todavía no mide
            el tamaño. Revísalo a mano antes de decidir.
          </p>
        ) : (
          <div className="space-y-3">
            {(icpState.rangeLabel || icpState.reason) && (
              <FieldGrid>
                {icpState.rangeLabel && (
                  <DetailItem label="Rango detectado">
                    <span className="font-medium tabular-nums">{icpState.rangeLabel}</span>
                  </DetailItem>
                )}
                {icpState.reason && <DetailItem label="Motivo">{icpState.reason}</DetailItem>}
              </FieldGrid>
            )}
            {icpState.requiresHumanReview && (
              <Alert variant="warning">
                <AlertDescription className="text-xs leading-relaxed text-current">
                  Requiere validación humana
                </AlertDescription>
              </Alert>
            )}
            {icpState.decision === 'needs_validation' && (
              <Alert variant="warning">
                <AlertDescription className="text-xs leading-relaxed text-current">
                  {icpState.description}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>
    </CollapsibleDrawerSection>
  );
}

/** «Evidencia pública»: directorios y registros donde aparece la empresa. */
export function CandidatePublicEvidenceSection({
  displayedPublicEvidence,
}: {
  displayedPublicEvidence: Array<Record<string, unknown>>;
}) {
  return (
    <CollapsibleDrawerSection
      title="Evidencia pública"
      icon={FileSearch}
      badge={displayedPublicEvidence.length}
      summary={Array.from(
        new Set(
          displayedPublicEvidence.map(
            (item) => SOURCE_TYPE_LABELS[item.source_type as string] || String(item.source_type),
          ),
        ),
      )
        .slice(0, 3)
        .join(', ')}
    >
      <ul className="divide-y divide-border/50">
        {displayedPublicEvidence.map((item, idx) => {
          const label = SOURCE_TYPE_LABELS[item.source_type as string] || item.source_type;
          return (
            <li
              key={idx}
              className="flex min-w-0 items-center justify-between py-2.5 text-xs first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1 pr-2">
                <p className="font-semibold text-foreground truncate" title={item.title as string}>
                  {item.title as string}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {label as string} · {item.domain as string}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {item.confidence ? (
                  <Badge
                    variant={
                      item.confidence === 'high'
                        ? 'positive'
                        : item.confidence === 'medium'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {item.confidence as string}
                  </Badge>
                ) : null}
                <a
                  href={item.url as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir la fuente «${String(item.title)}» en una pestaña nueva`}
                  className="rounded-md p-1 text-primary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </CollapsibleDrawerSection>
  );
}
