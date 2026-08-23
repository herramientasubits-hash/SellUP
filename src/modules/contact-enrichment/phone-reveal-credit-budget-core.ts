/**
 * phone-reveal-credit-budget-core.ts — Preflight PURO de saldo del reveal de teléfono
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4D, endurecido en 4E).
 *
 * Por qué existe: al eliminar el modal de consentimiento, el ÚNICO clic del operador
 * crea la corrida y arranca Apollo de inmediato. Ya no hay un paso intermedio en el
 * que alguien pueda darse cuenta de que no queda saldo, así que el saldo se comprueba
 * SERVER-SIDE **antes** de crear la corrida — no después, y nunca en el cliente.
 *
 * ── EL MODELO PRESUPUESTARIO REAL (AGENT2A-PHONE-WATERFALL-4E) ────────────────
 *
 * El presupuesto de esta plataforma es **POR PROVEEDOR**, no un pozo compartido:
 *
 *   * `budget_rules` tiene UNA regla por (provider_key × scope), y el scope se
 *     resuelve user → group (ancestro más cercano) → role → global
 *     (`matchRule` en src/modules/budgets/budget-resolution.ts);
 *   * el consumo se agrega desde `provider_usage_logs` para ESE provider_key dentro
 *     del período de la regla (`getConsumptionForUser/Groups/Role/Global`);
 *   * `remainingCredits = max(0, limit_credits - consumed_credits)`;
 *   * NO existe ninguna columna de "reservado" en ese modelo.
 *
 * Consecuencias que este módulo tiene que respetar:
 *
 *   1. NO hay un saldo único que pueda cubrir 13. Los 8 de Apollo solo salen de la
 *      regla de Apollo y los 5 de Lusha solo de la de Lusha. Un waterfall completo
 *      exige **Apollo ≥ 8 Y Lusha ≥ 5 por separado**, jamás "algún saldo ≥ 13".
 *   2. La versión anterior combinaba los saldos con un MÍNIMO genérico y comparaba
 *      ese mínimo contra 13. Eso es incorrecto en las dos direcciones: bloqueaba
 *      autorizaciones viables (Apollo 10 y Lusha 6 ⇒ min 6 < 13, cuando cada pata
 *      tenía de sobra) y su semántica no era declarable — "el mínimo" no responde a
 *      la pregunta "¿alcanza para esta pata?". Ese helper se ELIMINÓ.
 *   3. SIN regla de crédito no hay disponibilidad que reservar. 4D lo trataba como
 *      `unlimited` y autorizaba; 4E lo trata como `budget_not_configured` y BLOQUEA:
 *      el waterfall no puede correr sobre un techo imaginario, y la reserva atómica
 *      (migración 104) no tendría contra qué descontar.
 *
 * La semántica de pozo COMPARTIDO también está modelada, explícitamente y con su
 * propio tope (13 / 8 / 5), para que la diferencia sea una decisión legible en el tipo
 * y no una suposición: si algún día el presupuesto pasa a ser compartido, se cambia
 * `model` y el compilador exige tratar el caso. Hoy el valor real es
 * `PHONE_REVEAL_CREDIT_BUDGET_MODEL = 'per_provider'`.
 *
 * PURO por contrato: sin I/O, sin Supabase, sin fetch, sin process.env, sin
 * Date.now(). Los saldos llegan ya resueltos como dato, igual que los flags llegan ya
 * resueltos a los otros cores de este módulo. Eso lo hace testeable OFFLINE, que es el
 * único modo en que este hito puede probarse: 0 proveedores reales, 0 créditos.
 *
 * Deliberadamente dependency-free: no importa nada del waterfall, de Apollo ni de
 * Lusha. Los topes se reflejan aquí como constantes y un test estático verifica que
 * sigan siendo los del core del waterfall (misma convención que
 * phone-reveal-waterfall-copy.ts).
 *
 * Qué NO decide este módulo:
 *   * no decide si el operador puede revelar (eso son flag + rol, aguas arriba);
 *   * no reserva ni escribe: la reserva es ATÓMICA y vive en la migración 104,
 *     porque la disponibilidad solo se puede serializar dentro de la transacción;
 *   * no convierte un saldo desconocido en un permiso.
 */

