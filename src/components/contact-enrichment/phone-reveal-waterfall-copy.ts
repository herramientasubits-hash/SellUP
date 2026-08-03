// Copy puro del waterfall Apollo → Lusha (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
// Sin React, sin red, sin imports de servidor: seguro de importar desde tests
// unitarios y desde el bundle cliente. Lo renderiza
// contact-candidate-detail-sheet.tsx, pero solo cuando
// ENABLE_PHONE_REVEAL_WATERFALL está encendido (apagado en todos los entornos),
// así que hoy ningún operador ve este copy.
//
// Misma convención que lusha-phone-fallback-copy.ts: un `get<X>Copy()` puro por
// concern, y los topes de crédito declarados como constantes de UI para no
// importar módulos de servidor en el cliente. Un test estático verifica que
// coincidan con las constantes del core del waterfall, que es la autoridad real y
// revalida el tope server-side.

/** Botón ÚNICO del waterfall. Mismo label que el reveal Apollo: para el operador
 *  no es una acción nueva, es la misma acción que ahora persiste más. */
export const PHONE_REVEAL_WATERFALL_BUTTON_LABEL = 'Revelar teléfono';

/**
 * Tope cuando el candidato NO tiene identificador Lusha reutilizable: solo Apollo.
 * Espejo de PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS del core.
 */
export const PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS = 8;

/**
 * Tope cuando Lusha es una segunda pata posible: Apollo hasta 8 + Lusha 5.
 * Espejo de PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA del core.
 */
export const PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS = 13;

// ── Estados visibles ───────────────────────────────────────────

/** Apollo en vuelo (primera pata). */
export const PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY = 'Consultando Apollo…';

/** Apollo cerró sin teléfono y la segunda pata está reclamada o en curso. */
export const PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY =
  'Apollo no encontró teléfono, consultando Lusha…';

/** Terminal con teléfono, primera pata. */
export const PHONE_REVEAL_WATERFALL_REVEALED_BY_APOLLO_COPY =
  'Teléfono revelado por Apollo.';

/** Terminal con teléfono, segunda pata. */
export const PHONE_REVEAL_WATERFALL_REVEALED_BY_LUSHA_COPY =
  'Teléfono revelado por Lusha.';

/** Terminal sin teléfono tras las dos patas (o tras Apollo si Lusha no aplicaba). */
export const PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY =
  'Teléfono no disponible tras consultar Apollo y Lusha.';

/** Cierre técnico: no significa "no existe teléfono". */
export const PHONE_REVEAL_WATERFALL_ERROR_COPY =
  'No fue posible completar la revelación de teléfono. Intenta más tarde.';

/** Cierre por privacidad (supresión registrada o no contactar). */
export const PHONE_REVEAL_WATERFALL_BLOCKED_COPY =
  'La revelación se detuvo por una restricción de privacidad registrada para este contacto.';

/** Gate de aprobación mientras la corrida no es terminal. */
export const PHONE_REVEAL_WATERFALL_APPROVE_BLOCKED_COPY =
  'La revelación de teléfono sigue en proceso.';

// ── Modal único de confirmación ────────────────────────────────

export interface PhoneRevealWaterfallModalCopy {
  title: string;
  /** Qué va a hacer SellUp, en orden. */
  flowDescription: string;
  /** Tope de créditos, ya redactado. */
  creditsMessage: string;
  /** Tope que viaja en el payload de la acción (autoridad real: el server). */
  maxCredits: number;
  /** Solo cuando Lusha NO aplica: por qué. null en caso contrario. */
  lushaUnavailableNote: string | null;
  /** Advertencias obligatorias del modal. */
  warnings: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
}

/** Advertencias comunes a los dos casos (con y sin Lusha). */
const PHONE_REVEAL_WATERFALL_COMMON_WARNINGS: readonly string[] = [
  'No se escribirá en HubSpot automáticamente.',
  'Es una acción individual, no masiva.',
  'El tipo de teléfono puede quedar como desconocido.',
];

