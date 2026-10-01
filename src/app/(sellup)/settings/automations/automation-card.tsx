'use client';

import { useState } from 'react';
import { SurfaceCard } from '@/components/shared/surface-card';
import { AutomationModeControl } from './automation-mode-control';
import {
  EXECUTION_MODE_LABELS,
  EXECUTION_MODE_DESCRIPTIONS,
  CATEGORY_LABELS,
  type SystemAutomation,
  type AutomationExecutionMode,
} from '@/modules/automations/types';

function ExecutionModeBadge({ mode }: { mode: AutomationExecutionMode }) {
  const styles: Record<AutomationExecutionMode, string> = {
    manual: 'border-border/60 bg-surface-subtle text-muted-foreground',
    suggested: 'border-primary/30 bg-primary/10 text-primary',
    automatic: 'border-success/30 bg-success/10 text-success',
  };
  const dotStyles: Record<AutomationExecutionMode, string> = {
    manual: 'bg-muted-foreground/40',
    suggested: 'bg-primary',
    automatic: 'bg-success',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[mode]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[mode]}`} />
      {EXECUTION_MODE_LABELS[mode]}
    </span>
  );
}

function DependencyTag({ label, active }: { label: string; active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-surface-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
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

          <h3 className="text-sm font-semibold text-foreground">{automation.name}</h3>

          {automation.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {automation.description}
            </p>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Trigger:
            </span>
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <AutomationModeControl
            automationId={automation.id}
            automationName={automation.name}
            currentMode={displayMode}
            onModeChange={setDisplayMode}
          />
          {automation.updated_at && (
            <span className="text-xs text-muted-foreground">
              Actualizado{' '}
              {new Date(automation.updated_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
