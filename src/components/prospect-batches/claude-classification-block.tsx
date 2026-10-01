'use client';

import * as React from 'react';
import { Sparkles, AlertTriangle, ExternalLink } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import type { ClaudeClassificationDisplay } from './claude-classification-display';

const TONE_CLASSES: Record<ClaudeClassificationDisplay['outcomeTone'], string> = {
  positive: 'bg-su-brand-soft text-su-brand',
  partial: 'bg-warning/10 text-warning',
  neutral: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
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
        className="inline-flex items-center gap-1 rounded-md text-xs text-su-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {hostOf(sourceUrl)}
        <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-xs text-muted-foreground">{verificationLabel}</p>
    </div>
  );
}

export function ClaudeClassificationBlock({ display }: { display: ClaudeClassificationDisplay }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Sugerencia de Claude" />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`border-0 text-xs font-semibold ${TONE_CLASSES[display.outcomeTone]}`}>
            <Sparkles className="mr-1 h-3 w-3" />
            {display.outcomeLabel}
          </Badge>
          {display.notOperatingCompany && (
            <Badge className="border-0 bg-warning/10 text-xs font-semibold text-warning">
              <AlertTriangle className="mr-1 h-3 w-3" />
              El sitio no parece ser la empresa
            </Badge>
          )}
        </div>

        {display.sector && (
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Sector sugerido</p>
            <p className="text-xs leading-snug text-foreground/90">
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
            <p className="text-xs leading-snug text-foreground/90">{display.employeeRange.label}</p>
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
              className="inline-flex items-center gap-1 rounded-md text-xs text-su-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {display.linkedin.url.replace(/^https:\/\/(www\.)?/, '')}
              <ExternalLink className="h-3 w-3" />
            </a>
            <p className="text-xs text-muted-foreground">{display.linkedin.sourceLabel}</p>
          </div>
        )}

        <div className="rounded-md border border-border/50 bg-surface-subtle px-3 py-2">
          <p className="text-xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground/70">Sólo es una sugerencia.</span> No cambia el estado del
            candidato; verifica la fuente antes de decidir.
            {display.rejectedCount > 0 && ` Se descartaron ${display.rejectedCount} dato(s) sin fuente verificable.`}
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}
