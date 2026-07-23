'use client';

/**
 * Wizard final search step — hidden Lusha provider (Q3F-5BB.3E)
 *
 * Rendered at the END of the CONVERSATIONAL "Generar con IA" wizard, only when
 * the collected criteria resolve to Lusha (see `resolveWizardLushaCriteria`).
 * The conversational chat (país → industria → subindustria → criterio → resumen)
 * is unchanged; this is just the final "Buscar con IA" search surface.
 *
 * Lusha is HIDDEN: the user never chose it. It appears only as result
 * traceability ("Fuente usada: Lusha"). Reuses `LushaPreviewPanel` so ALL the
 * read-only guarantees live in one place:
 *   - NO auto-run: Lusha fires only on the explicit "Buscar con IA" click.
 *   - Read-only: no create / save / send-to-review / external-integration CTA.
 *   - Guardrails (page 0, size 10, ≤1 credit) are server-authoritative.
 *   - Human labels (Colombia, Salud, Hospitals & Clinics) come from the panel.
 * Criteria are locked (already collected conversationally) and shown as a recap.
 */

import * as React from 'react';
import {
  LushaPreviewPanel,
  type RunLushaPreview,
} from '@/components/prospect-batches/lusha-preview-drawer';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';

export const WIZARD_LUSHA_SEARCH_LABEL = 'Buscar con IA';
export const WIZARD_LUSHA_SEARCH_LOADING_LABEL = 'Buscando con IA…';
/** Discreet traceability shown only in results (never a selector). */
export const WIZARD_LUSHA_PROVIDER_LABEL = 'Lusha';

export interface WizardLushaFinalSearchProps {
  /** Read-only Lusha input built from the wizard's collected criteria. */
  input: WizardLushaInput;
  /**
   * Inyectable para tests. Reenviado a `LushaPreviewPanel`. Por defecto el panel
   * usa la server action real (`previewLushaCompaniesAction`).
   */
  runLushaPreview?: RunLushaPreview;
}

export function WizardLushaFinalSearch({ input, runLushaPreview }: WizardLushaFinalSearchProps) {
  return (
    <div data-testid="wizard-lusha-final-search">
      <LushaPreviewPanel
        {...(runLushaPreview ? { runPreview: runLushaPreview } : {})}
        lockCriteria
        initialCountryCode={input.countryCode}
        initialSectorKey={input.sectorKey}
        initialSubIndustryId={input.subIndustryId}
        initialSearchText={input.searchText}
        runLabel={WIZARD_LUSHA_SEARCH_LABEL}
        loadingLabel={WIZARD_LUSHA_SEARCH_LOADING_LABEL}
        providerTraceabilityLabel={WIZARD_LUSHA_PROVIDER_LABEL}
      />
    </div>
  );
}