// ── Topes exigidos por modalidad ───────────────────────────────

/**
 * Modalidad de gasto de UNA autorización. Es el vocabulario del preflight y no el
 * de la tabla: `apollo_only` no es un `run_mode` — es un `full_waterfall` cuyo
 * candidato no tiene pata Lusha alcanzable, así que su tope es 8 y no 13.
 */
export type PhoneRevealCreditBudgetMode =
  /**
   * Apollo (hasta 8) y, si no encuentra teléfono, el reveal de Lusha (hasta 5).
   * Total 13. Es la modalidad de un candidato cuya identidad Lusha YA se conoce —
   * porque nació en Lusha, o porque una autorización anterior ya la resolvió y la
   * persistió— así que NO hay que pagar para averiguarla.
   */
  | 'full_waterfall'
  /**
   * Apollo (hasta 8) + búsqueda de identidad en Lusha (hasta 1) + reveal de Lusha
   * (hasta 5). Total 14.
   * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
   *
   * Es el candidato nacido en Apollo: alcanzable por Lusha, pero solo DESPUÉS de
   * pagar por saber con qué id lo conoce Lusha. Ese crédito NO se esconde dentro de
   * los 5 del reveal — son dos operaciones distintas, contra la misma bolsa, y
   * fundirlas volvería incontable justamente el gasto que este hito introduce.
   */
  | 'full_waterfall_with_identity_search'
  /** Solo Apollo: el candidato no tiene identificador Lusha reutilizable. Total 8. */
  | 'apollo_only'
  /** Solo Lusha: Apollo ya se intentó bajo OTRA autorización. Total 5. */
  | 'legacy_lusha_only'
  /**
   * «Buscar más números» (AGENT2A-SEARCH-MORE-PHONES-1). Total 5, el tope de UNA pata de
   * Lusha.
   *
   * NO existe una modalidad hermana para Apollo, y eso es el contrato de v1: la respuesta
   * de Apollo ya se persiste ENTERA desde 4O-C y Apollo no expone ninguna operación de
   * «más teléfonos», así que una pata de Apollo aquí reservaría un pozo para un gasto que
   * ninguna rama puede cobrar.
   *
   * Comparte cifra con `legacy_lusha_only` porque es la MISMA pata de Lusha con el MISMO
   * tope, pero NO comparte modalidad: la condición de entrada es la opuesta
   * (`legacy_lusha_only` exige que el candidato NO tenga teléfono, `search_more` exige que
   * SÍ lo tenga), y colapsarlas volvería indistinguibles dos autorizaciones distintas en el
   * ledger.
   */
  | 'search_more_lusha';

/** Proveedores que una autorización de reveal puede llegar a cobrar. Conjunto CERRADO. */
export const PHONE_REVEAL_CREDIT_PROVIDER_KEYS = ['apollo', 'lusha'] as const;

export type PhoneRevealCreditProviderKey =
  (typeof PHONE_REVEAL_CREDIT_PROVIDER_KEYS)[number];

/**
 * QUÉ operación paga una pata. Espejo del CHECK
 * `phone_reveal_credit_reservations_operation_key_check` (migración 124).
 *
 * El proveedor ya no basta como grano: Lusha cobra DOS cosas distintas en la misma
 * autorización —averiguar quién es la persona, y darnos su teléfono— y con una sola
 * fila por proveedor la segunda sería indistinguible de la primera en el ledger.
 */
export const PHONE_REVEAL_CREDIT_OPERATION_KEYS = [
  'phone_reveal',
  'contact_search',
] as const;

export type PhoneRevealCreditOperationKey =
  (typeof PHONE_REVEAL_CREDIT_OPERATION_KEYS)[number];

/**
 * Tope de la búsqueda de identidad de Lusha: **1 crédito**.
 *
 * No es una estimación nuestra. Lusha factura Contact Search a través de `api_search`
 * y cobra 1 crédito por petición a la API, con un mínimo de 1 incluso cuando la
 * respuesta no devuelve resultados. Por eso el tope es exactamente 1 y por eso una
 * búsqueda sin resultados se liquida igual: el mínimo se cobró.
 */
