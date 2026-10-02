'use client';

// ── Import Classification Table — celdas y fila de detalle ────────────────────
// Lo que la tabla de clasificación pinta dentro de cada fila: el estado, la
// celda de industria/subindustria y la fila desplegable con el detalle.

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pencil,
  ExternalLink,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ImportClassificationPreviewRow } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { CLASSIFICATION_STATUS_MAP } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { TableCell, TableRow } from '@/components/ui/table';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// ── Country code → display name (subset LATAM + common) ───────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  AR: 'Argentina', BO: 'Bolivia', BR: 'Brasil', CL: 'Chile',
  CO: 'Colombia', CR: 'Costa Rica', DO: 'R. Dominicana', EC: 'Ecuador',
  GT: 'Guatemala', HN: 'Honduras', MX: 'México', NI: 'Nicaragua',
  PA: 'Panamá', PE: 'Perú', PY: 'Paraguay', SV: 'El Salvador',
  UY: 'Uruguay', VE: 'Venezuela', US: 'EE.UU.', ES: 'España',
};

export function countryLabel(code: string | null): string {
  if (!code) return '—';
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

// ── Domain extractor ──────────────────────────────────────────────────────────

export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: ImportClassificationPreviewRow['validationStatus'] }) {
  const config = CLASSIFICATION_STATUS_MAP[status];
  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    success: 'secondary',
    warning: 'default',
    destructive: 'destructive',
    default: 'default',
    secondary: 'secondary',
    outline: 'outline',
  };
  const iconMap: Record<string, React.ReactNode> = {
    valid: <CheckCircle2 className="h-3 w-3 text-success" />,
    normalized: <CheckCircle2 className="h-3 w-3 text-primary" />,
    warning: <AlertTriangle className="h-3 w-3 text-warning" />,
    requires_review: <Pencil className="h-3 w-3 text-destructive" />,
    invalid: <XCircle className="h-3 w-3 text-destructive" />,
  };
  return (
    <Badge variant={variantMap[config.variant] ?? 'secondary'} className="whitespace-nowrap">
      {iconMap[status]}
      {config.label}
    </Badge>
  );
}

// ── ClassificationCell ────────────────────────────────────────────────────────

export function ClassificationCell({
  canonicalName,
  originalValue,
  matchStatus,
}: {
  canonicalName: string | null;
  originalValue: string | null;
  matchStatus: string;
}) {
  if (!canonicalName && !originalValue) {
    return <span className="text-xs text-muted-foreground italic">Sin valor</span>;
  }
  const isDifferent =
    canonicalName &&
    originalValue &&
    canonicalName.toLowerCase() !== originalValue.toLowerCase();
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-foreground">{canonicalName ?? originalValue ?? '—'}</p>
      {isDifferent && (
        <p className="text-xs text-muted-foreground">
          Original: <span className="italic">{originalValue}</span>
        </p>
      )}
      {(matchStatus === 'alias_match' || matchStatus === 'normalized_match') && isDifferent && (
        <p className="text-xs text-primary">Normalizado automáticamente</p>
      )}
    </div>
  );
}

// ── Warning message translator (classifier emits messages in English) ──────────

