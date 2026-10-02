'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState } from 'react';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { AutomationModeControl } from './automation-mode-control';
import {
  EXECUTION_MODE_LABELS,
  EXECUTION_MODE_DESCRIPTIONS,
  CATEGORY_LABELS,
  type SystemAutomation,
  type AutomationExecutionMode,
} from '@/modules/automations/types';
import { Heading } from '@/components/typography';

function ExecutionModeBadge({ mode }: { mode: AutomationExecutionMode }) {
  const variants: Record<AutomationExecutionMode, 'neutral' | 'brand' | 'positive'> = {
    manual: 'neutral',
    suggested: 'brand',
    automatic: 'positive',
  };
  const dotStyles: Record<AutomationExecutionMode, string> = {
    manual: 'bg-muted-foreground',
    suggested: 'bg-primary',
    automatic: 'bg-success',
  };

  return (
    <Badge variant={variants[mode]}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[mode]}`} aria-hidden="true" />
      {EXECUTION_MODE_LABELS[mode]}
    </Badge>
  );
}

function DependencyTag({ label, active }: { label: string; active: boolean }) {
  if (!active) return null;
  return (
    <Badge variant="neutral">{label}</Badge>
  );
}

export function AutomationCard({ automation }: { automation: SystemAutomation }) {
  const [displayMode, setDisplayMode] = useState<AutomationExecutionMode>(
    automation.execution_mode
  );

  const hasDependencies =
    automation.requires_ai_provider ||
    automation.requires_prospecting_provider ||
    automation.requires_hubspot;

  return (
    <SurfaceCard>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {CATEGORY_LABELS[automation.category] ?? automation.category}
            </span>
            <ExecutionModeBadge mode={displayMode} />
          </div>

          <Heading level={6} as="h3">{automation.name}</Heading>

          {automation.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {automation.description}
            </p>
          )}

          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Trigger:
            </span>
            <code className="min-w-0 break-all rounded-sm bg-surface-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
              {automation.trigger_key}
            </code>
          </div>

          {hasDependencies && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                Requiere:
              </span>
              <DependencyTag label="Proveedor IA" active={automation.requires_ai_provider} />
              <DependencyTag label="Enriquecimiento" active={automation.requires_prospecting_provider} />
              <DependencyTag label="HubSpot" active={automation.requires_hubspot} />
            </div>
          )}

          <p className="text-xs italic text-muted-foreground">
            {EXECUTION_MODE_DESCRIPTIONS[displayMode]}
          </p>
        </div>

        {/* Control */}
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <AutomationModeControl
            automationId={automation.id}
            automationName={automation.name}
            currentMode={displayMode}
            onModeChange={setDisplayMode}
          />
          {automation.updated_at && (
            <span className="text-xs tabular-nums text-muted-foreground">
              Actualizado{' '}
              {formatInAppZone(automation.updated_at, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }, 'es-ES')}
            </span>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