export const PHONE_REVEAL_CREDIT_BUDGET_IDENTITY_SEARCH_REQUIRED_CREDITS = 1;

/** Espejo de PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS (8). */
export const PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS = 8;

/** Espejo de PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS (5). */
export const PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS = 5;

/** Espejo de PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA (13 = 8 + 5). */
export const PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS =
  PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS +
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS;

/**
 * Espejo de PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH (14 = 8 + 1 + 5).
 */
export const PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_WITH_SEARCH_REQUIRED_CREDITS =
  PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS +
  PHONE_REVEAL_CREDIT_BUDGET_IDENTITY_SEARCH_REQUIRED_CREDITS;

/**
 * UNA pata exigida por la modalidad: qué proveedor y cuántos créditos suyos hacen
 * falta. Es la unidad del modelo per-provider y la unidad de la reserva atómica: cada
 * pata se reserva contra SU propio pozo.
 */
export interface PhoneRevealCreditRequirement {
  providerKey: PhoneRevealCreditProviderKey;
  /**
   * Qué operación de ese proveedor paga esta pata. Junto con `providerKey` forma la
   * identidad de la pata en la reserva (migración 124): una autorización puede tener
   * `lusha/contact_search` y `lusha/phone_reveal` a la vez, y sin este campo serían
   * la misma fila.
   */
  operationKey: PhoneRevealCreditOperationKey;
  /** Tope de ESA pata (Apollo 8 / Lusha search 1 / Lusha reveal 5). Nunca el total. */
  credits: number;
}

/**
 * Patas que la modalidad exige, en el orden en que se intentan.
 *
 * Es el TOPE de la autorización completa desglosado por proveedor, no un costo
 * previsto: el operador autoriza hasta esa cifra en un clic, así que cada pozo tiene
 * que cubrir su pata entera. Comprobar solo la primera dejaría a la segunda autorizada
 * sin saldo, y esa segunda pata la ejecuta el servidor sin volver a preguntar.
 */
export function resolvePhoneRevealCreditRequirements(
  mode: PhoneRevealCreditBudgetMode,
): readonly PhoneRevealCreditRequirement[] {
  switch (mode) {
    case 'full_waterfall':
      return [
        {
          providerKey: 'apollo',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
        },
        {
          providerKey: 'lusha',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
        },
      ];
    // TRES patas, y el orden es el de ejecución: Apollo primero, y solo si no
    // encuentra teléfono se averigua la identidad Lusha y después se revela. La
    // búsqueda va ANTES del reveal porque sin ella el reveal no tiene a quién pedirle
    // nada.
    case 'full_waterfall_with_identity_search':
      return [
        {
          providerKey: 'apollo',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
        },
        {
          providerKey: 'lusha',
          operationKey: 'contact_search',
          credits: PHONE_REVEAL_CREDIT_BUDGET_IDENTITY_SEARCH_REQUIRED_CREDITS,
        },
        {
          providerKey: 'lusha',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
        },
      ];
    case 'apollo_only':
      return [
        {
          providerKey: 'apollo',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
        },
      ];
    // Una corrida `search_more` autoriza EXACTAMENTE UNA pata: Lusha. Sólo el pozo de
    // Lusha se lee y sólo el pozo de Lusha se ocupa, así que el presupuesto de Apollo no
    // puede bloquear esta operación ni quedar reservado por ella.
    case 'search_more_lusha':
      return [
        {
          providerKey: 'lusha',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
        },
      ];
    case 'legacy_lusha_only':
      return [
        {
          providerKey: 'lusha',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
        },
      ];
    default: {
      // Una modalidad nueva rompe la compilación aquí a propósito: decidir cuánto
      // saldo exige una forma de gasto inédita es una decisión de producto. En
      // runtime, fail-closed hacia el conjunto MÁS restrictivo (las dos patas).
      const exhaustive: never = mode;
      void exhaustive;
      return [
        {
          providerKey: 'apollo',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
        },
        {
          providerKey: 'lusha',
          operationKey: 'contact_search',
          credits: PHONE_REVEAL_CREDIT_BUDGET_IDENTITY_SEARCH_REQUIRED_CREDITS,
        },
        {
          providerKey: 'lusha',
          operationKey: 'phone_reveal',
          credits: PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
        },
      ];
    }
  }
}

