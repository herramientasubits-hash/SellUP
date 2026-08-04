/**
 * phone-reveal-credit-budget-core.ts — Preflight PURO de saldo de créditos del
 * reveal de teléfono (Agente 2A · AGENT2A-PHONE-WATERFALL-4D).
 *
 * Por qué existe: al eliminar el modal de consentimiento, el ÚNICO clic del
 * operador crea la corrida y arranca Apollo de inmediato. Ya no hay un paso
 * intermedio en el que alguien pueda darse cuenta de que no queda saldo, así que
 * el saldo tiene que comprobarse SERVER-SIDE **antes** de crear la corrida — no
 * después, y nunca en el cliente.
 *
 * PURO por contrato: sin I/O, sin Supabase, sin fetch, sin process.env, sin
 * Date.now(). El saldo llega ya resuelto como dato, igual que los flags llegan ya
 * resueltos a los otros cores de este módulo. Eso lo hace testeable OFFLINE, que
 * es el único modo en que este hito puede probarse: 0 proveedores reales, 0
 * créditos.
 *
 * Deliberadamente dependency-free: no importa nada del waterfall, de Apollo ni de
 * Lusha. Los topes se reflejan aquí como constantes y un test estático verifica
 * que sigan siendo los del core del waterfall (misma convención que
 * phone-reveal-waterfall-copy.ts).
 *
 * Qué NO decide este módulo:
 *   * no decide si el operador puede revelar (eso son flag + rol, aguas arriba);
 *   * no reserva, no descuenta y no escribe nada: solo compara dos números;
 *   * no convierte un saldo desconocido en un permiso.
 */

// ── Topes exigidos por modalidad ───────────────────────────────

/**
 * Modalidad de gasto de UNA autorización. Es el vocabulario del preflight y no el
 * de la tabla: `apollo_only` no es un `run_mode` — es un `full_waterfall` cuyo
 * candidato no tiene pata Lusha alcanzable, así que su tope es 8 y no 13.
 */
export type PhoneRevealCreditBudgetMode =
  /** Apollo (hasta 8) y, si no encuentra teléfono, Lusha (hasta 5). Total 13. */
  | 'full_waterfall'
  /** Solo Apollo: el candidato no tiene identificador Lusha reutilizable. Total 8. */
  | 'apollo_only'
  /** Solo Lusha: Apollo ya se intentó bajo OTRA autorización. Total 5. */
  | 'legacy_lusha_only';

/** Espejo de PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS (8). */
export const PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS = 8;

/** Espejo de PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS (5). */
export const PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS = 5;

/** Espejo de PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA (13 = 8 + 5). */
export const PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS =
  PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS +
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS;

/**
 * Créditos que la modalidad exige tener DISPONIBLES antes de crear la corrida.
 *
 * Es el TOPE de la autorización completa, no un costo previsto: el operador
 * autoriza hasta esa cifra en un clic, así que el saldo tiene que cubrirla entera.
 * Comprobar solo la primera pata dejaría a la segunda autorizada sin saldo, y esa
 * segunda pata la ejecuta el servidor sin volver a preguntar.
 */
export function resolvePhoneRevealCreditBudgetRequiredCredits(
  mode: PhoneRevealCreditBudgetMode,
): number {
  switch (mode) {
    case 'full_waterfall':
      return PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS;
    case 'apollo_only':
      return PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS;
    case 'legacy_lusha_only':
      return PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS;
    default: {
      // Una modalidad nueva rompe la compilación aquí a propósito: decidir cuánto
      // saldo exige una forma de gasto inédita es una decisión de producto. En
      // runtime, fail-closed hacia el tope MÁS ALTO.
      const exhaustive: never = mode;
      void exhaustive;
      return PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS;
    }
  }
}

/** Modalidad a partir de las dos señales que ya resuelve el servidor. */
export function resolvePhoneRevealCreditBudgetMode(args: {
  /** true cuando la autorización cubre ÚNICAMENTE la pata Lusha (ruta legacy). */
  legacyLushaOnly: boolean;
  /** true cuando el candidato tiene identificador Lusha reutilizable. */
  lushaEligible: boolean;
}): PhoneRevealCreditBudgetMode {
  if (args.legacyLushaOnly) return 'legacy_lusha_only';
  return args.lushaEligible ? 'full_waterfall' : 'apollo_only';
}

// ── Saldo ──────────────────────────────────────────────────────

/**
 * Saldo de créditos tal como llega del servidor. Es una unión y NO un `number |
 * null` a propósito: "no hay límite configurado" y "no se pudo leer el límite" son
 * dos hechos distintos y colapsarlos convierte uno de los dos en una mentira.
 *
 *   * `unlimited`  — no hay regla de crédito que aplicar. No se inventa un tope.
 *   * `available`  — hay regla y este es el saldo restante (puede ser 0).
 *   * `unavailable`— la comprobación no se pudo completar. FAIL-CLOSED: no se
 *     autoriza gasto sobre un saldo que nadie pudo verificar.
 */
