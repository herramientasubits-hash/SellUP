import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SurfaceCard } from '@/components/shared/surface-card';
// Server component: la bandera sale del helper SIN 'use client' (ver corporate-tree-batch-sections).
import { getFlagEmoji } from '@/components/prospect-batches/candidate-detail-helpers';
import { Building2, ChevronDown, ExternalLink } from '@/icons';
import { readCompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import {
  collectCompetitorSmallCompanies,
  type CompetitorSmallCompanyCandidate,
} from '@/modules/prospect-batches/competitor-search/competitor-small-companies';

/** Sólo enlaces http(s): la URL viene de la web. */
function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Agente 1 · «Competidores de una empresa» — «Competidoras pequeñas».
 *
 * Decisión de la dueña (21-10): las competidoras con menos de 200 empleados no van
 * a revisión ni a HubSpot, pero se ven aquí como parte del mapa del competidor. De
 * sólo lectura. No renderiza nada fuera de un lote de competidores ni sin pequeñas.
 */
export function CompetitorSmallCompaniesSection({
  batchMetadata,
  candidates,
}: {
  batchMetadata: unknown;
  candidates: readonly CompetitorSmallCompanyCandidate[];
}) {
  const reference = readCompetitorReference(batchMetadata);
  if (!reference) return null;
  const companies = collectCompetitorSmallCompanies({ batchMetadata, candidates });
  if (companies.length === 0) return null;

  return (
    <SurfaceCard>
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="group/small h-auto w-full justify-between gap-3 whitespace-normal px-0 py-0 text-left hover:bg-transparent"
            />
          }
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2">
              <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">
                Competidoras pequeñas{' '}
                <span className="font-normal text-muted-foreground">({companies.length})</span>
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                También compiten con {reference.name}, pero tienen menos de 200 empleados: no van a revisión ni a
                HubSpot. Quedan aquí como parte del mapa de su competencia.
              </span>
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="shrink-0 text-muted-foreground transition-transform group-aria-expanded/small:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
            {companies.map((company) => {
              const href = safeHttpUrl(company.website ?? company.domain);
              return (
                <li key={company.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {company.countryCode ? `${getFlagEmoji(company.countryCode)} ` : ''}
                      {company.name}
                      {company.domain && <span className="font-normal text-muted-foreground"> · {company.domain}</span>}
                    </p>
                    {company.competitorReason && (
                      <p className="text-xs text-muted-foreground">Por qué compite: {company.competitorReason}</p>
                    )}
                    {company.sizeDetail && <p className="text-xs text-muted-foreground">{company.sizeDetail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="neutral">
                      {company.origin === 'size_review' ? 'Tamaño según Claude' : 'Tamaño confirmado'}
                    </Badge>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        Sitio
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </SurfaceCard>
  );
}
