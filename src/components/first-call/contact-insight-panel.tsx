'use client';

import type * as React from 'react';
/**
 * «Sobre {decisor}»: lo que la investigación del decisor encontró (dueña 18-10), en
 * una pestaña de la tarjeta. Primero el gancho, luego cada dato con su fuente y su
 * tipo, las prioridades probables (hipótesis) y lo que no se pudo confirmar.
 */

import { ExternalLink, Info, Lightbulb, Target } from '@/icons';
import { Badge } from '@/components/ui/badge';
import {
  CONTACT_FACT_CATEGORIES,
  CONTACT_FACT_CATEGORY_LABELS,
  type ContactInsight,
  type ResearchFact,
} from '@/server/agents/first-call/types';

const LEADS_LABEL: Readonly<Record<ContactInsight['leadsTraining'], string | null>> = {
  yes: 'Las fuentes muestran que lleva la formación o el talento.',
  no: 'Las fuentes indican que NO lleva la formación: pídele a quién dirigirte.',
  unknown: null,
};

/** Los datos del decisor que vienen de una fuente (no el nombre y cargo de SellUp). */
export function contactFactsOf(facts: readonly ResearchFact[] | undefined): ResearchFact[] {
  const order = (f: ResearchFact) => (f.category ? CONTACT_FACT_CATEGORIES.indexOf(f.category) : CONTACT_FACT_CATEGORIES.length);
  return (facts ?? []).filter((f) => f.topic === 'decision_maker' && f.sourceKind !== 'sellup').sort((a, b) => order(a) - order(b));
}

export function ContactInsightPanel({
  facts,
  insight,
  unknownsSlot,
}: {
  facts: readonly ResearchFact[];
  insight: ContactInsight | undefined;
  /** «Lo que no pudimos confirmar» con campos para responder (si no, sólo la lista). */
  unknownsSlot?: React.ReactNode;
}) {
  const leads = insight ? LEADS_LABEL[insight.leadsTraining] : null;
  return (
    <div className="space-y-4" data-testid="pack-about-contact">
      {insight?.hook && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Target className="size-3.5" aria-hidden="true" />
            El mejor motivo para escribirle
          </p>
          <p className="mt-1 text-sm text-foreground">{insight.hook}</p>
        </div>
      )}

      {facts.length > 0 ? (
        <ul className="space-y-3">
          {facts.map((fact) => (
            <li key={fact.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {fact.category && <Badge variant="outline">{CONTACT_FACT_CATEGORY_LABELS[fact.category]}</Badge>}
                {fact.publishedOn && <span className="text-xs text-muted-foreground tabular-nums">{fact.publishedOn}</span>}
              </div>
              <p className="text-sm text-foreground">{fact.statement}</p>
              {fact.sourceUrl ? (
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {fact.sourceLabel}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">{fact.sourceLabel}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No encontramos información profesional pública de esta persona que se pueda comprobar.</p>
      )}

      {leads && <p className="text-xs text-muted-foreground">{leads}</p>}

      {insight && insight.priorities.length > 0 && (
        <section className="space-y-1.5">
          <h5 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Lightbulb className="size-3.5 text-warning" aria-hidden="true" />
            Prioridades probables · hipótesis
          </h5>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {insight.priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {(unknownsSlot || (insight && insight.unknowns.length > 0)) && (
        <section className="space-y-1.5">
          <h5 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
            Lo que no pudimos confirmar
          </h5>
          {unknownsSlot ?? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {insight!.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