export type PhoneRevealCreditBalance =
  | { kind: 'unlimited' }
  | { kind: 'available'; credits: number }
  | { kind: 'unavailable' };

/**
 * Desenlace del preflight.
 *
 *   * `authorized`         — hay saldo (o no hay límite): se puede crear la corrida.
 *   * `insufficient_credits` — el saldo NO cubre el tope de la modalidad.
 *   * `balance_unavailable`  — el saldo no se pudo verificar (fail-closed).
 *
 * Los dos rechazos son distintos porque le dicen al operador cosas distintas: en
 * el primero sabemos que no alcanza; en el segundo no sabemos nada, y afirmar
 * "no hay créditos suficientes" sería inventarse un hecho.
 */
export type PhoneRevealCreditBudgetDecision =
  | 'authorized'
  | 'insufficient_credits'
  | 'balance_unavailable';

export interface PhoneRevealCreditBudgetVerdict {
  decision: PhoneRevealCreditBudgetDecision;
  /** Tope que la modalidad exigía. Siempre presente: es el número que se comparó. */
  requiredCredits: number;
  /**
   * Saldo con el que se comparó. `null` cuando no había límite configurado o
   * cuando no se pudo leer — nunca 0 en esos casos: 0 significa "no queda saldo".
   */
  availableCredits: number | null;
}

/**
 * Compara el tope de la modalidad contra el saldo. NO escribe, NO reserva y NO
 * llama a nadie: es la última comprobación barata antes de la primera escritura.
 *
 * Un saldo no finito (NaN, Infinity, un número que llegó roto del driver) se trata
 * como NO verificable, no como grande: fail-closed.
 */
export function evaluatePhoneRevealCreditBudget(args: {
  mode: PhoneRevealCreditBudgetMode;
  balance: PhoneRevealCreditBalance;
}): PhoneRevealCreditBudgetVerdict {
  const requiredCredits = resolvePhoneRevealCreditBudgetRequiredCredits(args.mode);

  if (args.balance.kind === 'unlimited') {
    return { decision: 'authorized', requiredCredits, availableCredits: null };
  }
  if (args.balance.kind === 'unavailable') {
    return { decision: 'balance_unavailable', requiredCredits, availableCredits: null };
  }

  const credits = args.balance.credits;
  if (typeof credits !== 'number' || !Number.isFinite(credits)) {
    return { decision: 'balance_unavailable', requiredCredits, availableCredits: null };
  }

  return {
    decision: credits >= requiredCredits ? 'authorized' : 'insufficient_credits',
    requiredCredits,
    availableCredits: credits,
  };
}

/**
 * Combina los saldos de los proveedores que la autorización puede llegar a llamar
 * en UN saldo, de la forma más conservadora posible:
 *
 *   * un solo `unavailable` ⇒ `unavailable` (fail-closed: no se sabe si alcanza);
 *   * todos `unlimited`     ⇒ `unlimited`   (no hay ningún límite que aplicar);
 *   * en cualquier otro caso ⇒ el MÍNIMO de los saldos numéricos.
 *
 * El mínimo es deliberado: el tope que se compara es el de la autorización
 * COMPLETA, y el proveedor con menos saldo es el que puede quedarse sin él a mitad
 * del waterfall — que es exactamente el escenario que ya no tiene un segundo clic
 * donde detenerse. Sobre-bloquear aquí solo cuesta un clic más tarde; sub-bloquear
 * cuesta créditos.
 *
 * Una lista vacía es `unlimited`: no hay proveedor al que aplicarle un límite.
 */
export function combinePhoneRevealCreditBalances(
  balances: readonly PhoneRevealCreditBalance[],
): PhoneRevealCreditBalance {
  if (balances.some((b) => b.kind === 'unavailable')) return { kind: 'unavailable' };

  const numeric = balances
    .filter((b): b is { kind: 'available'; credits: number } => b.kind === 'available')
    .map((b) => b.credits);

  if (numeric.length === 0) return { kind: 'unlimited' };
  if (numeric.some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
    return { kind: 'unavailable' };
  }
  return { kind: 'available', credits: Math.min(...numeric) };
}

/**
 * Proveedores que la modalidad puede llegar a llamar. Es lo que decide de QUIÉN se
 * lee el saldo: pedir el saldo de Apollo en una corrida legacy bloquearía por un
 * proveedor que no va a ejecutarse.
 */
export function resolvePhoneRevealCreditBudgetProviders(
  mode: PhoneRevealCreditBudgetMode,
): readonly string[] {
  switch (mode) {
    case 'full_waterfall':
      return ['apollo', 'lusha'];
    case 'apollo_only':
      return ['apollo'];
    case 'legacy_lusha_only':
      return ['lusha'];
    default: {
      const exhaustive: never = mode;
      void exhaustive;
      // Fail-closed: se comprueban LOS DOS, que es el conjunto más restrictivo.
      return ['apollo', 'lusha'];
    }
  }
}