/**
 * Total que la modalidad puede llegar a cobrar (13 / 8 / 5). Es la SUMA de las patas y
 * existe para el copy, la auditoría y `max_credits_authorized` — NO es lo que se
 * compara contra ningún saldo en el modelo per-provider.
 */
export function resolvePhoneRevealCreditBudgetRequiredCredits(
  mode: PhoneRevealCreditBudgetMode,
): number {
  return resolvePhoneRevealCreditRequirements(mode).reduce(
    (total, leg) => total + leg.credits,
    0,
  );
}

/**
 * Modalidad a partir de las señales que ya resuelve el servidor.
 *
 * `lushaIdentityResolved` es lo que separa 13 de 14, y por eso se responde ANTES del
 * clic: si la identidad Lusha ya está persistida, esta autorización NO puede gastar
 * una búsqueda, así que reservar ese crédito le quitaría disponibilidad a otra
 * operación por un gasto que no puede ocurrir. Ausente ⇒ `false`, que es el valor
 * MÁS conservador (reserva de más, nunca de menos) y además el que preserva el
 * comportamiento de todo caller anterior a este hito.
 */
export function resolvePhoneRevealCreditBudgetMode(args: {
  /** true cuando la autorización cubre ÚNICAMENTE la pata Lusha (ruta legacy). */
  legacyLushaOnly: boolean;
  /** true cuando el candidato puede llegar a la pata Lusha. */
  lushaEligible: boolean;
  /**
   * true cuando ya se conoce el id nativo de Lusha (candidato nacido en Lusha, o
   * identidad resuelta y persistida por una autorización anterior).
   */
  lushaIdentityResolved?: boolean;
}): PhoneRevealCreditBudgetMode {
  if (args.legacyLushaOnly) return 'legacy_lusha_only';
  if (!args.lushaEligible) return 'apollo_only';
  return args.lushaIdentityResolved === true
    ? 'full_waterfall'
    : 'full_waterfall_with_identity_search';
}

/**
 * Proveedores cuyo saldo hay que resolver para esta modalidad. Es lo que decide de
 * QUIÉN se lee el presupuesto: pedir el de Apollo en una corrida legacy bloquearía por
 * un proveedor que no va a ejecutarse.
 */
export function resolvePhoneRevealCreditBudgetProviders(
  mode: PhoneRevealCreditBudgetMode,
): readonly PhoneRevealCreditProviderKey[] {
  // DEDUPLICADO: desde que una modalidad puede exigir DOS patas del mismo proveedor
  // (búsqueda + reveal de Lusha), mapear patas a proveedores devolvería `lusha` dos
  // veces y el caller leería su pozo dos veces. El pozo es uno.
  return [
    ...new Set(resolvePhoneRevealCreditRequirements(mode).map((leg) => leg.providerKey)),
  ];
}

// ── Modelo presupuestario ──────────────────────────────────────

/**
 * Modelos posibles. `per_provider` es el REAL hoy (ver la cabecera): una regla y un
 * consumo por proveedor. `shared` está modelado para que la alternativa sea explícita
 * y su tope (13 / 8 / 5) esté declarado, no supuesto.
 */
export type PhoneRevealCreditBudgetModel = 'per_provider' | 'shared';

/**
 * Modelo VIGENTE, verificado contra src/modules/budgets/budget-resolution.ts. Cambiarlo
 * obliga al compilador a tratar la otra rama de `evaluatePhoneRevealCreditBudget`.
 */
export const PHONE_REVEAL_CREDIT_BUDGET_MODEL: PhoneRevealCreditBudgetModel =
  'per_provider';

