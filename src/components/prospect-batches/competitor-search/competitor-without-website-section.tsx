import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SurfaceCard } from '@/components/shared/surface-card';
import { ChevronDown, ExternalLink, Search } from '@/icons';
import { readCompetitorWithoutWebsite } from '@/modules/prospect-batches/competitor-search/competitor-batch-notices';

/**
 * «Competidores de una empresa» — las que Claude propuso sin sitio web. No se
 * pueden verificar ni llevar a revisión, pero se ven para que el vendedor decida
 * si las busca por su cuenta (auditoría 21-10: antes se perdían sin rastro).
 */
export function CompetitorWithoutWebsiteSection({ batchMetadata }: { batchMetadata: unknown }) {
  const companies = readCompetitorWithoutWebsite(batchMetadata);
  if (companies.length === 0) return null;
  return (
    <SurfaceCard>
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="group/noweb h-auto w-full justify-between gap-3 whitespace-normal px-0 py-0 text-left hover:bg-transparent"
            />
          }
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2">
              <Search className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">
                Sin sitio web <span className="font-normal text-muted-foreground">({companies.length})</span>
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                La IA las propuso pero no encontró su web: no entran a revisión. Búscalas si te interesan.
              </span>
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="shrink-0 text-muted-foreground transition-transform group-aria-expanded/noweb:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
            {companies.map((company) => (
              <li key={company.name} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{company.name}</p>
                  {company.evidence && <p className="text-xs text-muted-foreground">{company.evidence}</p>}
                </div>
                {company.sourceUrl && (
                  <a
                    href={company.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    Fuente
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </SurfaceCard>
  );
}
