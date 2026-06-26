// Agente 2A — Wizard UI Types
// Hito 17A.1

import type { CompanyCandidate, ContactEnrichmentRunResult } from '@/modules/contact-enrichment/types';

export type WizardStep =
  | 'search'       // Input de empresa
  | 'resolving'    // Buscando...
  | 'candidates'   // Mostrar candidatos (múltiples)
  | 'confirm'      // Confirmar empresa seleccionada
  | 'starting'     // Creando run...
  | 'done'         // Run creado exitosamente
  | 'error';       // Error controlado

export interface WizardState {
  step: WizardStep;
  query: string;
  candidates: CompanyCandidate[];
  selectedCandidate: CompanyCandidate | null;
  skippedHubSpot: boolean;
  runResult: ContactEnrichmentRunResult | null;
  errorMessage: string | null;
}