/**
 * Regla de crédito resuelta para UN proveedor, con todo lo que la reserva atómica
 * necesita para identificar su pozo.
 *
 *   * `configured`     — hay regla con límite en créditos. `limitCredits` y
 *     `consumedCredits` son los de esa regla y su período.
 *   * `not_configured` — NO hay regla con límite en créditos para ese proveedor. NO es
 *     "ilimitado": es "no hay disponibilidad que reservar" y bloquea (4E).
 *   * `unavailable`    — la resolución no se pudo completar. FAIL-CLOSED: no se
 *     autoriza gasto sobre un presupuesto que nadie pudo leer.
 */
export type PhoneRevealCreditPoolState =
  | {
      kind: 'configured';
      /** `budget_rules.limit_credits` de la regla que ganó el match. */
      limitCredits: number;
      /** Consumo agregado de `provider_usage_logs` en el período de la regla. */
      consumedCredits: number;
      /**
       * Exposición ya reservada en el MISMO pozo. En producción la calcula la
       * migración 104 dentro de la transacción (es el único lugar donde puede ser
       * atómica); aquí es un dato inyectable para que la fórmula sea verificable
       * OFFLINE y este core sea un espejo exacto del SQL. Ausente ⇒ 0.
       */
      reservedCredits?: number;
      /** Scope que ganó el match: identifica el pozo junto con el período. */
      scopeType: 'user' | 'group' | 'role' | 'global';
      /** users.id / group id / role key, o null en una regla global. Opaco. */
      scopeId: string | null;
      periodStart: string;
      periodEnd: string;
    }
  | { kind: 'not_configured' }
  | { kind: 'unavailable' };

export interface PhoneRevealCreditPool {
  providerKey: PhoneRevealCreditProviderKey;
  state: PhoneRevealCreditPoolState;
}

/**
 * Presupuesto tal como llega del servidor, con el MODELO explícito en el tipo. No es un
 * `number | null`: "no hay regla configurada" y "no se pudo leer la regla" son dos
 * hechos distintos y colapsarlos convierte uno de los dos en una mentira.
 */
export type PhoneRevealCreditBudgetInput =
  | {
      model: 'per_provider';
      /** Un pozo por proveedor exigido. Un proveedor exigido y ausente ⇒ fail-closed. */
      pools: readonly PhoneRevealCreditPool[];
    }
  | {
      model: 'shared';
      /**
       * Pozo ÚNICO contra el que se compara el TOTAL de la modalidad (13 / 8 / 5).
       * Semántica declarada, no inferida: aquí sí tiene sentido un solo número, porque
       * las dos patas saldrían del mismo sitio.
       */
      pool: PhoneRevealCreditPoolState;
    };

// ── Veredicto ──────────────────────────────────────────────────

/**
 * Desenlace del preflight.
 *
 *   * `authorized`            — hay saldo en cada pozo exigido: se puede reservar.
 *   * `insufficient_credits`  — al menos un pozo NO cubre su pata.
 *   * `budget_not_configured` — al menos un proveedor exigido no tiene regla de
 *     crédito. No hay disponibilidad que reservar (4E), así que no se ejecuta nada.
 *   * `balance_unavailable`   — al menos un presupuesto no se pudo leer. Fail-closed.
 *
 * Los tres rechazos son distintos porque le dicen al operador cosas distintas: en el
 * primero sabemos que no alcanza; en el segundo sabemos que nadie configuró un
 * presupuesto; en el tercero no sabemos nada, y afirmar "no hay créditos suficientes"
 * sería inventarse un hecho.
 */
export type PhoneRevealCreditBudgetDecision =
  | 'authorized'
  | 'insufficient_credits'
  | 'budget_not_configured'
  | 'balance_unavailable';

