/**
 * apollo-company-bank-port.server.ts — el banco de empresas tal como lo ve la
 * corrida de Apollo en Producción.
 *
 * AGENT1-COMPANY-BANK. Ver `docs/agent1/COMPANY_BANK_DESIGN.md`.
 *
 * `null` ⇒ sin banco: el interruptor `AGENT1_COMPANY_BANK_DISABLED` está puesto o
 * no hay cliente de servicio. La corrida se comporta entonces exactamente como
 * antes del banco (lo recortado va a «Descartadas»). Si la migración 142 no está
 * aplicada, el almacén responde `unavailable` y el resultado es el mismo.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { createCompanyBankStore, type CompanyBankStore } from './company-bank-store';
import { isCompanyBankDisabled } from './apollo-company-bank-bridge';

export type ApolloCompanyBankPort = {
  store: CompanyBankStore;
  /**
   * Qué empresas del banco quedaron escritas en el lote (dominio normalizado ⇒ id
   * del candidato). `null` si la lectura falla: el llamador no cierra nada y las
   * reservas vencen solas.
   */
  readPersistedCandidateIdsByDomain(
    batchId: string,
    domains: readonly string[],
  ): Promise<Map<string, string> | null>;
};

export function resolveApolloCompanyBankPort(
  env: Record<string, string | undefined> = process.env,
): ApolloCompanyBankPort | null {
  if (isCompanyBankDisabled(env)) return null;
  let client: ReturnType<typeof createSupabaseAdminClient>;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return null;
  }
  return {
    store: createCompanyBankStore(client),
    async readPersistedCandidateIdsByDomain(batchId, domains) {
      const wanted = [...new Set(domains)];
      if (wanted.length === 0) return new Map();
      try {
        const { data, error } = await client
          .from('prospect_candidates')
          .select('id, domain')
          .eq('batch_id', batchId)
          .in('domain', wanted);
        if (error || !data) return null;
        const byDomain = new Map<string, string>();
        for (const row of data as Array<{ id: string; domain: string | null }>) {
          const domain = row.domain ? normalizeDomain(row.domain) : null;
          if (domain && !byDomain.has(domain)) byDomain.set(domain, row.id);
        }
        return byDomain;
      } catch {
        return null;
      }
    },
  };
}
