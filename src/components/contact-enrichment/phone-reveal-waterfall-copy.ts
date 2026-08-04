// Copy puro del waterfall Apollo → Lusha (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
// Sin React, sin red, sin imports de servidor: seguro de importar desde tests
// unitarios y desde el bundle cliente. Lo renderiza
// contact-candidate-detail-sheet.tsx, pero solo cuando
// ENABLE_PHONE_REVEAL_WATERFALL resuelve a `"true"` para un rol admin.
//
// NOTA (2026-08-04, AGENT2A-PHONE-REVEAL-UI-STATE-1): el texto anterior afirmaba
// que el flag estaba «apagado en todos los entornos» y que por tanto ningún
// operador veía este copy. La variable SÍ está registrada en Production y su valor
// es ilegible (`Encrypted`), así que esa afirmación ya no es verificable desde el
// código. Si el waterfall está activo se comprueba en runtime con
// GET /api/debug/agent2a-phone-waterfall-config, no asumiéndolo aquí.
//
// Misma convención que lusha-phone-fallback-copy.ts: un `get<X>Copy()` puro por
// concern, y los topes de crédito declarados como constantes de UI para no
// importar módulos de servidor en el cliente. Un test estático verifica que
// coincidan con las constantes del core del waterfall, que es la autoridad real y
// revalida el tope server-side.
//
// NOTA (AGENT2A-PHONE-WATERFALL-4D): el modal de confirmación DESAPARECIÓ. El
// operador autoriza con un único clic en «Revelar teléfono» y todo lo que antes
// vivía en el diálogo —flujo, tope, desglose por proveedor y advertencias— se lee
// AHORA debajo del botón, antes de hacer clic. Ya no existe «Confirmar y revelar».

/** Botón ÚNICO del waterfall. Mismo label que el reveal Apollo: para el operador
 *  no es una acción nueva, es la misma acción que ahora persiste más. */
export const PHONE_REVEAL_WATERFALL_BUTTON_LABEL = 'Revelar teléfono';

/**
 * Tope cuando el candidato NO tiene identificador Lusha reutilizable: solo Apollo.
 * Espejo de PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS del core.
 */
export const PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS = 8;

/**
 * Tope de la SEGUNDA pata cuando Lusha aplica. Es el sumando que, con los 8 de
 * Apollo, produce el total de 13, y el desglose lo muestra por separado
 * (AGENT2A-PHONE-WATERFALL-4B): un total sin desglose no le dice al operador que
 * está autorizando DOS proveedores. Espejo de
 * PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS del core.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS = 5;

/**
 * Tope cuando Lusha es una segunda pata posible: Apollo hasta 8 + Lusha 5.
 * Espejo de PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA del core.
 */
export const PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS = 13;

/**
 * Tope de una corrida LEGACY (AGENT2A-PHONE-WATERFALL-2): SOLO Lusha, así que es el
 * tope de Lusha y NUNCA incluye los 8 de Apollo — ese intento ya ocurrió y ya se
 * cobró bajo otra autorización. Espejo de
 * PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS del core.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS = 5;

// ── Estados visibles (AGENT2A-PHONE-WATERFALL-4D) ──────────────
//
// Al eliminarse el modal, estos estados son TODO lo que el operador ve después de su
// único clic, así que describen en qué paso está SellUp sin pedirle nada. La
// atribución por proveedor no se pierde: vive en el bloque de auditoría, que muestra
// qué intentó cada pata y cuánto costó cada una por separado.

/** La solicitud salió y el servidor todavía no ha respondido. */
export const PHONE_REVEAL_WATERFALL_REQUESTING_COPY = 'Solicitando revelación…';

/** Apollo en vuelo (primera pata). */
export const PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY =
  'Apollo está procesando el resultado.';

