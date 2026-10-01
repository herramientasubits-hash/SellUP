'use client';

import { Building2, Database, Layers, Link2, ListFilter } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DrawerSection } from '@/components/shared/drawer-section';
import {
  DUPLICATE_STATUS_LABELS,
  type DuplicateMatch,
  type ProspectCandidateWithReviewer,
} from '@/modules/prospect-batches/types';
import { SOURCE_LABELS, val, type SheetValidationMetadata } from './candidate-detail-helpers';
import { Field, FieldGrid } from './candidate-detail-parts';

interface CandidateDuplicateSectionsProps {
  candidate: ProspectCandidateWithReviewer;
  isAutoValidated: boolean;
  validationMetaSheet: SheetValidationMetadata | undefined;
  dcMatches: DuplicateMatch[];
}

/** «Verificación de duplicidad»: el veredicto contra SellUp y HubSpot. */
export function CandidateDuplicateStatusSection({
  candidate,
  isAutoValidated,
  validationMetaSheet,
}: Omit<CandidateDuplicateSectionsProps, 'dcMatches'>) {
  const sellupDupStatus = validationMetaSheet?.sellup_duplicate_check?.status;
  const hsDupStatus = validationMetaSheet?.hubspot_duplicate_check?.status;

  return (
    <DrawerSection
      title="Verificación de duplicidad"
      hint="Determina si esta empresa ya existe en los registros internos de SellUp o HubSpot CRM."
      icon={Layers}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {isAutoValidated ? (
          <>
            <Badge
              variant={
                sellupDupStatus === 'duplicate'
                  ? 'negative'
                  : sellupDupStatus === 'possible_duplicate'
                    ? 'warning'
                    : sellupDupStatus === 'no_match'
                      ? 'positive'
                      : 'neutral'
              }
            >
              {sellupDupStatus === 'duplicate'
                ? 'Duplicado SellUp'
                : sellupDupStatus === 'possible_duplicate'
                  ? 'Posible duplicado SellUp'
                  : sellupDupStatus === 'no_match'
                    ? 'Sin duplicados SellUp'
                    : 'SellUp sin validar'}
            </Badge>
            <Badge
              variant={
                hsDupStatus === 'match'
                  ? 'negative'
                  : hsDupStatus === 'possible_match'
                    ? 'warning'
                    : hsDupStatus === 'no_match'
                      ? 'positive'
                      : 'neutral'
              }
            >
              {hsDupStatus === 'match'
                ? 'Duplicado HubSpot'
                : hsDupStatus === 'possible_match'
                  ? 'Posible coincidencia HubSpot'
                  : hsDupStatus === 'no_match'
                    ? 'Sin duplicados HubSpot'
                    : 'HubSpot sin validar'}
            </Badge>
          </>
        ) : (
          <Badge
            variant={
              (
                {
                  unchecked: 'neutral',
                  no_match: 'positive',
                  possible_duplicate: 'warning',
                  exact_duplicate: 'negative',
                  related_company: 'warning',
                  insufficient_data: 'neutral',
                } as const
              )[candidate.duplicate_status]
            }
          >
            {DUPLICATE_STATUS_LABELS[candidate.duplicate_status]}
          </Badge>
        )}
      </div>
    </DrawerSection>
  );
}

