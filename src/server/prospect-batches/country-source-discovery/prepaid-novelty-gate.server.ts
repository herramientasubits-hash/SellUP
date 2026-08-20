/**
 * prepaid-novelty-gate.server.ts — el cableado de PRODUCCIÓN de la capa previa al
 * pago. Un solo constructor para las dos rutas de proveedor.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 10, 11, 12, 25, 30(E).
 *
 * Aquí y sólo aquí se resuelven los clientes. El núcleo (`runPrePaidNoveltyGate`)
 * sigue sin conocer Supabase, sin leer env y sin poder escribir.
 *
 * ── 🔴 Ninguna dep puede gastar ──────────────────────────────────────────────
 *
 * Las tres son de lectura: el snapshot local de Colombia, el detector canónico de
 * duplicados (SellUp + HubSpot, por empresa) y un lector ACOTADO de dominios
 * conocidos. No se importa ninguna RPC de presupuesto y ningún cliente de
 * proveedor. La capa gratuita no puede gastar porque no tiene con qué.
 *
 * ── 🔴 HubSpot: por candidato, jamás el CRM entero (§ 10 / § 30(E)) ──────────
 *
 * El detector canónico consulta HubSpot POR EMPRESA. Para la lista de exclusión,
 * en cambio, sólo se leen dominios que YA están en SellUp (`accounts`): enumerar
 * el CRM completo para construirla sería una exportación sin cota, que el hito
 * prohíbe expresamente. Es una asimetría deliberada, no un olvido.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import {
  runPrePaidNoveltyGate,
  type ListKnownExclusionDomains,
  type PrePaidNoveltyGateInput,
  type PrePaidNoveltyGateResult,
} from './run-prepaid-novelty-gate';
import { buildCountrySourceAdapter } from './country-source-capability';
import { buildCoSiisDiscoverySnapshotQuery } from './co-siis-snapshot-query';
import { PREPAID_EXCLUSION_DOMAIN_CAP } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';

/**
 * Lector acotado de dominios conocidos de SellUp.
 *
 * `accounts` es la identidad más fuerte que SellUp tiene sobre una empresa que YA
 * es suya. El límite es duro y el orden estable, para que dos corridas idénticas
 * construyan la misma lista y la petición al proveedor sea reproducible.
 */
function buildKnownExclusionDomainsReader(
  client: ReturnType<typeof createSupabaseAdminClient>,
): ListKnownExclusionDomains {
  return async ({ countryCode, limit }) => {
    const safeLimit = Math.max(0, Math.min(Math.trunc(limit), PREPAID_EXCLUSION_DOMAIN_CAP * 2));
    if (safeLimit === 0) return [];
    try {
      const { data, error } = await client
        .from('accounts')
        .select('domain')
        .eq('country_code', countryCode)
        .not('domain', 'is', null)
        .order('domain', { ascending: true })
        .limit(safeLimit);
      if (error || !data) return [];
      return (data as Array<{ domain: string | null }>).map((row) => row.domain);
    } catch {
      return [];
    }
  };
}

/**
 * Resuelve el plan previo al pago con las deps reales.
 *
 * Nunca lanza. Si la factoría aprobada no puede producir un cliente (env ausente
 * o inseguro — falla cerrada por diseño), la fuente queda «sin cablear» y el
 * resultado es fail-open: `residualGap = requestedTarget` y la ruta de pago se
 * comporta exactamente como hoy.
 */
export async function runProductionPrePaidNoveltyGate(
  input: PrePaidNoveltyGateInput,
): Promise<PrePaidNoveltyGateResult> {
  let adminClient: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    adminClient = createSupabaseAdminClient();
  } catch {
    adminClient = null;
  }

  return runPrePaidNoveltyGate(input, {
    countrySourceAdapter: adminClient
      ? buildCountrySourceAdapter(input.countryCode, {
          coSiisSnapshotQuery: buildCoSiisDiscoverySnapshotQuery(adminClient),
        })
      : null,
    checkCompanyDuplicate: adminClient ? (dupInput) => checkCompanyDuplicate(dupInput) : null,
    listKnownExclusionDomains: adminClient
      ? buildKnownExclusionDomainsReader(adminClient)
      : null,
  });
}