function translateWarning(message: string): string {
  if (/^Industry value is empty or not provided/.test(message))
    return 'El valor de industria está vacío o no fue proporcionado.';

  const industryNotFound = message.match(/^Industry not found in catalog: "(.+)"\./);
  if (industryNotFound)
    return `La industria "${industryNotFound[1]}" no existe en el catálogo actual.`;

  const industryAmbiguous = message.match(/^Ambiguous industry name: "(.+)"\./);
  if (industryAmbiguous)
    return `El nombre de industria "${industryAmbiguous[1]}" es ambiguo.`;

  const industryAmbiguousNorm = message.match(/^Ambiguous industry after normalization: "(.+)"\./);
  if (industryAmbiguousNorm)
    return `La industria "${industryAmbiguousNorm[1]}" es ambigua tras la normalización.`;

  if (/^Subindustry value is empty or not provided/.test(message))
    return 'El valor de subindustria está vacío o no fue proporcionado.';

  const subNotFound = message.match(/^Subindustry not found in catalog: "(.+)"\./);
  if (subNotFound)
    return `La subindustria "${subNotFound[1]}" no existe en el catálogo actual.`;

  const subWrongIndustry = message.match(/^Subindustry "(.+)" was found in catalog but does not belong/);
  if (subWrongIndustry)
    return `La subindustria "${subWrongIndustry[1]}" existe en el catálogo pero no pertenece a la industria detectada.`;

  const subAmbiguousWithin = message.match(/^Ambiguous subindustry "(.+)" — multiple matches within/);
  if (subAmbiguousWithin)
    return `La subindustria "${subAmbiguousWithin[1]}" es ambigua — múltiples coincidencias dentro de la industria detectada.`;

  const subAmbiguousAcross = message.match(/^Ambiguous subindustry "(.+)" — multiple matches across/);
  if (subAmbiguousAcross)
    return `La subindustria "${subAmbiguousAcross[1]}" es ambigua — múltiples coincidencias en distintas industrias.`;

  const subRecognized = message.match(/^Subindustry "(.+)" recognized; parent industry suggested/);
  if (subRecognized)
    return `La subindustria "${subRecognized[1]}" fue reconocida; industria sugerida pero no confirmada.`;

  const subCountryRequired = message.match(/^Subindustry "(.+)" has country restrictions but no country code/);
  if (subCountryRequired)
    return `La subindustria "${subCountryRequired[1]}" tiene restricciones por país, pero no se proporcionó código de país.`;

  const subNotApplicable = message.match(/^Subindustry "(.+)" is not applicable to country "(.+)"/);
  if (subNotApplicable)
    return `La subindustria "${subNotApplicable[1]}" no aplica para el país "${subNotApplicable[2]}".`;

  return message;
}

// ── DetailField — labeled field for the expanded detail layout ────────────────

function DetailField({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('space-y-0.5', fullWidth && 'col-span-full')}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="text-xs text-foreground">{value}</div>
    </div>
  );
}

// ── ExpandedDetailRow ─────────────────────────────────────────────────────────