/** Las coincidencias que sostienen el veredicto de duplicidad. */
export function CandidateDuplicateMatchesSections({
  candidate,
  isAutoValidated,
  validationMetaSheet,
  dcMatches,
}: CandidateDuplicateSectionsProps) {
  const sellupDupStatus = validationMetaSheet?.sellup_duplicate_check?.status;
  const hsDupStatus = validationMetaSheet?.hubspot_duplicate_check?.status;

  return isAutoValidated ? (
    <div className="space-y-4">
      {/* Bloque SellUp detail */}
      {(sellupDupStatus === 'duplicate' || sellupDupStatus === 'possible_duplicate') &&
        validationMetaSheet?.sellup_duplicate_check?.matched_name && (
          <DrawerSection title="Coincidencia interna en SellUp" icon={Building2} tone="warning">
            <FieldGrid>
              <Field
                label="Empresa encontrada"
                value={val(validationMetaSheet.sellup_duplicate_check.matched_name)}
              />
              <Field
                label="Tipo de registro"
                value={
                  validationMetaSheet.sellup_duplicate_check.matched_source === 'account'
                    ? 'Cuenta (Account)'
                    : 'Candidato'
                }
              />
              <Field
                label="ID interno"
                value={val(
                  validationMetaSheet.sellup_duplicate_check.matched_account_id ??
                    validationMetaSheet.sellup_duplicate_check.matched_candidate_id,
                )}
                mono
              />
              <Field
                label="Dominio / web"
                value={val(
                  validationMetaSheet.sellup_duplicate_check.matched_domain ??
                    validationMetaSheet.sellup_duplicate_check.matched_website,
                )}
              />
              <Field
                label="Identificador fiscal"
                value={val(validationMetaSheet.sellup_duplicate_check.matched_tax_identifier)}
                mono
              />
              <Field
                label="Coincidió por"
                value={
                  (
                    {
                      tax_identifier: 'NIT/RFC/RUT',
                      domain: 'Dominio web',
                      normalized_name_country: 'Nombre + país',
                      company_name: 'Nombre de empresa',
                    } as Record<string, string>
                  )[validationMetaSheet.sellup_duplicate_check.matched_by ?? ''] ??
                  val(validationMetaSheet.sellup_duplicate_check.matched_by)
                }
              />
            </FieldGrid>
          </DrawerSection>
        )}

      {/* Bloque HubSpot detail */}
      {(hsDupStatus === 'match' || hsDupStatus === 'possible_match') &&
        validationMetaSheet?.hubspot_duplicate_check?.matched_company_name && (
          <DrawerSection title="Coincidencia en HubSpot CRM" icon={Database} tone="warning">
            <FieldGrid>
              <Field
                label="Empresa encontrada"
                value={val(validationMetaSheet.hubspot_duplicate_check.matched_company_name)}
              />
              <Field
                label="HubSpot Company ID"
                value={val(validationMetaSheet.hubspot_duplicate_check.matched_company_id)}
                mono
              />
              <Field
                label="Dominio / web"
                value={val(
                  validationMetaSheet.hubspot_duplicate_check.matched_domain ??
                    validationMetaSheet.hubspot_duplicate_check.matched_website,
                )}
              />
              {validationMetaSheet.hubspot_duplicate_check.matched_phone && (
                <Field label="Teléfono" value={validationMetaSheet.hubspot_duplicate_check.matched_phone} />
              )}
              {validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage && (
                <Field
                  label="Lifecycle stage"
                  value={
                    (
                      {
                        subscriber: 'Suscriptor',
                        lead: 'Lead',
                        marketingqualifiedlead: 'MQL',
                        salesqualifiedlead: 'SQL',
                        opportunity: 'Oportunidad',
                        customer: 'Cliente',
                        evangelist: 'Evangelizador',
                        other: 'Otro',
                      } as Record<string, string>
                    )[validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage ?? ''] ??
                    val(validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage)
                  }
                />
              )}
              {validationMetaSheet.hubspot_duplicate_check.matched_tax_identifier && (
                <Field
                  label="NIT / Tax ID"
                  value={validationMetaSheet.hubspot_duplicate_check.matched_tax_identifier}
                  mono
                />
              )}
            </FieldGrid>
            {validationMetaSheet.hubspot_duplicate_check.hubspot_url && (
              <div className="pt-3 border-t border-border/50 mt-3 flex">
                <a
                  href={validationMetaSheet.hubspot_duplicate_check.hubspot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Ver empresa en HubSpot CRM
                </a>
              </div>
            )}
          </DrawerSection>
        )}

      {/* Comparación rápida */}
      {(sellupDupStatus === 'duplicate' ||
        sellupDupStatus === 'possible_duplicate' ||
        hsDupStatus === 'match' ||
        hsDupStatus === 'possible_match') &&
        (() => {
          const su = validationMetaSheet?.sellup_duplicate_check;
          const hs = validationMetaSheet?.hubspot_duplicate_check;
          const hasSellupDetail = !!su?.matched_name;

          const matchName = hasSellupDetail ? su?.matched_name : hs?.matched_company_name;
          const matchDomain = hasSellupDetail
            ? (su?.matched_domain ?? su?.matched_website)
            : (hs?.matched_domain ?? hs?.matched_website);
          const matchCountry = hasSellupDetail ? su?.matched_country_code : hs?.matched_country;
          const matchTaxId = hasSellupDetail ? su?.matched_tax_identifier : hs?.matched_tax_identifier;

          if (!matchName && !matchDomain) return null;

          const rows = [
            { label: 'Nombre', cv: candidate.name, mv: matchName },
            { label: 'Sitio web', cv: candidate.domain ?? candidate.website, mv: matchDomain },
            { label: 'País', cv: candidate.country ?? candidate.country_code, mv: matchCountry },
            { label: 'Identificador fiscal', cv: candidate.tax_identifier, mv: matchTaxId },
          ].filter((r) => r.cv || r.mv);

          if (rows.length === 0) return null;
          return (
            <DrawerSection title="Comparación rápida" icon={ListFilter} tone="neutral">
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Campo</TableHead>
                      <TableHead scope="col">Candidato</TableHead>
                      <TableHead scope="col">Coincidencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ label: rl, cv, mv }) => (
                      <TableRow key={rl}>
                        <TableCell className="text-muted-foreground font-medium">{rl}</TableCell>
                        <TableCell className="whitespace-normal break-words text-foreground">
                          {cv ?? <span className="text-text-muted italic">Sin dato</span>}
                        </TableCell>
                        <TableCell className="whitespace-normal break-words text-foreground">
                          {mv ?? <span className="text-text-muted italic">Sin dato</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DrawerSection>
          );
        })()}
    </div>
  ) : (
    <div className="space-y-4">
      {dcMatches.length > 0 && (
        <DrawerSection
          title="Coincidencias encontradas"
          icon={Layers}
          tone="warning"
          badge={dcMatches.length}
        >
          <ul className="divide-y divide-border/50">
            {dcMatches.map((match, i) => (
              <DuplicateMatchRow key={i} match={match} />
            ))}
          </ul>
        </DrawerSection>
      )}
    </div>
  );
}

function DuplicateMatchRow({ match }: { match: DuplicateMatch }) {
  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {SOURCE_LABELS[match.source] ?? match.source}
        </span>
        {match.confidence !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">Conf: {match.confidence}%</span>
        )}
      </div>
      {match.matched_name && <p className="text-sm text-foreground break-words">{match.matched_name}</p>}
      {match.matched_domain && (
        <p className="text-xs text-muted-foreground break-all">{match.matched_domain}</p>
      )}
      {match.reason && <p className="text-xs text-muted-foreground italic break-words">{match.reason}</p>}
    </li>
  );
}