/**
 * Apollo cerró sin teléfono y la segunda pata está reclamada o en curso.
 *
 * Sirve para las DOS modalidades. En la legacy sigue siendo cierto —Apollo se
 * intentó y no encontró teléfono— y está en pasado, así que no afirma que Apollo
 * esté corriendo ahora, que era lo que la modalidad legacy no podía decir. Que ese
 * intento ocurrió FUERA de esta autorización lo dice la fila de auditoría de Apollo.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY =
  'Apollo no encontró un teléfono. SellUp está intentando Lusha.';

/**
 * Terminal con teléfono. Único para las dos patas: cuál de las dos lo consiguió lo
 * dice el bloque de auditoría («Proveedor final»), que es donde vive la atribución.
 */
export const PHONE_REVEAL_WATERFALL_REVEALED_COPY = 'Teléfono revelado.';

/**
 * Terminal sin teléfono. No enumera proveedores a propósito: la lista dependía de la
 * modalidad y la auditoría ya detalla qué intentó cada pata y qué no.
 */
export const PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY = 'Teléfono no disponible.';

/**
 * Saldo insuficiente (AGENT2A-PHONE-WATERFALL-4D). Se comprueba SERVER-SIDE antes de
 * crear la corrida, así que cuando el operador lee esto no se creó ninguna corrida,
 * no corrió ningún proveedor y no se consumió ningún crédito.
 */
export const PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY =
  'No hay créditos suficientes para realizar esta revelación.';

/**
 * NO hay presupuesto configurado para alguno de los proveedores que la autorización
 * puede llegar a llamar (AGENT2A-PHONE-WATERFALL-4E).
 *
 * DELIBERADAMENTE distinto de "no hay créditos suficientes": aquí no es que el saldo se
 * haya agotado, es que nadie configuró un límite de créditos para ese proveedor, así que
 * no hay disponibilidad contra la que reservar la exposición. Decirle al operador que
 * faltan créditos lo mandaría a conseguir créditos que no desbloquearían nada; lo que
 * hace falta es que un administrador configure la regla.
 *
 * Garantías idénticas: 0 corridas, 0 proveedores, 0 usage logs, 0 créditos.
 */
export const PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY =
  'No hay un presupuesto configurado para realizar esta revelación.';

/**
 * El saldo NO se pudo verificar. DELIBERADAMENTE distinto de los dos anteriores: no se
 * sabe si alcanza NI si existe presupuesto, así que afirmar cualquiera de las dos cosas
 * sería inventarse un hecho. Las garantías son las mismas —cero corridas, cero
 * proveedores, cero créditos— y por eso el copy las declara.
 */
export const PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY =
  'No fue posible verificar el saldo de créditos. No se ejecutó ningún proveedor ni se consumieron créditos.';

/** Cierre técnico: no significa "no existe teléfono". */
export const PHONE_REVEAL_WATERFALL_ERROR_COPY =
  'No fue posible completar la revelación de teléfono. Intenta más tarde.';

/** Cierre por privacidad (supresión registrada o no contactar). */
export const PHONE_REVEAL_WATERFALL_BLOCKED_COPY =
  'La revelación se detuvo por una restricción de privacidad registrada para este contacto.';

/**
 * Cierre por comprobación de supresión NO VERIFICABLE. Es DISTINTO del anterior a
 * propósito: no se sabe si existe una restricción, solo que no se pudo comprobar.
 * El copy no puede afirmar que el candidato esté suprimido, tiene que decir que la
 * verificación no estuvo disponible y que Lusha no se ejecutó.
 */
export const PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY =
  'No se pudo verificar la supresión. Lusha no fue ejecutado. No se hizo ningún cargo por Lusha; puedes autorizar una nueva revelación más tarde.';

