/**
 * web-company-bank-deposit.ts — cómo entra al banco lo que el tope de entrega dejó
 * fuera de una búsqueda web (Tavily o «Claude busca empresas»). Puro: sin env, sin I/O.
 *
 * AGENT1-DELIVERY-CAP-HARD-1 — regla de la dueña (07-10-2026): «mínimo 5 y máximo 10
 * por búsqueda; el resto va al banco». Hasta ahora sólo Apollo guardaba su sobrante;
 * el de Tavily y el de Claude se perdía (`deliveryCappedCompanies` sin destino).
 *
 * Mismas reglas que Apollo (`apollo-company-bank-bridge.ts`):
 *   · completa (contaba para la meta) ⇒ `ready`; si no ⇒ `to_complete`;
 *   · sin dominio, sin candidato guardable o sin ninguna clave de reclamo ⇒ no entra.
 *
 * La diferencia: no hay evidencia de Apollo. El payload lleva sólo el candidato
 * (`pipeline_candidate_v1`), que es lo que el banco primero sabe volver a escribir,
 * y el banco lo guarda con `source_provider = 'tavily'` (origen web): al sacarlo se
 * escribe como empresa de la web, no como de Apollo.
 */

import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import type { DeliveryCappedCompany } from '@/server/agents/prospecting-toolkit/types';
import { APOLLO_BANK_MISSING_TARGET_CONDITIONS } from './apollo-company-bank-bridge';
import { COMPANY_BANK_MAX_PAYLOAD_BYTES, type CompanyBankDepositItem } from './company-bank-types';
import { PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND } from './pipeline-candidate-bank-payload';

export type WebBankDepositPlan = {
  items: CompanyBankDepositItem[];
  /** Lo que NO puede ir al banco (se pierde como antes). */
  notBankable: DeliveryCappedCompany[];
};

export function planWebBankDeposit(input: {
  countryCode: string;
  macroIndustryKey: string | null;
  sourceBatchId: string | null;
  requestedSubindustries?: readonly string[];
  capped: readonly DeliveryCappedCompany[];
}): WebBankDepositPlan {
  if (!input.macroIndustryKey || !/^[A-Z]{2}$/.test(input.countryCode)) {
    return { items: [], notBankable: [...input.capped] };
  }
  const items: CompanyBankDepositItem[] = [];
  const notBankable: DeliveryCappedCompany[] = [];
  for (const company of input.capped) {
    const domain = company.domain ? normalizeDomain(company.domain) : null;
    const claims = (company.claims ?? []).filter((claim) => claim.key.trim() !== '');
    const payload = company.bankCandidate
      ? {
          kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
          candidate: company.bankCandidate,
          requestedSubindustries: [...(input.requestedSubindustries ?? [])],
        }
      : null;
    if (
      !domain ||
      claims.length === 0 ||
      payload === null ||
      Buffer.byteLength(JSON.stringify(payload), 'utf8') > COMPANY_BANK_MAX_PAYLOAD_BYTES
    ) {
      notBankable.push(company);
      continue;
    }
    const ready = company.countsTowardTarget === true;
    items.push({
      countryCode: input.countryCode,
      macroIndustryKey: input.macroIndustryKey,
      tier: ready ? 'ready' : 'to_complete',
      sourceProvider: 'tavily',
      claims,
      payload,
      missingFields: ready ? [] : [APOLLO_BANK_MISSING_TARGET_CONDITIONS],
      sourceBatchId: input.sourceBatchId,
    });
  }
  return { items, notBankable };
}
