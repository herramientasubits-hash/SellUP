/**
 * AGENT1-AUDIT-WS2 § 10 — la puerta de cuota PROPIA de Apollo, decidida (puro).
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * La puerta pasaba con que quedara CUALQUIER crédito (`allowed` = disponible > 0)
 * e ignoraba cuánto puede gastar la corrida. Con 1 crédito disponible y una
 * corrida de peor caso 12, Apollo arrancaba y el gasto se comía la cuota de otro.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 *   · cuota agotada (`allowed: false`) ⇒ bloquea, como siempre;
 *   · cuota configurada con disponible < peor caso de la corrida ⇒ bloquea con el
 *     disponible real (la acción lo traduce a `insufficient_for_run`: mismo
 *     resultado y mismo copy que ya existían);
 *   · SIN cuota mensual configurada (`providerCreditsAvailable: null`) ⇒ PASA. Es
 *     una decisión documentada, no un hueco: sin límite configurado no se inventa
 *     ninguno (la misma disciplina que `checkProviderQuotaAvailable` y el panel de
 *     Proveedores). El tope real de esa corrida lo pone su presupuesto durable.
 *
 * Una estimación no positiva o ilegible no puede bloquear: se compara contra 1
 * (lo mínimo que una búsqueda cuesta), nunca contra 0.
 */

export type ProviderQuotaReading = {
  allowed: boolean;
  /** `null` ⇒ el proveedor no tiene cuota mensual configurada. */
  providerCreditsAvailable: number | null;
};

export type ProviderQuotaGateDecision =
  | { status: 'available'; providerCreditsAvailable: number | null }
  | { status: 'blocked'; providerCreditsAvailable: number };

export function decideApolloProviderQuotaGate(
  quota: ProviderQuotaReading,
  estimatedCredits: number,
): ProviderQuotaGateDecision {
  if (!quota.allowed) {
    return { status: 'blocked', providerCreditsAvailable: quota.providerCreditsAvailable ?? 0 };
  }
  const available = quota.providerCreditsAvailable;
  if (available === null) return { status: 'available', providerCreditsAvailable: null };
  const required =
    Number.isFinite(estimatedCredits) && estimatedCredits > 0 ? Math.ceil(estimatedCredits) : 1;
  if (available < required) return { status: 'blocked', providerCreditsAvailable: available };
  return { status: 'available', providerCreditsAvailable: available };
}
