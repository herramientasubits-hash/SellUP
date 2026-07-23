'use client';

/**
 * Prospect Criteria Section — Q3F-5BB.3D (replaces the Q3F-5BB.3C source tabs)
 *
 * Lives INSIDE the real "Generar con IA" wizard (see `generate-ai-batch-drawer`).
 *
 * WHY THIS EXISTS (product decision, Q3F-5BB.3D):
 *   Q3F-5BB.3C exposed the provider as a visible tab next to the IA search. The
 *   user rejected that: the provider must NOT be a choice or a separate flow. It
 *   is the internal/hidden provider that backs the normal "Empresas por
 *   criterios" search. So there are NO source tabs here — just the normal
 *   criteria form, which runs the provider under the hood when compatible.
 *
 * Behavior:
 *   - Renders the normal "Empresas por criterios" criteria form.
 *   - The internal provider is resolved by `resolveProspectDiscoveryProvider`.
 *     When it resolves to 'lusha', the explicit search runs Lusha (read-only)
 *     and the results show "Fuente usada: Lusha" as traceability only.
 *     When it resolves to 'default_ai', no Lusha call is made and a discreet
 *     note explains the internal provider does not cover those criteria.
 *
 * Safety (inherited from `LushaPreviewPanel`, unchanged):
 *   - NO auto-run: Lusha only fires on the explicit search button click.
 *   - Read-only: no persistence CTA (no create, no save, no send-to-review, no
 *     external integrations). page/size/credit guardrails live server-side.
 *   - Human labels (Colombia, Salud, Hospitals & Clinics) come from the panel.
 */

import * as React from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  LushaPreviewPanel,
  type RunLushaPreview,
} from '@/components/prospect-batches/lusha-preview-drawer';
import { previewLushaCompaniesAction } from '@/modules/prospect-batches/lusha-preview-actions';
import { resolveProspectDiscoveryProvider } from '@/modules/prospect-batches/prospect-discovery-provider';

// ── Copy (exportado para tests de contrato de UI) ─────────────────────────────

export const PROSPECT_CRITERIA_SECTION_TITLE = 'Empresas por criterios';
export const PROSPECT_CRITERIA_SECTION_DESCRIPTION =
  'Configura país, sector y tamaño. SellUp busca empresas candidatas con el proveedor configurado; nada se guarda todavía.';
export const PROSPECT_CRITERIA_RUN_LABEL = 'Buscar empresas';
export const PROSPECT_CRITERIA_LOADING_LABEL = 'Buscando empresas…';
/** Trazabilidad discreta del proveedor interno mostrada en el resultado. */
export const PROSPECT_CRITERIA_PROVIDER_LABEL = 'Lusha';
/** Mostrado cuando los criterios no son compatibles con el proveedor interno. */
export const PROSPECT_CRITERIA_PROVIDER_UNAVAILABLE =
  'Estos criterios no son compatibles con el proveedor de descubrimiento configurado. Ajusta país o sector e inténtalo de nuevo.';

/**
 * Search type canónico de este flujo (companies-by-criteria). En el chat wizard
 * corresponde al modo `exploratory`.
 */
const CRITERIA_SEARCH_TYPE = 'exploratory';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProspectCriteriaSectionProps {
  /**
   * Inyectable para tests. Reenviado a `LushaPreviewPanel`. Por defecto el panel
   * usa la server action real (`previewLushaCompaniesAction`).
   */
  runLushaPreview?: RunLushaPreview;
}

// ── Section ──────────────────────────────────────────────────────────────────

export function ProspectCriteriaSection({ runLushaPreview }: ProspectCriteriaSectionProps) {
  // The real Lusha action (or the injected spy in tests). The panel only calls
  // this from the explicit search button click — never on mount/filter change.
  const realRun: RunLushaPreview = runLushaPreview ?? previewLushaCompaniesAction;

  // Hidden-provider gate: resolve the discovery provider from the live criteria
  // the user submitted. Only when it resolves to 'lusha' do we run Lusha. This
  // is the single execution path — still explicit-click-only.
  const gatedRun = React.useCallback<RunLushaPreview>(
    async (input) => {
      const decision = resolveProspectDiscoveryProvider({
        // Section only mounts when ENABLE_LUSHA_PREVIEW is on (drawer-gated).
        lushaPreviewEnabled: true,
        searchType: CRITERIA_SEARCH_TYPE,
        sectorKey: input.sectorKey,
        countryCode: input.countryCode,
      });
      if (decision.provider !== 'lusha') {
        return { ok: false, status: 'error', error: PROSPECT_CRITERIA_PROVIDER_UNAVAILABLE };
      }
      return realRun(input);
    },
    [realRun],
  );

  return (
    <div className="space-y-6" data-testid="prospect-criteria-section">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{PROSPECT_CRITERIA_SECTION_TITLE}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROSPECT_CRITERIA_SECTION_DESCRIPTION}
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs" data-testid="prospect-criteria-readonly-notice">
          Estos resultados todavía no se guardan en SellUp. Podrás enviar a revisión en un siguiente paso.
        </AlertDescription>
      </Alert>

      <LushaPreviewPanel
        runPreview={gatedRun}
        criteriaDescription="Define país, sector y tamaño para explorar empresas candidatas."
        runLabel={PROSPECT_CRITERIA_RUN_LABEL}
        loadingLabel={PROSPECT_CRITERIA_LOADING_LABEL}
        providerTraceabilityLabel={PROSPECT_CRITERIA_PROVIDER_LABEL}
      />
    </div>
  );
}
