// Copy puro del waterfall Apollo → Lusha (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
// Sin React, sin red, sin imports de servidor: seguro de importar desde tests
// unitarios y desde el bundle cliente. Lo renderiza
// contact-candidate-detail-sheet.tsx, pero solo cuando
// ENABLE_PHONE_REVEAL_WATERFALL resuelve a `"true"` para un actor con permiso de
// revelar teléfono (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: ya no es un rol
// admin, es la autoridad canónica del reveal).
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
 * Tope de la BÚSQUEDA DE IDENTIDAD de Lusha: 1 crédito. Espejo de
 * PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS del core
 * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * Se muestra por separado y NO se esconde dentro de los 5 del teléfono. Son dos
 * operaciones distintas del mismo proveedor —averiguar quién es la persona, y pedir
 * su número— y el operador está autorizando las dos.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS = 1;

/** Tope de la pata Lusha COMPLETA cuando hay que averiguar la identidad: 1 + 5 = 6. */
export const PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS_WITH_SEARCH =
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS +
  PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS;

/**
 * Tope total cuando además hay que averiguar la identidad: 8 + 1 + 5 = 14. Espejo de
 * PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH del core.
 */
export const PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS =
  PHONE_REVEAL_WATERFALL_WITH_LUSHA_MAX_CREDITS +
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS;

/**
 * Tope de una corrida LEGACY (AGENT2A-PHONE-WATERFALL-2): SOLO Lusha, así que es el
 * tope de Lusha y NUNCA incluye los 8 de Apollo — ese intento ya ocurrió y ya se
 * cobró bajo otra autorización. Espejo de
 * PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS del core.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS = 5;

/**
 * Tope de una corrida LEGACY que además tiene que COMPRAR la identidad Lusha: 1 + 5 = 6
 * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Espejo de
 * PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH del core.
 *
 * Sigue SIN incluir los 8 de Apollo, y esa ausencia es el punto: el candidato de esta
 * ruta nació en Apollo y Apollo ya se cobró bajo otra autorización. Enseñar aquí 14
 * —o «8 + …»— le pediría al operador que volviera a autorizar un gasto que ya ocurrió
 * y que esta corrida no puede repetir.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_SEARCH =
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS +
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS;

/**
 * Etiqueta del botón en la ruta LEGACY
 * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
 *
 * Se separa de `PHONE_REVEAL_WATERFALL_BUTTON_LABEL` porque aquí el label genérico
 * miente por omisión: sobre un candidato que ya salió `no_phone_found` de Apollo,
 * «Revelar teléfono» se lee como «vuelve a intentarlo con lo de siempre», y lo que va a
 * pasar es otra cosa — Apollo NO se llama y el único proveedor que se consulta es
 * Lusha. Nombrarlo es lo que hace que el clic sea informado.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_BUTTON_LABEL = 'Buscar teléfono con Lusha';

/**
 * Frase que precede al copy de autorización legacy y NO se oculta nunca: el operador
 * tiene que saber que Apollo ya fue consultado, tanto para entender por qué el tope no
 * lleva sus 8 créditos como para no creer que se va a reintentar.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_ALREADY_QUERIED_COPY =
  'Apollo ya fue consultado y no encontró teléfono. No se volverá a consultar.';

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

/**
 * El tope que el operador VIO ya no es el que la modalidad exige
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
 *
 * NO es un error del operador ni un fallo del sistema, así que el copy no se disculpa ni
 * habla de proveedores: describe lo único que pasó —la autorización cambió— y pide la
 * única acción que corresponde, que es MIRAR el nuevo máximo antes de volver a decidir.
 *
 * Deliberadamente NO menciona el número nuevo: quien lo muestra es el botón, que se
 * recarga con la vista previa fresca. Un copy que dijera «ahora son 14» competiría con
 * el botón por ser la fuente de verdad del precio.
 */
