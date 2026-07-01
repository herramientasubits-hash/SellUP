// Pure helper — derives empty-state copy from an Apollo enrichment result.
// No React, no network. Safe to import from unit tests.

import type { ApolloEnrichmentUiResult } from './contact-enrichment-chat-types';

export type ApolloEmptyStateCase = 'guardrail_blocked' | 'all_filtered' | 'no_results';

export interface ApolloEmptyStateCopy {
  case: ApolloEmptyStateCase;
  headline: string;
  detail: string;
  notAnError: string;
  tips: string[];
}

export function getContactEnrichmentEmptyStateCopy(
  result: Pick<
    ApolloEnrichmentUiResult,
    | 'rawResultsCount'
    | 'rejectedByRelevance'
    | 'candidatesCreated'
    | 'searchGuardrail'
    | 'noActionableContactsFound'
    | 'noReviewableContactsFound'
  >,
): ApolloEmptyStateCopy {
  // Case C — search stopped by budget guardrail
  if (result.searchGuardrail?.blocked_by_search_budget) {
    return {
      case: 'guardrail_blocked',
      headline: 'Búsqueda detenida por control de créditos',
      detail:
        'La búsqueda se detuvo antes de seguir consumiendo presupuesto Apollo. Es posible que haya más perfiles que no se evaluaron.',
      notAnError:
        'No fue un error. No se crearon contactos ni candidatos, y no se ejecutó completion.',
      tips: [
        'Puedes reintentar con un dominio de empresa más preciso.',
        'Revisa que el país esté bien configurado en la cuenta.',
        'Si ya conoces al decisor, crea el contacto manualmente.',
      ],
    };
  }

  // Case B — Apollo returned profiles but all were filtered
  if (result.rawResultsCount > 0 && result.candidatesCreated === 0) {
    return {
      case: 'all_filtered',
      headline: 'Perfiles encontrados, pero ninguno pasó los filtros de calidad',
      detail:
        'Apollo devolvió perfiles, pero SellUp los descartó porque no tenían suficiente información accionable (email, LinkedIn o teléfono) o no eran relevantes para venta consultiva B2B.',
      notAnError:
        'No fue un error. No se crearon contactos ni candidatos, y no se gastaron créditos de completion.',
      tips: [
        'Verifica que el dominio de la empresa esté correcto.',
        'Intenta con el nombre legal o comercial más preciso.',
        'Revisa que el país esté bien configurado en la cuenta.',
        'Si ya conoces al decisor, crea el contacto manualmente.',
      ],
    };
  }

  // Case A — Apollo returned 0 profiles
  return {
    case: 'no_results',
    headline: 'Apollo no devolvió perfiles para esta búsqueda',
    detail:
      'No se encontraron perfiles con los criterios actuales de la empresa. Esto puede ocurrir cuando el dominio no está indexado, la empresa es muy pequeña o los filtros de búsqueda son muy restrictivos.',
    notAnError:
      'No fue un error. No se crearon contactos ni candidatos, y no se ejecutó completion ni se sincronizó nada a HubSpot.',
    tips: [
      'Verifica que el dominio de la empresa esté correcto.',
      'Intenta con el nombre legal o comercial más preciso.',
      'Revisa el país configurado en la cuenta.',
      'Si ya conoces al decisor, crea el contacto manualmente.',
    ],
  };
}