/**
 * Copy del modal ÚNICO. No hay segundo modal ni segundo clic: lo que el operador
 * confirma aquí cubre las dos patas.
 *
 * `lushaEligible` decide el tope mostrado (13 vs 8) y si se explica por qué Lusha
 * no está disponible. El tope es el UMBRAL que el operador acepta, no una
 * predicción: el costo real de cada pata sale de lo que reporta cada proveedor y
 * se registra por separado.
 */
export function getPhoneRevealWaterfallModalCopy(args: {
  lushaEligible: boolean;
}): PhoneRevealWaterfallModalCopy {
  const maxCredits = args.lushaEligible
    ? PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS
    : PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS;

  return {
    title: PHONE_REVEAL_WATERFALL_BUTTON_LABEL,
    flowDescription: args.lushaEligible
      ? 'SellUp intentará primero Apollo. Si Apollo no encuentra teléfono, intentará Lusha automáticamente.'
      : 'SellUp intentará Apollo.',
    creditsMessage: `Puede consumir hasta ${maxCredits} créditos.`,
    maxCredits,
    lushaUnavailableNote: args.lushaEligible
      ? null
      : 'Lusha no está disponible para este candidato porque no tiene identificador Lusha reutilizable.',
    warnings: PHONE_REVEAL_WATERFALL_COMMON_WARNINGS,
    confirmLabel: 'Confirmar y revelar',
    cancelLabel: 'Cancelar',
  };
}

// ── Etiquetas del bloque de auditoría ──────────────────────────

/** Motivos por los que la pata Lusha se omitió, en lenguaje del operador. */
const LUSHA_SKIPPED_REASON_LABELS: Readonly<Record<string, string>> = {
  missing_lusha_contact_id: 'Omitida: el candidato no tiene identificador Lusha reutilizable.',
  apollo_revealed: 'Omitida: Apollo ya entregó el teléfono.',
  suppressed: 'Omitida: existe una restricción de privacidad registrada.',
  dnc: 'Omitida: el contacto está marcado como no contactar.',
  authorization_expired: 'Omitida: la autorización de costo había vencido.',
  role_not_allowed: 'Omitida: el rol que autorizó no tiene permiso para Lusha.',
  feature_disabled: 'Omitida: el fallback de Lusha no está activado.',
  already_attempted: 'Omitida: ya se había intentado en esta corrida.',
  not_needed: 'Omitida: no era necesaria.',
  provider_error: 'Omitida: la consulta anterior terminó en error.',
};

/** Desenlaces de cada pata, en lenguaje del operador. */
const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  revealed: 'Teléfono encontrado',
  revealed_from_cache: 'Teléfono reutilizado de una revelación anterior',
  no_phone_found: 'Sin teléfono',
  error: 'Error',
  blocked_suppressed: 'Bloqueado por privacidad',
  do_not_contact: 'Bloqueado por no contactar',
  suppression_check_unavailable: 'No se pudo verificar la privacidad',
  cache_unavailable: 'No se pudo consultar la caché',
};

/** Proveedor final, en lenguaje del operador. */
const FINAL_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  none: 'Ninguno',
};

export function resolveWaterfallOutcomeLabel(outcome: string | null): string | null {
  return outcome ? (OUTCOME_LABELS[outcome] ?? outcome) : null;
}

export function resolveWaterfallLushaSkippedLabel(reason: string | null): string | null {
  return reason ? (LUSHA_SKIPPED_REASON_LABELS[reason] ?? 'Omitida.') : null;
}

export function resolveWaterfallFinalProviderLabel(
  provider: string | null,
): string | null {
  return provider ? (FINAL_PROVIDER_LABELS[provider] ?? provider) : null;
}

/**
 * Créditos de UNA pata, ya redactados. Un costo no reportado se muestra como
 * "no reportado", NUNCA como 0: no reportar no es lo mismo que no cobrar.
 */
export function formatWaterfallLegCredits(
  credits: number | null,
  costSource: string | null,
): string {
  if (typeof credits !== 'number' || !Number.isFinite(credits)) {
    return 'costo no reportado';
  }
  const unit = credits === 1 ? 'crédito' : 'créditos';
  return costSource === 'reported'
    ? `${credits} ${unit}`
    : `${credits} ${unit} (sin confirmar)`;
}
