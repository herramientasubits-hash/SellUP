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
 * Las cuatro son de lectura: los snapshots locales de Colombia, República
 * Dominicana y Argentina, el detector canónico de
 * duplicados (SellUp + HubSpot, por empresa), un lector ACOTADO de dominios
 * conocidos y —desde AGENT1-PROVIDER-SEEN-MEMORY-3— la memoria provider-seen. No se
 * importa ninguna RPC de presupuesto y ningún cliente de proveedor. La capa gratuita
 * no puede gastar porque no tiene con qué.
 *
 * 🔴 La memoria entra por el MISMO resolutor que usa la ruta de escritura
 * (`resolveProviderSeenStore`), no por un cliente propio: dos formas de elegir
 * credencial son dos formas de que una lea de un sitio y la otra escriba en otro.
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
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import {
  runPrePaidNoveltyGate,
  type ListKnownExclusionDomains,
  type PrePaidNoveltyGateInput,
  type PrePaidNoveltyGateResult,
} from './run-prepaid-novelty-gate';
import { resolveProviderSeenStore } from '@/server/prospect-batches/provider-seen/provider-seen-store';
import { buildCountrySourceAdapter } from './country-source-capability';
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import type { FindAlreadyInSellup } from './country-source-already-in-sellup';
import {
  buildCountrySourceOfficialTaxIdLookup,
  type LookUpCountrySourceOfficialTaxId,
} from './country-source-official-tax-id';
import { buildCoSiisDiscoverySnapshotQuery } from './co-siis-snapshot-query';
import { buildDoDgiiDiscoveryReads } from './do-dgii-snapshot-query';
import { buildArRnsDiscoveryReads } from './ar-rns-snapshot-query';
import { buildEcScvsDirectoryDiscoveryReads } from './ec-scvs-directory-snapshot-query';
import { buildClSiiDirectoryDiscoveryReads } from './cl-sii-directory-snapshot-query';
import { buildPeSunatDirectoryDiscoveryReads } from './pe-sunat-directory-snapshot-query';
import { buildPyDncpDirectoryDiscoveryReads } from './py-dncp-directory-snapshot-query';
import { buildGtGuatecomprasDirectoryDiscoveryReads } from './gt-guatecompras-directory-snapshot-query';
import { buildCrFreeDirectoryDiscoveryReads } from './cr-free-directory-snapshot-query';
import { buildMxDenueLiveReads } from '@/server/source-catalog/connectors/denue-mexico/denue-activity-live-reads';
import { resolveSourceCredential } from '@/server/source-catalog/source-connection-resolver';
import { PREPAID_EXCLUSION_DOMAIN_CAP } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import { isUnsearchedFreeLayerDiscard } from './country-source-prior-sightings';

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

/** Estados de candidata que NO bloquean volver a proponerla (§ 9: reconsideración). */
const NON_BLOCKING_CANDIDATE_STATUSES = ['discarded', 'rejected', 'archived', 'duplicate', 'qa_cleanup'];
/** Trozos para `in (...)`: la lista sale de la lectura de la fuente (cientos como mucho). */
const IN_CHUNK = 100;
/** Prefijos de host que `normalizeDomain` quita y con los que se guardan webs vivas. */
const ACTIVE_DOMAIN_HOST_PREFIXES = ['www.', 'www2.', 'www3.', 'ww2.', 'ww3.'];

