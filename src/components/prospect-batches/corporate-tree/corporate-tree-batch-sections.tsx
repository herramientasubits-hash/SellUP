import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SurfaceCard } from '@/components/shared/surface-card';
// Server component: la bandera sale del helper SIN 'use client' (el de cuentas es de
// cliente y llamarlo aquí rompía la página del lote en Producción, 14-10).
import { getFlagEmoji } from '@/components/prospect-batches/candidate-detail-helpers';
import { ChevronDown, ExternalLink, GitBranch } from '@/icons';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  groupBatchCandidatesByTreeRelation,
  readCorporateTreeBatchSummary,
  type CorporateTreeBatchCandidateInput,
  type CorporateTreeBatchRelationship,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';

/**
 * Agente 1 · Búsqueda en árbol — el lote agrupado por rama (AGENT1-CORPORATE-TREE-1).
 *
 * Va sobre la tabla de siempre, que sigue mostrando todas las filas con sus
 * acciones: esto sólo cuenta a qué rama pertenece cada empresa y en qué quedó
 * (por revisar, ya en HubSpot, descartada…). No renderiza nada en lotes que no
 * vienen del árbol.
 */
export function CorporateTreeBatchSections({
  batchMetadata,
  candidates,
  relationships = [],
}: {
  batchMetadata: unknown;
  candidates: readonly CorporateTreeBatchCandidateInput[];
  relationships?: readonly CorporateTreeBatchRelationship[];
}) {
  const summary = readCorporateTreeBatchSummary(batchMetadata);
  if (!summary) return null;
  const groups = groupBatchCandidatesByTreeRelation(candidates, relationships);
  const countryNames = LATAM_COUNTRIES.filter((c) => summary.countryCodes.includes(c.code)).map((c) => c.name);

  return (
    <SurfaceCard>
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">Árbol de {summary.rootName}</p>
          <p className="text-xs text-muted-foreground">
            {countryNames.length === LATAM_COUNTRIES.length
              ? 'Buscado en todos los países.'
              : countryNames.length > 0
                ? `Buscado en ${countryNames.join(', ')}.`
                : null}{' '}
            Las que ya estaban en HubSpot o en SellUp quedan aquí como referencia: no entran a revisión. Las que
            no tienen web esperan en «Descartadas» mientras el rescate se la busca.
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna empresa de este lote quedó marcada con su rama.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <Collapsible key={group.relation} defaultOpen>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/tree h-auto w-full justify-between whitespace-normal px-2 py-1.5 text-left"
                  />
                }
              >
                <span className="text-sm font-semibold text-foreground">
                  {group.label} <span className="font-normal text-muted-foreground">({group.items.length})</span>
                </span>
                <ChevronDown
                  aria-hidden
                  className="text-muted-foreground transition-transform group-aria-expanded/tree:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-1 flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {item.countryCode ? `${getFlagEmoji(item.countryCode)} ` : ''}
                          {item.name}
                        </p>
                        {item.relationDetail && <p className="text-xs text-muted-foreground">{item.relationDetail}</p>}
                        {item.groupWebsite && (
                          <p className="text-xs text-muted-foreground">Web del grupo: {item.groupWebsite}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={item.statusTone}>{item.statusLabel}</Badge>
                        {item.evidenceUrl && (
                          <a
                            href={item.evidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            Fuente
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
