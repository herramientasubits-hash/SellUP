/**
 * ¿Puede esta persona gastar N créditos de un proveedor? (dueña 28-10)
 *
 * Sólo mandan dos cosas, las dos en Configuración › Proveedores:
 *   · los créditos que el proveedor tiene (cupo mensual o saldo sincronizado);
 *   · el límite que un administrador haya puesto por persona, rol, grupo o para
 *     todos. Un límite «avisar» deja pasar; «bloquear» o «pedir aprobación», no.
 * Sin cupo ni límite configurado, no hay tope: no se inventa ninguno. Ya no hay
 * piloto, ni lista de personas, ni tope por búsqueda, ni bolsa aparte.
 *
 * Puro: el servidor lee las dos cosas y aquí sólo se decide.
 */

export interface ConfiguredQuotaReading {
  allowed: boolean;
  /** `null` = el proveedor no tiene cupo configurado. */
  providerCreditsAvailable: number | null;
}

export interface ConfiguredRuleReading {
  /** `false` sólo cuando la regla que aplica bloquea y la operación no cabe. */
  allowed: boolean;
  /** Lo que queda bajo la regla; `null` = sin regla o sin límite en créditos. */
  remainingCredits: number | null;
  /** `true` cuando la regla que aplica bloquea al pasarse (no sólo avisa). */
  enforces: boolean;
}

export type ConfiguredLimitDecision =
  | { status: 'available'; availableCredits: number | null }
  | { status: 'blocked'; reason: 'provider_quota' | 'rule'; availableCredits: number };

/** Lo mínimo que cuesta una operación: una estimación ilegible nunca vale 0. */
function requiredOf(credits: number): number {
  return Number.isFinite(credits) && credits > 0 ? Math.ceil(credits) : 1;
}

export function decideConfiguredLimit(input: {
  quota: ConfiguredQuotaReading;
  rule: ConfiguredRuleReading;
  requiredCredits: number;
}): ConfiguredLimitDecision {
  const required = requiredOf(input.requiredCredits);
  const quotaAvailable = input.quota.providerCreditsAvailable;
  if (!input.quota.allowed || (quotaAvailable !== null && quotaAvailable < required)) {
    return { status: 'blocked', reason: 'provider_quota', availableCredits: Math.max(0, quotaAvailable ?? 0) };
  }
  if (!input.rule.allowed) {
    return { status: 'blocked', reason: 'rule', availableCredits: Math.max(0, input.rule.remainingCredits ?? 0) };
  }
  // Lo que se puede gastar: lo menor entre el cupo y lo que deja una regla que bloquea.
  const ruleCap = input.rule.enforces ? input.rule.remainingCredits : null;
  const caps = [quotaAvailable, ruleCap].filter((value): value is number => value !== null);
  return { status: 'available', availableCredits: caps.length ? Math.min(...caps) : null };
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  tavily: 'Tavily',
};

/** Lo que se le dice a quien choca con un límite. */
export function configuredLimitMessage(providerKey: string, decision: Extract<ConfiguredLimitDecision, { status: 'blocked' }>): string {
  const provider = PROVIDER_LABELS[providerKey] ?? providerKey;
  const left = decision.availableCredits === 1 ? 'queda 1 crédito' : `quedan ${decision.availableCredits} créditos`;
  return decision.reason === 'provider_quota'
    ? `${provider} no tiene créditos suficientes para esta búsqueda (${left}).`
    : `Llegaste al límite de créditos de ${provider} que fijó un administrador en Configuración (${left}).`;
}
