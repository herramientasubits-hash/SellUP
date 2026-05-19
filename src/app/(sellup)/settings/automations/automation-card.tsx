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
    manual: 'border-border/40 bg-muted/40 text-muted-foreground',
    suggested: 'border-su-brand/30 bg-su-brand-soft text-su-brand',
    automatic: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  };
  const dotStyles: Record<AutomationExecutionMode, string> = {
    manual: 'bg-muted-foreground/40',
    suggested: 'bg-su-brand',
    automatic: 'bg-emerald-500',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[mode]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[mode]}`} />
      {EXECUTION_MODE_LABELS[mode]}
    </span>
  );
}

function DependencyTag({ label, active }: { label: string; active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Trigger:
            </span>
            <code className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {automation.trigger_key}
            </code>
          </div>

          {hasDependencies && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Requiere:
              </span>
              <DependencyTag label="Proveedor IA" active={automation.requires_ai_provider} />
              <DependencyTag label="Enriquecimiento" active={automation.requires_prospecting_provider} />
              <DependencyTag label="HubSpot" active={automation.requires_hubspot} />
            </div>
          )}

          <p className="text-[11px] italic text-muted-foreground/60">
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
            <span className="text-[10px] text-muted-foreground/50">
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