/**
 * La corrida de auditoría del waterfall no se pudo crear, así que NO se ejecutó
 * ningún proveedor (AGENT2A-PHONE-WATERFALL-2A).
 *
 * El copy tiene que decir cuatro cosas y no puede insinuar ninguna otra:
 *   1. el proceso NO pudo iniciarse (no es un resultado de búsqueda);
 *   2. Apollo NO fue ejecutado;
 *   3. Lusha NO fue ejecutado;
 *   4. no se consumieron créditos, y se puede reintentar más tarde.
 *
 * Lo que NO puede aparecer: `no_phone_found` ("no se encontró teléfono" afirmaría
 * que se buscó), un error de Apollo (Apollo no participó), un costo de 0 atribuido
 * a un proveedor (ninguno cobró porque ninguno corrió), un éxito parcial, ni
 * ninguna referencia a una corrida que no existe.
 */
export const PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY =
  'No se pudo iniciar la revelación segura porque el servicio de auditoría no está disponible. No se ejecutó Apollo, no se ejecutó Lusha y no se consumieron créditos. Intenta nuevamente más tarde.';

/** Gate de aprobación mientras la corrida no es terminal. */
export const PHONE_REVEAL_WATERFALL_APPROVE_BLOCKED_COPY =
  'La revelación de teléfono sigue en proceso.';

// ── Modalidad legacy (AGENT2A-PHONE-WATERFALL-2) ───────────────
//
// Los estados intermedios y terminales ya NO son específicos de la modalidad
// (AGENT2A-PHONE-WATERFALL-4D): los de arriba sirven para las dos, y lo que la
// modalidad legacy necesita afirmar —que el intento de Apollo ocurrió antes y fuera
// de esta autorización, y que aquí no se le cobra— lo dicen estas dos etiquetas del
// bloque de auditoría, que es donde vive la atribución por proveedor.

/**
 * Etiqueta de la pata Apollo en el bloque de auditoría de una corrida legacy. Es
 * DELIBERADAMENTE distinta de "No intentado": Apollo SÍ se intentó, antes y fuera de
 * esta autorización, y esa es la razón por la que no se ejecutó aquí.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY =
  'Intentado anteriormente, fuera de esta autorización';

/**
 * Costo de la pata Apollo en una corrida legacy. El costo histórico pertenece a la
 * autorización que realmente lo pagó, así que aquí no se muestra ninguna cifra —
 * y mucho menos un 0, que se leería como "fue gratis".
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY =
  'Sin cargo en esta autorización';

// ── Autorización DIRECTA, debajo del botón ─────────────────────
//
// AGENT2A-PHONE-WATERFALL-4D. Ya no hay modal ni «Confirmar y revelar»: el operador
// lee esto ANTES de hacer clic y el clic ejecuta. Por eso el contenido no se
// simplifica al quitar el diálogo — se MUEVE, íntegro, a la superficie que ahora
// precede a la acción. Un consentimiento que solo aparece después del clic no es
// consentimiento.

/**
 * Desglose del tope, por pata autorizada (AGENT2A-PHONE-WATERFALL-4B). Un total sin
 * desglose no permite saber cuántos proveedores se están autorizando ni cuánto puede
 * cobrar cada uno.
 *
 * No es una predicción de costo: es el UMBRAL por pata. Lo que cada proveedor cobra
 * de verdad sale de lo que reporta, y se audita por separado — de ahí que `legs` y
 * `total` sean campos distintos y no una sola frase.
 */
export interface PhoneRevealWaterfallCreditBreakdown {
  /** Una línea por pata autorizada, en el orden en que se intentan. */
  legs: readonly string[];
  /** Total autorizado, ya redactado. Es la suma de las patas, nunca menos. */
  total: string;
}