export function ExpandedDetailRow({
  row,
  colSpan,
  showSubindustry,
}: {
  row: ImportClassificationPreviewRow;
  colSpan: number;
  showSubindustry: boolean;
}) {
  const statusConfig = CLASSIFICATION_STATUS_MAP[row.validationStatus];

  const websiteHref = row.website
    ? row.website.startsWith('http') ? row.website : `https://${row.website}`
    : null;
  const linkedinHref = row.linkedinUrl
    ? row.linkedinUrl.startsWith('http') ? row.linkedinUrl : `https://${row.linkedinUrl}`
    : null;
  const sourceHref = row.sourceUrl
    ? row.sourceUrl.startsWith('http') ? row.sourceUrl : `https://${row.sourceUrl}`
    : null;

  const showOriginalValues =
    (row.industryOriginalValue || (showSubindustry && row.subindustryOriginalValue)) &&
    (row.correctionSource === 'manual' ||
      row.industryMatchStatus === 'alias_match' ||
      row.industryMatchStatus === 'normalized_match' ||
      row.subindustryMatchStatus === 'alias_match' ||
      row.subindustryMatchStatus === 'normalized_match');

  const hasInfoBlock =
    row.description ||
    row.countryCode ||
    row.city ||
    row.website ||
    row.linkedinUrl ||
    row.companySize ||
    row.confidence ||
    row.notes;

  const hasEvidenceBlock = row.sourceUrl || row.sourceEvidence;

  const hasClassificationBlock =
    row.industryCanonicalName ||
    (showSubindustry && row.subindustryCanonicalName) ||
    showOriginalValues ||
    (row.warnings && row.warnings.length > 0) ||
    row.requiresHumanReview;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0 whitespace-normal">
        <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-border/50 bg-surface-subtle">

          {/* ── Bloque 1: Resumen ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 bg-surface-subtle px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{row.companyName}</span>
            <Badge
              variant={
                row.validationStatus === 'valid' || row.validationStatus === 'normalized'
                  ? 'positive'
                  : row.validationStatus === 'warning'
                    ? 'warning'
                    : 'negative'
              }
            >
              {statusConfig.label}
            </Badge>
            {row.industryCanonicalName && (
              <span className="text-xs text-muted-foreground">
                {row.industryCanonicalName}
                {row.subindustryCanonicalName && (
                  <> · <span className="text-muted-foreground">{row.subindustryCanonicalName}</span></>
                )}
              </span>
            )}
          </div>

          <div className="space-y-4 p-3">

            {/* ── Bloque 2: Información detectada ─────────────────────────────── */}
            {hasInfoBlock && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Información detectada
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {row.description && (
                    <DetailField
                      label="Descripción"
                      fullWidth
                      value={<span className="leading-relaxed">{row.description}</span>}
                    />
                  )}
                  {row.countryCode && (
                    <DetailField label="País" value={countryLabel(row.countryCode)} />
                  )}
                  {row.city && (
                    <DetailField label="Ciudad" value={row.city} />
                  )}
                  {row.companySize && (
                    <DetailField label="Tamaño" value={row.companySize} />
                  )}
                  {row.confidence && (
                    <DetailField label="Confianza" value={row.confidence} />
                  )}
                  {websiteHref && (
                    <DetailField
                      label="Sitio web"
                      value={
                        <a
                          href={websiteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.website ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.website) ?? row.website}
                        </a>
                      }
                    />
                  )}
                  {linkedinHref && (
                    <DetailField
                      label="LinkedIn"
                      value={
                        <a
                          href={linkedinHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.linkedinUrl ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.linkedinUrl)?.replace('linkedin.com/', 'li/') ?? row.linkedinUrl}
                        </a>
                      }
                    />
                  )}
                  {row.notes && (
                    <DetailField label="Notas" fullWidth value={row.notes} />
                  )}
                  {!hasInfoBlock && (
                    <p className="col-span-full text-xs text-muted-foreground italic">No disponible</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Bloque 3: Evidencia ──────────────────────────────────────────── */}
            {hasEvidenceBlock && (
              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Evidencia
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {sourceHref && (
                    <DetailField
                      label="URL de evidencia"
                      value={
                        <a
                          href={sourceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.sourceUrl ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.sourceUrl) ?? row.sourceUrl}
                        </a>
                      }
                    />
                  )}
                  {row.sourceEvidence && (
                    <DetailField label="Fuente / evidencia" value={row.sourceEvidence} />
                  )}
                </div>
              </div>
            )}

            {/* ── Bloque 4: Clasificación ──────────────────────────────────────── */}
            {hasClassificationBlock && (
              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Clasificación
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {row.industryCanonicalName && (
                    <DetailField label="Industria detectada" value={row.industryCanonicalName} />
                  )}
                  {showSubindustry && row.subindustryCanonicalName && (
                    <DetailField label="Subindustria detectada" value={row.subindustryCanonicalName} />
                  )}
                </div>

                {/* Valores originales */}
                {showOriginalValues && (
                  <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Valores originales
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      {row.industryOriginalValue && (
                        <span>Industria: <em>{row.industryOriginalValue}</em></span>
                      )}
                      {showSubindustry && row.subindustryOriginalValue && (
                        <span>Subindustria: <em>{row.subindustryOriginalValue}</em></span>
                      )}
                      {row.correctionSource === 'manual' && (
                        <span className="text-primary font-medium">— corregido manualmente</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Advertencias */}
                {row.warnings && row.warnings.length > 0 && (
                  <Alert variant="warning" className="mt-2 p-3">
                    <AlertTitle className="text-xs">Advertencias de clasificación</AlertTitle>
                    <AlertDescription className="text-xs text-warning">
                      <ul className="space-y-1">
                        {row.warnings.map((w, i) => (
                          <li key={i}>{translateWarning(w.message)}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Motivo de revisión requerida */}
                {row.requiresHumanReview && (
                  <Alert variant="destructive" className="mt-2 p-3">
                    <AlertTitle className="text-xs">Motivo de revisión requerida</AlertTitle>
                    <AlertDescription className="text-xs text-destructive">
                      Esta fila requiere corrección manual antes de poder importarse.
                      {row.industryCanonicalId === null &&
                        ' La industria no pudo clasificarse automáticamente.'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Empty state */}
            {!hasInfoBlock && !hasEvidenceBlock && !hasClassificationBlock && (
              <p className="text-xs text-muted-foreground italic">No hay información adicional para esta fila.</p>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