export interface PhoneRevealCreditBudgetLegVerdict {
  providerKey: PhoneRevealCreditProviderKey;
  /**
   * Tope EXIGIDO A ESE POZO. Siempre presente: es el número que se comparó.
   *
   * Cuando una modalidad exige varias operaciones del mismo proveedor, es la SUMA de
   * ellas (Lusha = búsqueda 1 + reveal 5 = 6). Comparar cada operación por separado
   * contra el mismo saldo es exactamente cómo se autoriza un gasto de 6 sobre un
   * pozo de 5.
   */
  requiredCredits: number;
  /**
   * Operaciones que componen ese total, en orden de ejecución. Existe para que el
   * desglose no se pierda al agregar: el pozo se pregunta por 6, pero la auditoría
   * tiene que poder decir de dónde salen.
   */
  operationKeys: readonly PhoneRevealCreditOperationKey[];
  /**
   * Disponible en SU pozo (`limit - consumed - reserved`). `null` cuando no había regla
   * o no se pudo leer — nunca 0 en esos casos: 0 significa "no queda saldo".
   */
  availableCredits: number | null;
  decision: PhoneRevealCreditBudgetDecision;
}

export interface PhoneRevealCreditBudgetVerdict {
  decision: PhoneRevealCreditBudgetDecision;
  /** Total de la modalidad (13 / 8 / 5). Es la suma de las patas. */
  requiredCredits: number;
  /** Veredicto por pata. En el modelo compartido hay UNA entrada sintética. */
  legs: readonly PhoneRevealCreditBudgetLegVerdict[];
}

/**
 * Disponible de un pozo configurado. `limit - consumed - reserved`, exactamente la
 * fórmula de `try_reserve_phone_reveal_credits` (migración 104). Puede ser negativo si
 * el consumo se pasó del límite, y no se recorta a 0 a propósito: recortar escondería
 * el sobregiro.
 */
function resolveAvailableCredits(state: {
  limitCredits: number;
  consumedCredits: number;
  reservedCredits?: number;
}): number | null {
  const { limitCredits, consumedCredits } = state;
  const reserved = state.reservedCredits ?? 0;
  if (
    !Number.isFinite(limitCredits) ||
    !Number.isFinite(consumedCredits) ||
    !Number.isFinite(reserved)
  ) {
    // Un número roto del driver se trata como NO verificable, no como grande.
    return null;
  }
  return limitCredits - consumedCredits - reserved;
}

/**
 * Demanda TOTAL de una modalidad sobre UN pozo: el proveedor, la suma de sus
 * operaciones y cuáles son. Es la unidad real de la comparación presupuestaria.
 */
export interface PhoneRevealCreditPoolDemand {
  providerKey: PhoneRevealCreditProviderKey;
  credits: number;
  operationKeys: readonly PhoneRevealCreditOperationKey[];
}

/**
 * Agrupa las patas por PROVEEDOR y suma sus créditos, preservando el orden de
 * ejecución tanto entre proveedores como dentro de cada uno.
 *
 * 🔴 Esta agregación es lo que impide un sobregiro silencioso. El saldo de Lusha es
 * UNO: la búsqueda y el reveal salen del mismo sitio. Preguntarle "¿tienes 1?" y
 * luego "¿tienes 5?" son dos preguntas que un pozo con 5 responde que sí, tras lo
 * cual se le reservan 6. La única pregunta correcta es "¿tienes 6?".
 */
export function resolvePhoneRevealCreditPoolDemands(
  mode: PhoneRevealCreditBudgetMode,
): readonly PhoneRevealCreditPoolDemand[] {
  const byProvider = new Map<PhoneRevealCreditProviderKey, PhoneRevealCreditPoolDemand>();
  for (const requirement of resolvePhoneRevealCreditRequirements(mode)) {
    const existing = byProvider.get(requirement.providerKey);
    if (existing) {
      byProvider.set(requirement.providerKey, {
        providerKey: requirement.providerKey,
        credits: existing.credits + requirement.credits,
        operationKeys: [...existing.operationKeys, requirement.operationKey],
      });
      continue;
    }
    byProvider.set(requirement.providerKey, {
      providerKey: requirement.providerKey,
      credits: requirement.credits,
      operationKeys: [requirement.operationKey],
    });
  }
  return [...byProvider.values()];
}