export interface PhoneRevealWaterfallAuthorizationCopy {
  /** Qué va a hacer SellUp, en orden. Sin el tope: ese va en `creditsMessage`. */
  flowDescription: string;
  /** Tope de créditos, ya redactado. */
  creditsMessage: string;
  /**
   * Texto EXACTO que se renderiza debajo del botón: `flowDescription` +
   * `creditsMessage`. Es un campo y no una concatenación en el componente para que
   * el copy que se prueba sea el copy que se pinta.
   */
  helperText: string;
  /**
   * Desglose por pata + total. `null` cuando la autorización cubre UNA sola pata
   * (Apollo-only y legacy): ahí no hay nada que desglosar y `creditsMessage` ya dice
   * el tope. En la modalidad Apollo-only, además, un desglose obligaría a nombrar a
   * Lusha para explicar su ausencia, y esa pata no puede ejecutarse.
   */
  creditBreakdown: PhoneRevealWaterfallCreditBreakdown | null;
  /** Tope que viaja en el payload de la acción (autoridad real: el server). */
  maxCredits: number;
  /** Advertencias obligatorias, visibles antes del clic. */
  warnings: readonly string[];
}

/** Advertencias comunes a los dos casos (con y sin Lusha). */
const PHONE_REVEAL_WATERFALL_COMMON_WARNINGS: readonly string[] = [
  'No se escribirá en HubSpot automáticamente.',
  'Es una acción individual, no masiva.',
  'El tipo de teléfono puede quedar como desconocido.',
];

/**
 * Advertencias de la modalidad LEGACY (AGENT2A-PHONE-WATERFALL-2). Además de las
 * comunes, dicen explícitamente lo que el operador necesita saber para que la
 * autorización sea informada: que no garantiza teléfono y que no crea un contacto
 * oficial. Que Apollo no se reejecuta y que el tope es 5 los dicen
 * `flowDescription` y `creditsMessage`.
 */
const PHONE_REVEAL_WATERFALL_LEGACY_WARNINGS: readonly string[] = [
  'No garantiza encontrar un teléfono.',
  'No crea un contacto oficial automáticamente.',
  ...PHONE_REVEAL_WATERFALL_COMMON_WARNINGS,
];

/**
 * Advertencias del modal del waterfall COMPLETO (AGENT2A-PHONE-WATERFALL-4B).
 *
 * Antes este modal solo llevaba las comunes, así que las dos advertencias que más
 * pesan en una autorización de gasto —que puede no encontrarse teléfono, y que
 * encontrarlo no crea un contacto oficial— solo las veía el operador del flujo
 * legacy. Un consentimiento informado no puede depender de por qué vía llegó el
 * candidato: el flujo completo autoriza MÁS crédito (13 vs 5), no menos, así que si
 * alguno de los dos las necesita es este.
 *
 * La redacción es la del contrato de 4B ("No se garantiza…", "No se creará…") y NO
 * se reusa la del legacy a propósito: el legacy quedó explícitamente sin cambios en
 * este cambio, y unificar la redacción habría tocado su copy ya validado.
 */
const PHONE_REVEAL_WATERFALL_FULL_WARNINGS: readonly string[] = [
  'No se garantiza encontrar un teléfono.',
  'No se creará un contacto oficial automáticamente.',
  ...PHONE_REVEAL_WATERFALL_COMMON_WARNINGS,
];

/** Une flujo y tope en la frase EXACTA que se pinta debajo del botón. */
function buildHelperText(flowDescription: string, creditsMessage: string): string {
  return `${flowDescription} ${creditsMessage}`;
}

/**
 * Copy de la autorización DIRECTA (AGENT2A-PHONE-WATERFALL-4D). Se lee ANTES del
 * clic, y el clic ejecuta: no hay confirmación posterior.
 *
 * Tres modalidades, tres topes, y ninguna nombra una pata que no pueda ejecutarse:
 *
 *   * completa (id Lusha)      ⇒ Apollo y, si no encuentra, Lusha. Hasta 13.
 *   * Apollo-only (sin id)     ⇒ solo Apollo, hasta 8. NO menciona Lusha ni 13:
 *     nombrar una pata imposible solo puede confundir sobre qué se está autorizando.
 *   * legacy (Apollo ya corrió) ⇒ solo Lusha, hasta 5. Jamás 13 ni 8.
 *
 * El tope es el UMBRAL que el operador acepta, no una predicción: el costo real de
 * cada pata sale de lo que reporta cada proveedor y se registra por separado.
 */
