/**
 * A1-APOLLO-WIZARD-1 — Presentación del resultado de un proveedor en el wizard.
 *
 * Puro y sin DOM, para poder testearlo sin entorno de navegador. No crea una
 * pantalla paralela: produce los campos que la superficie existente del wizard
 * ya sabe pintar, con el mismo lenguaje que los demás proveedores modernos.
 *
 * Regla que gobierna este módulo: no afirmar «0 créditos» antes de haber
 * recibido y procesado la respuesta. Mientras el consumo no esté resuelto, el
 * valor es DESCONOCIDO y se muestra como tal. Un cero fabricado es una promesa
 * de gasto que el sistema no puede sostener.
 */

import type { WizardApolloSkipReason } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-availability';
import type {
  WizardIndicatorProviderKey,
  WizardProviderIndicator,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';

// ─── Indicador de proveedor de búsqueda ───────────────────────────────────────

/**
 * A1-APOLLO-WIZARD-1 — etiqueta discreta del proveedor que correrá la búsqueda.
 *
 * Nombres comerciales, nunca claves técnicas: el usuario lee «Apollo», no
 * `apollo_organizations`. No revela flags, roles, credenciales, variables de
 * entorno ni el motivo técnico de una omisión.
 */
export const PROVIDER_INDICATOR_PREFIX = 'Proveedor de búsqueda';

/** Copy del estado sin resolver. Misma altura que la fila resuelta. */
export const PROVIDER_INDICATOR_UNRESOLVED_VALUE = 'por definir';

/** Copy del estado no disponible sin proveedor nombrable. */
export const PROVIDER_INDICATOR_UNAVAILABLE_VALUE = 'no disponible';

/** Aviso funcional cuando hay proveedor nombrado pero no ejecutable. */
export const PROVIDER_INDICATOR_UNAVAILABLE_NOTICE = 'no disponible en este momento';

const PROVIDER_DISPLAY_NAMES: Record<WizardIndicatorProviderKey, string> = {
  tavily: 'Tavily',
  apollo_organizations: 'Apollo',
  lusha: 'Lusha',
};

export type ProviderIndicatorPresentation = {
  /** Prefijo fijo, siempre visible. */
  prefix: string;
  /** Nombre comercial, o el copy del estado cuando no hay proveedor nombrable. */
  value: string;
  /** Aviso funcional adicional, sin detalle técnico. `null` cuando no aplica. */
  notice: string | null;
  /** Texto completo de una sola línea, listo para leer. */
  label: string;
};

export function presentProviderIndicator(
  indicator: WizardProviderIndicator,
): ProviderIndicatorPresentation {
  const value =
    indicator.provider !== null
      ? PROVIDER_DISPLAY_NAMES[indicator.provider]
      : indicator.status === 'unavailable'
        ? PROVIDER_INDICATOR_UNAVAILABLE_VALUE
        : PROVIDER_INDICATOR_UNRESOLVED_VALUE;

  // El aviso sólo acompaña a un proveedor nombrado: cuando el valor ya dice «no
  // disponible», repetirlo no agrega información y sí agrega ruido.
  const notice =
    indicator.status === 'unavailable' && indicator.provider !== null
      ? PROVIDER_INDICATOR_UNAVAILABLE_NOTICE
      : null;

  return {
    prefix: PROVIDER_INDICATOR_PREFIX,
    value,
    notice,
    label: notice
      ? `${PROVIDER_INDICATOR_PREFIX}: ${value} · ${notice}`
      : `${PROVIDER_INDICATOR_PREFIX}: ${value}`,
  };
}

// ─── Estado de disponibilidad ─────────────────────────────────────────────────

export type ProviderAvailabilityTone = 'unavailable' | 'disabled' | 'blocked';

export type ProviderSkipPresentation = {
  tone: ProviderAvailabilityTone;
  title: string;
  detail: string;
  /** Si ofrecer reintento. Un flag apagado no se arregla reintentando. */
  canRetry: boolean;
  /** Un proveedor omitido no gastó nada y esto SÍ es un hecho comprobado. */
  creditsStatement: 'no_credits_used';
};

/**
 * Los detalles no revelan qué flag, rol o credencial desbloquearía la ruta.
 * Un estado bloqueado debe ser indistinguible de cualquier otro no disponible.
 */
const SKIP_PRESENTATION: Record<WizardApolloSkipReason, ProviderSkipPresentation> = {
  feature_disabled: {
    tone: 'disabled',
    title: 'Búsqueda no habilitada',
    detail: 'Esta modalidad de búsqueda de empresas no está habilitada.',
    canRetry: false,
    creditsStatement: 'no_credits_used',
  },
  capability_unavailable: {
    tone: 'unavailable',
    title: 'Proveedor no disponible',
    detail: 'El proveedor de búsqueda no está disponible en este momento.',
    canRetry: true,
    creditsStatement: 'no_credits_used',
  },
  role_not_permitted: {
    tone: 'blocked',
    title: 'Búsqueda no disponible',
    detail: 'Esta búsqueda de empresas no está disponible.',
    canRetry: false,
    creditsStatement: 'no_credits_used',
  },
  budget_unavailable: {
    tone: 'blocked',
    title: 'Sin presupuesto disponible',
    detail: 'No hay presupuesto disponible para ejecutar esta búsqueda.',
    canRetry: false,
    creditsStatement: 'no_credits_used',
  },
  provider_not_configured: {
    tone: 'unavailable',
    title: 'Proveedor no disponible',
    detail: 'El proveedor de búsqueda no está disponible en este momento.',
    canRetry: false,
    creditsStatement: 'no_credits_used',
  },
  credential_unavailable: {
    tone: 'unavailable',
    title: 'Proveedor no disponible',
    detail: 'El proveedor de búsqueda no está disponible en este momento.',
    canRetry: false,
    creditsStatement: 'no_credits_used',
  },
  availability_check_failed: {
    tone: 'unavailable',
    title: 'Proveedor no disponible',
    detail: 'No se pudo verificar la disponibilidad del proveedor de búsqueda.',
    canRetry: true,
    creditsStatement: 'no_credits_used',
  },
};

export function presentProviderSkip(
  skipReason: WizardApolloSkipReason,
): ProviderSkipPresentation {
  return SKIP_PRESENTATION[skipReason];
}

// ─── Resumen de una ejecución que sí corrió ───────────────────────────────────

/**
 * Cifras de una ejecución real. Todo campo numérico admite `null` = «todavía no
 * se sabe», que es distinto de `0` = «se sabe que fue cero».
 */
export type ProviderRunSummaryInput = {
  provider: 'apollo_organizations' | 'tavily' | 'lusha';
  /** Techo de candidatos del presupuesto. */
  maxCandidates: number | null;
  /** Techo de créditos del presupuesto. */
  maxCredits: number | null;
  pagesProcessed: number | null;
  /** Estimado tras procesar la respuesta. null mientras no se haya resuelto. */
  estimatedCredits: number | null;
  /** Verificado contra el proveedor. null cuando no es verificable. */
  actualCredits: number | null;
  resultsFound: number | null;
  resultsDiscarded: number | null;
  duplicatesRemoved: number | null;
  /** Categoría del error terminal, si lo hubo. */
  errorCategory: string | null;
  rateLimited: boolean;
  /** Páginas con resultado y cobro indeterminados. */
  indeterminatePages: number[];
};

export type ProviderRunSummaryRow = {
  key: string;
  label: string;
  /** Ya formateado. «Desconocido» cuando el dato no está resuelto. */
  value: string;
};

export type ProviderRunSummaryPresentation = {
  rows: ProviderRunSummaryRow[];
  /** Aviso destacado cuando algo quedó sin resolver. null si todo está claro. */
  warning: string | null;
  /** True cuando el consumo de créditos no puede afirmarse. */
  creditsUncertain: boolean;
};

const UNKNOWN = 'Desconocido';

function formatCount(value: number | null): string {
  return value === null ? UNKNOWN : String(value);
}

/**
 * Construye las filas del resumen.
 *
 * Cuando hay páginas indeterminadas, los créditos se marcan como inciertos:
 * el request salió y la respuesta nunca llegó, así que el proveedor pudo haber
 * cobrado. Decir «0 créditos» ahí sería afirmar algo que no se sabe.
 *
 * NO cableado a ningún componente todavía, y a propósito: `WizardExecutionActionResult`
 * no devuelve ninguna cifra de corrida (páginas, créditos, descartes, duplicados).
 * Cablearlo hoy pintaría una tabla de «Desconocido» y exigiría exponer cifras
 * económicas nuevas del servidor al cliente — decisión de producto/gasto aparte.
 * El indicador de proveedor (`presentProviderIndicator`) y el mensaje de omisión
 * (`presentProviderSkip`) sí están cableados.
 */
export function presentProviderRunSummary(
  input: ProviderRunSummaryInput,
): ProviderRunSummaryPresentation {
  const creditsUncertain =
    input.indeterminatePages.length > 0 ||
    (input.actualCredits === null && input.estimatedCredits === null);

  const creditsValue = creditsUncertain
    ? UNKNOWN
    : input.actualCredits !== null
      ? `${input.actualCredits}`
      : `${input.estimatedCredits} (estimado)`;

  const rows: ProviderRunSummaryRow[] = [
    { key: 'pages_processed', label: 'Páginas procesadas', value: formatCount(input.pagesProcessed) },
    { key: 'results_found', label: 'Resultados encontrados', value: formatCount(input.resultsFound) },
    { key: 'results_discarded', label: 'Resultados descartados', value: formatCount(input.resultsDiscarded) },
    { key: 'duplicates_removed', label: 'Duplicados', value: formatCount(input.duplicatesRemoved) },
    { key: 'credits_used', label: 'Créditos consumidos', value: creditsValue },
    {
      key: 'max_credits',
      label: 'Presupuesto máximo',
      value: input.maxCredits === null ? UNKNOWN : `${input.maxCredits} créditos`,
    },
    {
      key: 'max_candidates',
      label: 'Límite de candidatos',
      value: input.maxCandidates === null ? UNKNOWN : String(input.maxCandidates),
    },
  ];

  let warning: string | null = null;
  if (input.indeterminatePages.length > 0) {
    warning =
      'Una o más páginas quedaron sin confirmar. El consumo de créditos de esta búsqueda no pudo verificarse.';
  } else if (input.rateLimited) {
    warning = 'El proveedor limitó la cantidad de solicitudes. La búsqueda se detuvo antes de completarse.';
  } else if (input.errorCategory) {
    warning = 'La búsqueda se detuvo por un error del proveedor antes de completarse.';
  }

  return { rows, warning, creditsUncertain };
}
