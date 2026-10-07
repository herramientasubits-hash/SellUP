/**
 * web-company-bank-deposit.server.ts — guarda en el banco lo que el tope de entrega
 * dejó fuera de una búsqueda web (Tavily o «Claude busca empresas»).
 *
 * AGENT1-DELIVERY-CAP-HARD-1. Best-effort: sin banco (apagado, sin cliente o con la
 * migración 142 sin aplicar) o si falla, no hace nada y nunca lanza: la búsqueda
 * termina igual que antes.
 */

import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';
import type { DeliveryCappedCompany } from '@/server/agents/prospecting-toolkit/types';
import { resolveApolloCompanyBankPort } from './apollo-company-bank-port.server';
import { planWebBankDeposit } from './web-company-bank-deposit';

export async function depositWebSurplusToBank(input: {
  countryCode: string | null;
  /** Clave de la macro industria si ya se conoce; si no, se resuelve por el nombre. */
  macroIndustryKey?: string | null;
  industryName: string | null;
  sourceBatchId: string | null;
  requestedSubindustries?: readonly string[];
  capped: readonly DeliveryCappedCompany[] | undefined;
}): Promise<void> {
  try {
    const capped = input.capped ?? [];
    if (capped.length === 0 || !input.countryCode || !input.sourceBatchId) return;
    const port = resolveApolloCompanyBankPort();
    if (!port) return;
    const macroIndustryKey =
      input.macroIndustryKey ?? resolveMacroIndustryKey({ slug: null, displayName: input.industryName });
    const plan = planWebBankDeposit({
      countryCode: input.countryCode,
      macroIndustryKey,
      sourceBatchId: input.sourceBatchId,
      requestedSubindustries: input.requestedSubindustries,
      capped,
    });
    if (plan.items.length === 0) return;
    const deposit = await port.store.deposit(plan.items);
    console.info('[company-bank] web surplus deposit', {
      batchId: input.sourceBatchId,
      status: deposit.status,
      planned: plan.items.length,
      notBankable: plan.notBankable.length,
      ...(deposit.status === 'ok'
        ? {
            deposited: deposit.deposited,
            skippedInBank: deposit.skippedInBank,
            skippedClaimed: deposit.skippedClaimed,
            skippedInvalid: deposit.skippedInvalid,
          }
        : { reason: deposit.reason }),
    });
  } catch (err) {
    console.error('[company-bank] web surplus deposit failed (non-critical):', err instanceof Error ? err.message : err);
  }
}
