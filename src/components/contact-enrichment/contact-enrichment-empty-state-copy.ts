// Pure helper — derives empty-state copy from an Apollo/Lusha enrichment
// result. No React, no network. Safe to import from unit tests.

import type { ApolloEnrichmentUiResult, LushaEnrichmentUiResult } from './contact-enrichment-chat-types';

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
    | 'completionAttempted'
  > & {
    actualCreditsTotal?: number;
  },
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
    const attempted = result.completionAttempted ?? 0;
    const credits = result.actualCreditsTotal ?? 0;
    const hadCompletion = attempted > 0 || credits > 0;

    const notAnError = hadCompletion
      ? `No fue un error. No se crearon contactos ni candidatos. Se intentó completion en ${attempted} perfil${attempted !== 1 ? 'es' : ''} y se consumieron ${credits} crédito${credits !== 1 ? 's' : ''}, pero Apollo no devolvió canales accionables.`
      : 'No fue un error. No se crearon contactos ni candidatos, y no se gastaron créditos de completion.';

    return {
      case: 'all_filtered',
      headline: 'Perfiles encontrados, pero ninguno pasó los filtros de calidad',
      detail:
        'Apollo devolvió perfiles, pero SellUp los descartó porque no tenían suficiente información accionable (email, LinkedIn o teléfono) o no eran relevantes para venta consultiva B2B.',
      notAnError,
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

// ── Lusha empty-after-filtering copy (Hito 17B.4X.7C.3D) ───────────────────
//
// Distinguishes "Lusha ran successfully but every raw result was filtered
// out by relevance/company-consistency checks" from a real
// unavailable/no-credentials/provider-error state. This helper is only
// called once the caller has already ruled out those real-error branches.

export type LushaEmptyStateCase = 'all_filtered' | 'no_results';

export interface LushaEmptyStateCopy {
  case: LushaEmptyStateCase;
  headline: string;
  detail: string;
  notAnError: string;
}

export function getLushaEmptyStateCopy(
  result: Pick<LushaEnrichmentUiResult, 'rawResultsCount' | 'creditsUsed'>,
): LushaEmptyStateCopy {
  // Case B — Lusha returned raw profiles, but all were filtered
  if (result.rawResultsCount > 0) {
    return {
      case: 'all_filtered',
      headline: 'Lusha no encontró contactos relevantes',
      detail:
        'Lusha ejecutó la búsqueda correctamente, pero los perfiles encontrados no pasaron los filtros de relevancia o consistencia con la empresa.',
      notAnError:
        'No fue un error. No se crearon candidatos, no se sincronizó nada a HubSpot y no se revelaron teléfonos.',
    };
  }

  // Case A — Lusha returned 0 raw profiles
  return {
    case: 'no_results',
    headline: 'Lusha no devolvió perfiles para esta búsqueda',
    detail:
      'No se encontraron perfiles con los criterios actuales de la empresa en Lusha.',
    notAnError:
      'No fue un error. No se crearon candidatos, no se sincronizó nada a HubSpot y no se revelaron teléfonos.',
  };
}
