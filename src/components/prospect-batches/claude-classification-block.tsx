'use client';

import * as React from 'react';
import { Sparkles, AlertTriangle, ExternalLink } from "@/icons";
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import type { ClaudeClassificationDisplay } from './claude-classification-display';

const TONE_VARIANT: Record<
  ClaudeClassificationDisplay['outcomeTone'],
  'brand' | 'warning' | 'neutral' | 'negative'
> = {
  positive: 'brand',
  partial: 'warning',
  neutral: 'neutral',
  error: 'negative',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Evidence({ quote, sourceUrl, verificationLabel }: { quote: string; sourceUrl: string; verificationLabel: string }) {
  return (
    <div className="mt-1 space-y-1">
      <blockquote className="border-l-2 border-border pl-2 text-xs italic text-muted-foreground leading-snug">
        “{quote}”
      </blockquote>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex items-center gap-1 rounded-md text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        {hostOf(sourceUrl)}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
      <p className="text-xs text-muted-foreground">{verificationLabel}</p>
    </div>
  );
}

export function ClaudeClassificationBlock({
  display,
  embedded = false,
}: {
  display: ClaudeClassificationDisplay;
  /** Dentro de una sección que ya es tarjeta: sin marco ni título propios. */
  embedded?: boolean;
}) {
  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TONE_VARIANT[display.outcomeTone]}>
          <Sparkles aria-hidden />
          {display.outcomeLabel}
        </Badge>
        {display.notOperatingCompany && (
          <Badge variant="warning">
            <AlertTriangle aria-hidden />
            El sitio no parece ser la empresa
          </Badge>
        )}
      </div>

      {display.sector && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Sector sugerido</p>
          <p className="text-sm leading-snug text-foreground">
            {display.sector.label}
            {display.sector.matchesCurrentIndustry === false && (
              <span className="ml-1.5 text-warning">· distinto al del lote</span>
            )}
            {display.sector.matchesCurrentIndustry === true && (
              <span className="ml-1.5 text-success">· coincide con el lote</span>
            )}
          </p>
          <Evidence {...display.sector} />
        </div>
      )}

      {display.employeeRange && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Tamaño sugerido</p>
          <p className="text-sm leading-snug text-foreground">{display.employeeRange.label}</p>
          <Evidence {...display.employeeRange} />
        </div>
      )}

      {display.linkedin && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">LinkedIn de la empresa</p>
          <a
            href={display.linkedin.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 rounded-md text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {display.linkedin.url.replace(/^https:\/\/(www\.)?/, '')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <p className="text-xs text-muted-foreground">{display.linkedin.sourceLabel}</p>
        </div>
      )}

      <div className="rounded-lg bg-surface-subtle px-3 py-2">
        <p className="text-xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Sólo es una sugerencia.</span> No cambia el estado del
          candidato; verifica la fuente antes de decidir.
          {display.rejectedCount > 0 && ` Se descartaron ${display.rejectedCount} dato(s) sin fuente verificable.`}
        </p>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Sugerencia de Claude" />
      {body}
    </SurfaceCard>
  );
}
