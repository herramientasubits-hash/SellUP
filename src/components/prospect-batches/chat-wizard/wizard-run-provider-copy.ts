/**
 * wizard-run-provider-copy.ts — copy de la superficie «Proveedor de esta corrida».
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2, § 4, § 5 y § 10.
 *
 * Puro y sin DOM: se testea sin navegador. No lee flags, no lee env, no conoce
 * roles. Recibe los topes YA RESUELTOS por el servidor y los redacta.
 *
 * Dos reglas gobiernan este módulo:
 *
 *   1. Los números vienen de la configuración efectiva, nunca escritos a mano.
 *      Un `12` literal en el copy es la forma habitual de prometer un techo que
 *      el código dejó de aplicar hace tres commits.
 *   2. Un tope se anuncia como TECHO, no como consumo. «12 créditos internos»
 *      leído como «esto cuesta 12» es una promesa de gasto que la corrida no
 *      tiene por qué cumplir: puede parar en la ronda 1 y gastar la mitad.
 */

import type { ProviderResolutionReason } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-selection';
import type {
  ApolloRunModeLimits,
  WizardRunSelectableProvider,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';

// Reexportado para que la capa de componentes tenga un único punto de import del
// copy y sus tipos. La definición vive en la capa de módulos: la produce el
// servidor (§ 5) y un resolutor server-side no puede importar de un `'use client'`.
export type { ApolloRunModeLimits };

// ─── Sección administrativa ───────────────────────────────────────────────────

export const RUN_PROVIDER_SECTION_TITLE = 'Proveedor de esta corrida';

export const RUN_PROVIDER_OPTION_LABELS: Record<WizardRunSelectableProvider, string> = {
  tavily: 'Tavily',
  apollo_organizations: 'Apollo — dos rondas',
};

/**
 * § 4 — explicación cuando el override está activo pero Apollo no se puede
 * ofrecer.
 *
 * Sanitizada a propósito: no nombra la variable apagada ni su valor. Un
 * administrador necesita saber que no puede usar Apollo ahora; no necesita saber
 * cuál de los tres candados lo impide, y publicarlo convertiría esta pantalla en
 * un lector de flags.
 */
export const APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE =
  'Apollo no está disponible para esta ejecución.';

// ─── Numerales en prosa ───────────────────────────────────────────────────────
//
// El objetivo del hito es 5 y su tope absoluto también es 5, así que el rango
// real es 0–5. Fuera de él se usa el dígito: es peor una palabra inventada que
// un número.

const SPANISH_NUMERALS: Record<number, string> = {
  0: 'cero',
  1: 'una',
  2: 'dos',
  3: 'tres',
  4: 'cuatro',
  5: 'cinco',
};

function spellCount(value: number): string {
  return SPANISH_NUMERALS[value] ?? String(value);
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

// ─── Topes efectivos de la modalidad de dos rondas ────────────────────────────

export type ApolloRunModeCopy = {
  headline: string;
  limitsTitle: string;
  limits: readonly string[];
  caveats: readonly string[];
};

export const APOLLO_RUN_MODE_LIMITS_TITLE = 'Máximos de esta ejecución:';

export const APOLLO_RUN_MODE_NO_GUARANTEE_PREFIX = 'No se garantiza encontrar';
export const APOLLO_RUN_MODE_FILTERS_CAVEAT =
  'Los filtros de calidad y duplicados no se reducirán para alcanzar el objetivo.';

/**
 * § 5 — copy del modo Apollo.
 *
 * `hasta` aparece en el titular y en la línea de créditos porque son las dos
 * cifras que un lector convierte en compromiso: cuántas empresas va a traer y
 * cuánto va a costar. Ninguna de las dos está garantizada.
 */
export function buildApolloRunModeCopy(limits: ApolloRunModeLimits): ApolloRunModeCopy {
  const rounds = limits.maxRounds;

  return {
    headline: `Apollo intentará encontrar hasta ${limits.targetEligibleCompanies} ${pluralize(
      limits.targetEligibleCompanies,
      'empresa nueva y válida',
      'empresas nuevas y válidas',
    )} mediante un máximo de ${rounds} ${pluralize(rounds, 'ronda', 'rondas')}.`,
    limitsTitle: APOLLO_RUN_MODE_LIMITS_TITLE,
    limits: [
      `${limits.maxResultsPerRound} ${pluralize(limits.maxResultsPerRound, 'resultado', 'resultados')} por ronda`,
      `${limits.maxRawResultsPerRun} ${pluralize(limits.maxRawResultsPerRun, 'resultado', 'resultados')} raw en total`,
      `${limits.maxEnrichmentsPerRun} ${pluralize(limits.maxEnrichmentsPerRun, 'enrichment', 'enrichments')}`,
      // El techo, explícito como techo. Nunca «se consumirán N».
      `Hasta ${limits.maxInternalCredits} ${pluralize(limits.maxInternalCredits, 'crédito interno', 'créditos internos')}`,
    ],
    caveats: [
      `${APOLLO_RUN_MODE_NO_GUARANTEE_PREFIX} ${spellCount(limits.targetEligibleCompanies)} ${pluralize(
        limits.targetEligibleCompanies,
        'empresa',
        'empresas',
      )}.`,
      APOLLO_RUN_MODE_FILTERS_CAVEAT,
    ],
  };
}

// ─── § 10 · aviso cuando lo pedido y lo resuelto no coinciden ─────────────────

/**
 * Nota sanitizada para un desacuerdo entre petición y resolución.
 *
 * Devuelve `null` cuando no hay nada que explicar. Los motivos que implican «no
 * se pudo usar Apollo» comparten un único mensaje: distinguirlos revelaría qué
 * candado está puesto, y los tres son igual de definitivos para el usuario.
 */
export function describeProviderResolutionMismatch(input: {
  requested: WizardRunSelectableProvider | null;
  resolved: WizardRunSelectableProvider;
  reason: ProviderResolutionReason;
}): string | null {
  if (input.reason === 'preserved_from_previous_attempt') {
    return 'Se conservó el proveedor del intento anterior de esta corrida.';
  }

  // Sin petición, o petición honrada: la fila del proveedor ya lo dice todo.
  if (input.requested === null || input.requested === input.resolved) return null;

  return APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE;
}