export function getPhoneRevealWaterfallAuthorizationCopy(args: {
  lushaEligible: boolean;
  /**
   * `true` cuando la autorización cubre ÚNICAMENTE la pata Lusha porque Apollo ya
   * se intentó antes y no encontró teléfono (AGENT2A-PHONE-WATERFALL-2). Cambia el
   * tope a 5 y el copy a decir explícitamente que Apollo ya fue intentado.
   */
  legacyLushaOnly?: boolean;
}): PhoneRevealWaterfallAuthorizationCopy {
  // La modalidad legacy manda sobre `lushaEligible`: solo se ofrece cuando Lusha es
  // alcanzable, y su tope es el de Lusha, nunca 13 ni 8.
  if (args.legacyLushaOnly === true) {
    const flowDescription =
      'Apollo ya fue intentado. SellUp intentará Lusha automáticamente.';
    const creditsMessage = `Puede consumir hasta ${PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS} créditos.`;
    return {
      flowDescription,
      creditsMessage,
      helperText: buildHelperText(flowDescription, creditsMessage),
      // Una sola pata autorizada ⇒ no hay desglose que hacer, y el tope sigue
      // siendo 5, nunca 13.
      creditBreakdown: null,
      maxCredits: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      warnings: PHONE_REVEAL_WATERFALL_LEGACY_WARNINGS,
    };
  }

  if (!args.lushaEligible) {
    const flowDescription = 'Consulta individual con Apollo.';
    const creditsMessage = `Puede consumir hasta ${PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS} créditos.`;
    return {
      flowDescription,
      creditsMessage,
      helperText: buildHelperText(flowDescription, creditsMessage),
      // Sin id Lusha reutilizable la 2ª pata no puede ejecutarse: no hay nada que
      // desglosar y el desglose obligaría a nombrar a Lusha para justificar su
      // ausencia. El motivo mecánico sigue registrado en la corrida
      // (`lusha_skipped_reason = missing_lusha_contact_id`) y visible en la
      // auditoría por proveedor.
      creditBreakdown: null,
      maxCredits: PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS,
      warnings: PHONE_REVEAL_WATERFALL_FULL_WARNINGS,
    };
  }

  const flowDescription =
    'Apollo se intentará primero. Si no encuentra un teléfono, SellUp intentará Lusha automáticamente.';
  const creditsMessage = `Puede consumir hasta ${PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS} créditos.`;
  return {
    flowDescription,
    creditsMessage,
    helperText: buildHelperText(flowDescription, creditsMessage),
    creditBreakdown: {
      legs: [
        `Apollo: hasta ${PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS} créditos.`,
        `Lusha: hasta ${PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS} créditos.`,
      ],
      total: `Máximo total autorizado: ${PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS} créditos.`,
    },
    maxCredits: PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS,
    warnings: PHONE_REVEAL_WATERFALL_FULL_WARNINGS,
  };
}

// ── Etiquetas del bloque de auditoría ──────────────────────────

/** Motivos por los que la pata Lusha se omitió, en lenguaje del operador. */
const LUSHA_SKIPPED_REASON_LABELS: Readonly<Record<string, string>> = {
  missing_lusha_contact_id: 'Omitida: el candidato no tiene identificador Lusha reutilizable.',
  apollo_revealed: 'Omitida: Apollo ya entregó el teléfono.',
  suppressed: 'Omitida: existe una restricción de privacidad registrada.',
  // NO dice "suprimido": la comprobación no se pudo hacer, así que no se sabe si
  // existe una restricción. Lo único cierto es que Lusha no se ejecutó.
  suppression_check_unavailable:
    'Omitida: no se pudo verificar la supresión. Lusha no fue ejecutado.',
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