/** Veredicto de UN pozo contra la demanda AGREGADA de la modalidad sobre él. */
function evaluateLeg(
  requirement: PhoneRevealCreditPoolDemand,
  state: PhoneRevealCreditPoolState | undefined,
): PhoneRevealCreditBudgetLegVerdict {
  const base = {
    providerKey: requirement.providerKey,
    requiredCredits: requirement.credits,
    operationKeys: requirement.operationKeys,
  };

  // Un proveedor exigido para el que no llegó pozo NO es "sin límite": es un dato que
  // falta, y un dato que falta no autoriza gasto.
  if (!state || state.kind === 'unavailable') {
    return { ...base, availableCredits: null, decision: 'balance_unavailable' };
  }
  if (state.kind === 'not_configured') {
    return { ...base, availableCredits: null, decision: 'budget_not_configured' };
  }

  const available = resolveAvailableCredits(state);
  if (available === null) {
    return { ...base, availableCredits: null, decision: 'balance_unavailable' };
  }
  return {
    ...base,
    availableCredits: available,
    decision:
      available >= requirement.credits ? 'authorized' : 'insufficient_credits',
  };
}

/**
 * Precedencia del veredicto agregado, de más a menos incierto:
 *
 *   balance_unavailable > budget_not_configured > insufficient_credits > authorized
 *
 * Lo incierto gana porque el copy no puede afirmar más de lo que se comprobó: si un
 * pozo no se pudo leer, decir "no hay presupuesto configurado" o "no hay créditos
 * suficientes" sería declarar un hecho que nadie verificó. Los tres bloquean igual.
 */
const DECISION_PRECEDENCE: readonly PhoneRevealCreditBudgetDecision[] = [
  'balance_unavailable',
  'budget_not_configured',
  'insufficient_credits',
];

function aggregateDecision(
  legs: readonly PhoneRevealCreditBudgetLegVerdict[],
): PhoneRevealCreditBudgetDecision {
  for (const decision of DECISION_PRECEDENCE) {
    if (legs.some((leg) => leg.decision === decision)) return decision;
  }
  return 'authorized';
}

/**
 * Compara lo que la modalidad exige contra el presupuesto. NO escribe, NO reserva y NO
 * llama a nadie: es la última comprobación barata antes de la reserva atómica.
 *
 * En el modelo REAL (`per_provider`) exige **cada pata contra su propio pozo**: Apollo
 * ≥ 8 y/o Lusha ≥ 5. En el modelo `shared` exige el TOTAL (13 / 8 / 5) contra el pozo
 * único. No hay ninguna regla genérica intermedia — un "mínimo" sin semántica no
 * responde a ninguna de las dos preguntas.
 */
export function evaluatePhoneRevealCreditBudget(args: {
  mode: PhoneRevealCreditBudgetMode;
  budget: PhoneRevealCreditBudgetInput;
}): PhoneRevealCreditBudgetVerdict {
  const requirements = resolvePhoneRevealCreditRequirements(args.mode);
  const requiredCredits = requirements.reduce((total, leg) => total + leg.credits, 0);
  // Una demanda por POZO, no una por pata: dos operaciones del mismo proveedor
  // compiten por el mismo saldo y se comparan sumadas.
  const demands = resolvePhoneRevealCreditPoolDemands(args.mode);

  if (args.budget.model === 'shared') {
    // Pozo único: la pata sintética es la autorización COMPLETA, así que su tope es el
    // total de la modalidad y su `providerKey` es el primer proveedor exigido (el que
    // arranca). El desglose por proveedor no aplica: no hay dos pozos que distinguir.
    const leg = evaluateLeg(
      {
        providerKey: requirements[0]?.providerKey ?? 'apollo',
        credits: requiredCredits,
        operationKeys: requirements.map((requirement) => requirement.operationKey),
      },
      args.budget.pool,
    );
    return { decision: leg.decision, requiredCredits, legs: [leg] };
  }

  const byProvider = new Map<string, PhoneRevealCreditPoolState>(
    args.budget.pools.map((pool) => [pool.providerKey, pool.state]),
  );
  const legs = demands.map((demand) =>
    evaluateLeg(demand, byProvider.get(demand.providerKey)),
  );

  return { decision: aggregateDecision(legs), requiredCredits, legs };
}