export const PHONE_REVEAL_WATERFALL_AUTHORIZATION_CHANGED_COPY =
  'La autorización cambió. Revisa el nuevo máximo de créditos antes de continuar.';

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
 *   * legacy + identidad por comprar ⇒ solo Lusha, hasta 6 (búsqueda 1 + teléfono 5).
 *     Jamás 14: los 8 de Apollo ya los pagó la autorización histórica.
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
  /**
   * `true` cuando la pata Lusha es alcanzable pero exige PAGAR antes una búsqueda de
   * identidad (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1). Sube el tope de
   * 13 a 14 y desglosa los 6 de Lusha.
   *
   * En la ruta LEGACY sube el tope de 5 a 6 y desglosa esas mismas dos patas
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Antes de ese hito la rama
   * legacy ignoraba esta señal a propósito, porque su autorización no podía comprar la
   * búsqueda; ahora sí puede, y el copy tiene que decirlo — la alternativa sería
   * enseñar 5 y reservar 6.
   *
   * Ausente ⇒ `false`, que devuelve exactamente el copy anterior al hito. Cuando la
   * identidad Lusha YA está persistida esto es `false` de verdad, no por omisión: esa
   * autorización no puede gastar una búsqueda, así que no debe pedir el crédito.
   */
  requiresIdentitySearch?: boolean;
}): PhoneRevealWaterfallAuthorizationCopy {
  // La modalidad legacy manda sobre `lushaEligible`: solo se ofrece cuando Lusha es
  // alcanzable, y su tope es el de Lusha, nunca 13 ni 8.
  if (args.legacyLushaOnly === true) {
    // Ruta legacy que además tiene que COMPRAR la identidad Lusha
    // (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Son DOS patas pagadas del
    // MISMO proveedor, así que sí hay desglose que hacer: un «hasta 6» opaco no le
    // dice al operador que está autorizando una búsqueda ADEMÁS de un teléfono.
    //
    // Y sigue diciendo que Apollo ya fue consultado, porque es lo que explica por qué
    // el tope es 6 y no 14.
    if (args.requiresIdentitySearch === true) {
      const flowDescription =
        'Apollo ya fue consultado y no encontró teléfono. No se volverá a consultar. SellUp buscará primero el contacto en Lusha y luego intentará obtener su teléfono.';
      const creditsMessage = `Puede consumir hasta ${PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_SEARCH} créditos: búsqueda hasta ${PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS} + teléfono hasta ${PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS}.`;
      return {
        flowDescription,
        creditsMessage,
        helperText: buildHelperText(flowDescription, creditsMessage),
        creditBreakdown: {
          legs: [
            `Búsqueda del contacto en Lusha: hasta ${PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS} crédito.`,
            `Teléfono en Lusha: hasta ${PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS} créditos.`,
          ],
          total: `Máximo total autorizado: ${PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_SEARCH} créditos.`,
        },
        maxCredits: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_SEARCH,
        warnings: PHONE_REVEAL_WATERFALL_LEGACY_WARNINGS,
      };
    }

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

  // Lusha alcanzable, pero hay que AVERIGUAR con qué id la conoce. El desglose nombra
  // las dos operaciones por separado en vez de enseñar un 6 opaco: el operador está
  // autorizando una búsqueda además de un teléfono, y tiene que poder verlo.
  if (args.requiresIdentitySearch === true) {
    const flowDescription =
      'Apollo se intentará primero. Si no encuentra un teléfono, SellUp buscará el contacto en Lusha y luego intentará obtener su teléfono.';
    const creditsMessage = `Puede consumir hasta ${PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS} créditos.`;
    return {
      flowDescription,
      creditsMessage,
      helperText: buildHelperText(flowDescription, creditsMessage),
      creditBreakdown: {
        legs: [
          `Apollo: hasta ${PHONE_REVEAL_WATERFALL_APOLLO_ONLY_MAX_CREDITS} créditos.`,
          `Lusha: hasta ${PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS_WITH_SEARCH} créditos (búsqueda hasta ${PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS} + teléfono hasta ${PHONE_REVEAL_WATERFALL_LUSHA_LEG_MAX_CREDITS}).`,
        ],
        total: `Máximo total autorizado: ${PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS} créditos.`,
      },
      maxCredits: PHONE_REVEAL_WATERFALL_WITH_IDENTITY_SEARCH_MAX_CREDITS,
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
  // Los cinco desenlaces de la resolución de identidad cross-provider. Se redactan por
  // separado porque cuatro de ellos SÍ consumieron un crédito de búsqueda y uno no, y
  // el operador no puede distinguirlos si todos dicen lo mismo.
  lusha_identity_unresolvable:
    'Omitida: no había datos suficientes para buscar el contacto en Lusha. No se consumieron créditos.',
  lusha_identity_not_found: 'Omitida: Lusha no encontró a este contacto.',
  lusha_identity_ambiguous:
    'Omitida: la búsqueda en Lusha no identificó a una única persona.',
  lusha_identity_error: 'Omitida: la búsqueda del contacto en Lusha falló.',
  // Dice las DOS cosas, y en este orden: que se encontró (para que el operador no crea
  // que el dato no existe) y que no se pudo guardar (para que entienda por qué no hay
  // teléfono y por qué volver a intentarlo cuesta otro crédito de búsqueda).
  lusha_identity_not_persisted:
    'Omitida: se encontró el contacto en Lusha pero no se pudo guardar su identificador, así que no se pidió el teléfono.',
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

// ── Rechazos del arranque LEGACY, uno por uno ──────────────────
// (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1)
//
// Todos estos casos compartían una sola frase —«Este candidato ya no puede autorizarse
// por esta vía»— que es una afirmación sobre el CANDIDATO. Para la mitad de ellos era
// falsa: el candidato aplicaba perfectamente y lo que había cambiado era el flag, el
// rol, la privacidad, una autorización ya viva o una lectura rota. Cada copy dice ahora
// lo que de verdad pasó, sin exponer ids de proveedor ni detalles internos de la base
// de datos, y sin afirmar nada económico que no haya ocurrido.

/** Sin id propio ni identificador exacto con el que comprarlo en Lusha. */
export const PHONE_REVEAL_LEGACY_MISSING_LUSHA_ID_COPY =
  'No hay suficientes datos para identificar este contacto en Lusha.';

/**
 * Ya hay una autorización VIVA. No se abre una segunda ni se cobra de nuevo.
 *
 * AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1: esta frase sólo puede salir cuando
 * el servidor RELEYÓ la corrida activa y la ENCONTRÓ. Antes también la producía un
 * conflicto de unicidad que no dejaba ninguna corrida escrita, y entonces afirmaba un
 * proceso que el operador no podía ver por ningún lado.
 */
export const PHONE_REVEAL_LEGACY_ALREADY_PENDING_COPY =
  'Ya hay una revelación en proceso para este candidato.';

/**
 * El arranque chocó y NO hay ninguna corrida viva que lo explique
 * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
 *
 * Dice las tres cosas que el operador necesita y NINGUNA que no se haya comprobado: no
 * arrancó, no se cobró —la transacción se deshizo entera, así que 0 corridas y 0
 * reservas— y el candidato NO queda descartado. No se reintenta solo: un reintento
 * automático sobre una escritura pagada es precisamente lo que este subsistema no hace.
 */
export const PHONE_REVEAL_LEGACY_START_UNSAFE_COPY =
  'No fue posible iniciar la revelación de forma segura. ' +
  'No se hizo ningún cargo. Intenta nuevamente más tarde.';

/** Tombstone de supresión CONFIRMADO. */
export const PHONE_REVEAL_LEGACY_SUPPRESSED_COPY =
  'No se puede revelar este teléfono por una restricción de privacidad.';

/** `do_not_contact` registrado para este contacto. */
export const PHONE_REVEAL_LEGACY_DO_NOT_CONTACT_COPY =
  'Este contacto está marcado como no contactar.';

/**
 * La verificación de privacidad NO se pudo completar. Bloquea igual que un tombstone
 * confirmado, pero NO afirma lo mismo: aquí no se comprobó nada. Se dice explícitamente
 * que no hubo cargo, porque el corte ocurre antes de reservar.
 */
export const PHONE_REVEAL_LEGACY_PRIVACY_UNVERIFIED_COPY =
  'No fue posible verificar las restricciones de privacidad. No se hizo ningún cargo.';

/**
 * El candidato existe, pero su estado ya no coincide con el que la vista previa leyó.
 * La acción del operador es una sola: recargar.
 */
export const PHONE_REVEAL_LEGACY_STATE_CHANGED_COPY =
  'El estado del candidato cambió. Recarga la vista.';

/** El candidato dejó de existir entre el render y el clic. */
export const PHONE_REVEAL_LEGACY_CANDIDATE_NOT_FOUND_COPY =
  'Este candidato ya no está disponible. Recarga la vista.';

/** Hecho del ENTORNO, no del candidato: la función está apagada. */
export const PHONE_REVEAL_LEGACY_FEATURE_DISABLED_COPY =
  'La revelación de teléfono no está habilitada en este momento. No se hizo ningún cargo.';

/** Hecho del ACTOR, no del candidato. */
export const PHONE_REVEAL_LEGACY_ROLE_NOT_ALLOWED_COPY =
  'Tu rol no puede autorizar la revelación de teléfono.';

// ── Cierre TERMINAL en error, motivo por motivo ────────────────
// (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1)
//
// Hasta este hito TODO cierre en error mostraba la misma frase genérica, y la corrida
// real 2a49e0f7 es el ejemplo de por qué eso no sirve: el motivo verdadero era que el
// contacto no se pudo identificar en Lusha —un problema NUESTRO, sin ninguna llamada
// al proveedor— y el operador leía «no fue posible completar la revelación», que
// sugiere que Lusha falló y que reintentar más tarde ayudaría. Ninguna de las dos
// cosas era cierta.
//
// REGLA QUE NINGUNO DE ESTOS COPY PUEDE ROMPER: un fallo TÉCNICO nunca se le cuenta al
// operador como «este contacto no tiene teléfono». Sólo un `exhausted` —Lusha
// respondió y no traía número— puede decir eso, y ése ya tiene su propio copy
// (`PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY`).
//
// Tampoco exponen ids de proveedor, endpoints ni detalles internos: describen el
// ESTADO y la acción que le queda al operador.

/** Credencial ausente, inválida o plan sin el permiso. Acción: revisar configuración. */
export const PHONE_REVEAL_WATERFALL_CREDENTIAL_ERROR_COPY =
  'No fue posible consultar Lusha por un problema de configuración.';

/** Límite de tasa del proveedor. Acción: reintentar más tarde. */
export const PHONE_REVEAL_WATERFALL_RATE_LIMITED_COPY =
  'Lusha no pudo responder en este momento.';

/** 5xx, red caída o timeout. Acción: reintentar más tarde. */
export const PHONE_REVEAL_WATERFALL_PROVIDER_UNAVAILABLE_COPY =
  'No fue posible completar la consulta con Lusha. Intenta más tarde.';

/**
 * No se pudo identificar al contacto en Lusha. Es el motivo REAL de 2a49e0f7.
 *
 * No dice «no tiene teléfono» ni «Lusha falló»: dice lo único que es cierto — que la
 * consulta no llegó a hacerse porque falta la identidad con la que hacerla.
 */
export const PHONE_REVEAL_WATERFALL_IDENTITY_UNRESOLVED_COPY =
  'No fue posible identificar este contacto en Lusha, así que no se consultó su teléfono.';

/** Gate local distinto de la identidad (flag, rol, elegibilidad). */
export const PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY =
  'Esta revelación no se pudo ejecutar con la configuración actual. No se consultó a ningún proveedor.';

/**
 * Copy por motivo terminal. Declarado como DATO para que añadir un motivo nuevo sea
 * añadir una fila, y para que un motivo sin fila caiga en el genérico en vez de
 * romper el render.
 */
const TERMINAL_ERROR_COPY_BY_CODE: Readonly<Record<string, string>> = {
  // Identidad: la familia del fallo real.
  missing_lusha_contact_id: PHONE_REVEAL_WATERFALL_IDENTITY_UNRESOLVED_COPY,
  invalid_contact_id: PHONE_REVEAL_WATERFALL_IDENTITY_UNRESOLVED_COPY,

  // Credencial / entitlement.
  provider_auth_error: PHONE_REVEAL_WATERFALL_CREDENTIAL_ERROR_COPY,
  provider_permission_error: PHONE_REVEAL_WATERFALL_CREDENTIAL_ERROR_COPY,
  entitlement_unconfirmed: PHONE_REVEAL_WATERFALL_CREDENTIAL_ERROR_COPY,
  lusha_id_reuse_unconfirmed: PHONE_REVEAL_WATERFALL_CREDENTIAL_ERROR_COPY,

  // Momento.
  rate_limited: PHONE_REVEAL_WATERFALL_RATE_LIMITED_COPY,

  // Disponibilidad del proveedor.
  provider_error: PHONE_REVEAL_WATERFALL_PROVIDER_UNAVAILABLE_COPY,
  provider_network_error: PHONE_REVEAL_WATERFALL_PROVIDER_UNAVAILABLE_COPY,
  malformed_provider_response: PHONE_REVEAL_WATERFALL_PROVIDER_UNAVAILABLE_COPY,
  lusha_leg_threw: PHONE_REVEAL_WATERFALL_PROVIDER_UNAVAILABLE_COPY,

  // Gates locales de autorización y elegibilidad.
  feature_disabled: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  unauthorized_role: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  role_not_allowed: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  bulk_not_allowed: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  candidate_not_editable: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  candidate_not_found: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  invalid_candidate: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  missing_cost_confirmation: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  apollo_not_exhausted: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  existing_phone_present: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
  waiting_lusha_ticket: PHONE_REVEAL_WATERFALL_NOT_AUTHORIZED_COPY,
};

/**
 * Frase para un cierre terminal en `error`. Un motivo desconocido —o ausente— cae en
 * el genérico de siempre, que sigue sin afirmar que no exista teléfono.
 */
export function resolvePhoneRevealTerminalErrorCopy(
  errorCode: string | null | undefined,
): string {
  if (!errorCode) return PHONE_REVEAL_WATERFALL_ERROR_COPY;
  return TERMINAL_ERROR_COPY_BY_CODE[errorCode] ?? PHONE_REVEAL_WATERFALL_ERROR_COPY;
}
