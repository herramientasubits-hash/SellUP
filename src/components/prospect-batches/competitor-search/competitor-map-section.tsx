import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SurfaceCard } from '@/components/shared/surface-card';
// Server component: la bandera sale del helper SIN 'use client' (ver corporate-tree-batch-sections).
import { getFlagEmoji } from '@/components/prospect-batches/candidate-detail-helpers';
import { ChevronDown, Target } from '@/icons';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import {
  COMPETITOR_MAP_STATE_LABELS,
  describeCompetitorMapHeadline,
  type CompetitorMapState,
} from '@/modules/prospect-batches/competitor-search/competitor-map';
import { loadCompetitorMap } from '@/server/prospect-batches/competitor-search/competitor-map.server';

const STATE_TONE: Record<CompetitorMapState, 'positive' | 'brand' | 'neutral' | 'warning' | 'info'> = {
  ubits_customer: 'positive',
  in_hubspot: 'info',
  approved: 'brand',
  in_review: 'warning',
  small: 'neutral',
  not_competitor: 'neutral',
};

/**
 * Agente 1 · «Competidores de una empresa» — el mapa de la referencia: todas sus
 * búsquedas (cada país), sin repetir, y cuáles ya son clientes de UBITS. De sólo
 * lectura. Sin datos (o si la lectura falla) no se pinta.
 */
export async function CompetitorMapSection({ reference }: { reference: Pick<CompetitorReference, 'name' | 'domain'> }) {
  const supabase = await createClient();
  const map = await loadCompetitorMap(supabase as unknown as SupabaseClient, reference);
  if (!map || map.competitors === 0) return null;
  const headline = describeCompetitorMapHeadline(reference.name, map);
  const countryNames = LATAM_COUNTRIES.filter((c) => map.countryCodes.includes(c.code)).map((c) => c.name);

  return (
    <SurfaceCard>
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="group/map h-auto w-full justify-between gap-3 whitespace-normal px-0 py-0 text-left hover:bg-transparent"
            />
          }
        >
          <span className="flex min-w-0 items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2">
              <Target className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">
                Mapa de competidores de {reference.name}{' '}
                <span className="font-normal text-muted-foreground">({map.competitors})</span>
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                {headline ?? 'Ninguna de sus competidoras es cliente de UBITS todavía.'}{' '}
                {countryNames.length > 0 ? `Buscado en ${countryNames.join(', ')}.` : ''}
              </span>
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="shrink-0 text-muted-foreground transition-transform group-aria-expanded/map:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
            {map.entries.map((entry) => (
              <li key={entry.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={entry.name}>
                  {entry.countryCodes.map((code) => getFlagEmoji(code)).join(' ')} {entry.name}
                  {entry.domain && <span className="text-muted-foreground"> · {entry.domain}</span>}
                </p>
                <Badge variant={STATE_TONE[entry.state]}>{COMPETITOR_MAP_STATE_LABELS[entry.state]}</Badge>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </SurfaceCard>
  );
}