function chunks<T>(values: readonly T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Webs por consulta: cada una viaja en 6 formas y la URL de PostgREST tiene límite. */
const DOMAIN_IN_CHUNK = 25;

/**
 * SOURCES-FREE-LAYER-ALREADY-SEEN-1 — lector de lo que SellUp ya tiene, con el
 * cliente de servicio (sólo SELECT). Ver `country-source-already-in-sellup.ts`.
 * Cualquier error ⇒ conjunto vacío (no se salta nada).
 */
export function buildFindAlreadyInSellup(client: ReturnType<typeof createSupabaseAdminClient>): FindAlreadyInSellup {
  return async ({ countryCode, taxIds, recordIdentityKeys, domains = [] }) => {
    const seen = new Set<string>();
    const unlessDomain = new Set<string>();
    const blockedDomains = new Set<string>();
    try {
      // SOURCES-FREE-LAYER-ACTIVE-DOMAIN-1 — candidatas VIVAS del mismo país con la
      // misma web. Se guardan con o sin prefijo de host (`www.`, `www2.`, `ww2.`…):
      // se piden esas formas y se compara ya canónica (`normalizeDomain`).
      for (const ids of chunks(domains, DOMAIN_IN_CHUNK)) {
        const { data } = await client
          .from('prospect_candidates')
          .select('domain')
          .eq('country_code', countryCode.toUpperCase())
          .in('domain', ids.flatMap((d) => [d, ...ACTIVE_DOMAIN_HOST_PREFIXES.map((prefix) => `${prefix}${d}`)]))
          .not('status', 'in', `(${NON_BLOCKING_CANDIDATE_STATUSES.join(',')})`);
        for (const row of (data ?? []) as Array<{ domain: string | null }>) {
          const canonical = row.domain ? normalizeDomain(row.domain) : null;
          if (canonical) blockedDomains.add(canonical);
        }
      }
      for (const ids of chunks(taxIds)) {
        const { data } = await client
          .from('prospect_candidates')
          .select('tax_identifier')
          .in('tax_identifier', ids)
          .not('status', 'in', `(${NON_BLOCKING_CANDIDATE_STATUSES.join(',')})`);
        for (const row of (data ?? []) as Array<{ tax_identifier: string | null }>) {
          if (row.tax_identifier) seen.add(`tax:${row.tax_identifier}`);
        }
      }
      for (const keys of chunks(recordIdentityKeys)) {
        const { data } = await client
          .from('prospect_candidates')
          .select('record_key:source_trace->>sourceRecordId')
          .in('source_trace->>sourceRecordId', keys)
          .not('status', 'in', `(${NON_BLOCKING_CANDIDATE_STATUSES.join(',')})`);
        for (const row of (data ?? []) as Array<{ record_key: string | null }>) {
          if (row.record_key) seen.add(row.record_key);
        }
      }
      const identifiers = [...taxIds.map((id) => `tax:${id}`), ...recordIdentityKeys];
      for (const ids of chunks(identifiers)) {
        const { data } = await client
          .from('prospect_discarded_dispositions')
          .select('provider_identifier, status, reason_code, created_at, rescue_decision:evidence->claude_rescue->>decision')
          .eq('source_primary', 'public_source')
          .in('status', ['discarded', 'sent_to_review'])
          .in('provider_identifier', ids);
        type Row = {
          provider_identifier: string | null;
          status: string;
          reason_code: string | null;
          created_at: string | null;
          rescue_decision: string | null;
        };
        const nowMs = Date.now();
        for (const row of (data ?? []) as Row[]) {
          if (!row.provider_identifier) continue;
          // AGENT1-FREE-LAYER-OVERFLOW-STAYS-IN-SOURCE-1 — sin web y el rescate nunca la
          // buscó (el lote ya estaba lleno): no cuenta como vista, se vuelve a ofrecer.
          if (isUnsearchedFreeLayerDiscard({ ...row, decision: row.rescue_decision }, nowMs)) continue;
          // Descartada SÓLO por falta de web y sin cierre: vuelve si ahora trae dominio.
          const openMissingDomain =
            row.status === 'discarded' &&
            row.reason_code === 'missing_domain_final' &&
            row.rescue_decision !== 'discard' &&
            row.rescue_decision !== 'duplicate';
          (openMissingDomain ? unlessDomain : seen).add(row.provider_identifier);
        }
      }
    } catch {
      return { blocked: new Set(), blockedUnlessDomain: new Set() };
    }
    return { blocked: seen, blockedUnlessDomain: unlessDomain, blockedDomains };
  };
}

function buildOfficialTaxIdLookupOrNull(): LookUpCountrySourceOfficialTaxId | null {
  try {
    return buildCountrySourceOfficialTaxIdLookup(buildColombiaOfficialSourceResolvers());
  } catch {
    return null;
  }
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
          doDgiiDiscoveryReads: buildDoDgiiDiscoveryReads(adminClient),
          arRnsDiscoveryReads: buildArRnsDiscoveryReads(adminClient),
          ecScvsDirectoryDiscoveryReads: buildEcScvsDirectoryDiscoveryReads(adminClient),
          clSiiDirectoryDiscoveryReads: buildClSiiDirectoryDiscoveryReads(adminClient),
          peSunatDirectoryDiscoveryReads: buildPeSunatDirectoryDiscoveryReads(adminClient),
          pyDncpDirectoryDiscoveryReads: buildPyDncpDirectoryDiscoveryReads(adminClient),
          gtGuatecomprasDirectoryDiscoveryReads: buildGtGuatecomprasDirectoryDiscoveryReads(adminClient),
          crFreeDirectoryDiscoveryReads: buildCrFreeDirectoryDiscoveryReads(adminClient),
          // SOURCES-MX-DENUE-FREE-DISCOVERY-1 — DENUE en vivo (gratuito); la clave sale
          // de la bóveda de secretos y sólo se pide si la corrida es de México.
          mxDenueDiscoveryReads: buildMxDenueLiveReads({
            getToken: async () => (await resolveSourceCredential('denue_mexico'))?.token ?? null,
          }),
        })
      : null,
    checkCompanyDuplicate: adminClient ? (dupInput) => checkCompanyDuplicate(dupInput) : null,
    // SOURCES-MX-FREE-LAYER-RFC-1 — las MISMAS fuentes oficiales por nombre que
    // Apollo, Tavily y Claude (sólo lectura de snapshots). DENUE no trae RFC.
    lookUpOfficialTaxId: buildOfficialTaxIdLookupOrNull(),
    // SOURCES-FREE-LAYER-ALREADY-SEEN-1 — no volver a proponer lo que SellUp ya
    // tiene en revisión o en Descartadas (sólo lectura).
    findAlreadyInSellup: adminClient ? buildFindAlreadyInSellup(adminClient) : null,
    listKnownExclusionDomains: adminClient
      ? buildKnownExclusionDomainsReader(adminClient)
      : null,
    // ADDENDUM PROVIDER-SEEN § 4 — la memoria de corridas anteriores. Sólo LEE, y
    // sólo alimenta la supresión de lo ya conocido: no decide dedupe (§ 6) y no
    // recorta el objetivo, que lo fija la capa gratuita. Una lectura rota degrada a
    // memoria vacía, que es exactamente el gasto de siempre.
    //
    // 🔴 CUT-L1 §§ 1, 4 — esa supresión es CLIENTE desde este corte: Lusha V3 no
    // tiene exclusión del lado del servidor, así que lo que la memoria alimenta es
    // la siembra del registro de identidad de la corrida.
    providerSeenStore: resolveProviderSeenStore(),
  });
}
