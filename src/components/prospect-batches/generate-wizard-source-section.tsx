'use client';

/**
 * Generation Source Section — Q3F-5BB.3C
 *
 * Lives INSIDE the real "Generar con IA" wizard (see `generate-ai-batch-drawer`).
 * Lets the user pick the generation source without leaving the wizard:
 *   - "Búsqueda con IA": the existing, unchanged wizard body (`iaContent`).
 *   - "Lusha (previsualización)": the read-only Lusha preview (`LushaPreviewPanel`).
 *
 * The standalone "Previsualizar en Lusha" action was removed; Lusha is now a
 * source WITHIN the wizard, not a separate module.
 *
 * Safety (inherited from `LushaPreviewPanel`, unchanged):
 *   - NO auto-run: Lusha only fires on the explicit button click inside the panel.
 *     Switching the source tab does NOT call Lusha.
 *   - Read-only: no persistence CTA (no create, no save, no send-to-review, no
 *     external integrations). page/size/credit guardrails live server-side.
 *   - Human labels (Colombia, Salud, Hospitals & Clinics) come from the panel.
 *
 * Isolated in its own file (imports only `LushaPreviewPanel` + UI primitives) so
 * its module graph stays light and unit-testable without the drawer/portal.
 */

import * as React from 'react';
import { Sparkles, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  LushaPreviewPanel,
  type RunLushaPreview,
} from '@/components/prospect-batches/lusha-preview-drawer';

// ── Copy (exportado para tests de contrato de UI) ─────────────────────────────

export const GENERATION_SOURCE_SECTION_TITLE = 'Fuente de generación';
export const GENERATION_SOURCE_SECTION_DESCRIPTION =
  'Elige cómo explorar empresas. La búsqueda con IA genera candidatas para revisión; Lusha solo previsualiza (nada se guarda todavía).';
export const GENERATION_SOURCE_IA_LABEL = 'Búsqueda con IA';
export const GENERATION_SOURCE_LUSHA_LABEL = 'Lusha (previsualización)';
export const LUSHA_WIZARD_SECTION_TITLE = 'Previsualización Lusha';
export const LUSHA_WIZARD_SECTION_DESCRIPTION =
  'Consulta empresas reales en Lusha antes de guardar resultados. Nada se guarda todavía.';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GenerationSource = 'ia' | 'lusha';

export interface GenerationSourceSectionProps {
  /** Currently selected source. */
  source: GenerationSource;
  /** Called when the user switches source tabs. */
  onSourceChange: (next: GenerationSource) => void;
  /** The existing IA wizard body, rendered when source === 'ia'. */
  iaContent: React.ReactNode;
  /** Disables the switch (e.g. while an IA generation is running). */
  disabled?: boolean;
  /**
   * Inyectable para tests. Reenviado a `LushaPreviewPanel`. Por defecto el panel
   * usa la server action real (`previewLushaCompaniesAction`).
   */
  runLushaPreview?: RunLushaPreview;
}

// ── Source tab ────────────────────────────────────────────────────────────────

interface SourceTabProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}

function SourceTab({ active, disabled, onClick, icon, label, testId }: SourceTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'border-su-brand bg-su-brand-soft text-su-brand'
          : 'border-border text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function GenerationSourceSection({
  source,
  onSourceChange,
  iaContent,
  disabled = false,
  runLushaPreview,
}: GenerationSourceSectionProps) {
  return (
    <div className="space-y-6" data-testid="generation-source-section">
      <SurfaceCard>
        <SurfaceCardHeader
          title={GENERATION_SOURCE_SECTION_TITLE}
          description={GENERATION_SOURCE_SECTION_DESCRIPTION}
        />
        <div role="tablist" aria-label={GENERATION_SOURCE_SECTION_TITLE} className="grid grid-cols-2 gap-2">
          <SourceTab
            active={source === 'ia'}
            disabled={disabled}
            onClick={() => onSourceChange('ia')}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={GENERATION_SOURCE_IA_LABEL}
            testId="generation-source-ia"
          />
          <SourceTab
            active={source === 'lusha'}
            disabled={disabled}
            onClick={() => onSourceChange('lusha')}
            icon={<Search className="h-3.5 w-3.5" />}
            label={GENERATION_SOURCE_LUSHA_LABEL}
            testId="generation-source-lusha"
          />
        </div>
      </SurfaceCard>

      {source === 'lusha' ? (
        <div className="space-y-4" data-testid="generation-source-lusha-panel">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{LUSHA_WIZARD_SECTION_TITLE}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {LUSHA_WIZARD_SECTION_DESCRIPTION}
            </p>
          </div>
          <LushaPreviewPanel runPreview={runLushaPreview} />
        </div>
      ) : (
        iaContent
      )}
    </div>
  );
}
