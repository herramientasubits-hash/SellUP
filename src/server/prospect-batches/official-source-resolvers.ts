/**
 * Q3F-5BB.10C2 / AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — provider-neutral
 * official-source resolver wiring, shared by every discovery provider (Lusha,
 * Apollo, and any future one) that adopts the shared intake seam
 * (`@/server/agents/prospect-intake`).
 *
 * Builds the injected `OfficialSourceResolver[]` the pure core hands to
 * `enrichNormalizedProspectWithOfficialSources`. Today that is one resolver
 * per supported country: Colombia (co_siis, then the cámaras de comercio
 * registry live) name→NIT, República Dominicana
 * (rd_dgii_bulk) name→RNC, Argentina (ar_rns_registry) name→CUIT, Ecuador
 * (ec_scvs snapshot) name→RUC, Guatemala (gt_rgae_proveedores) name→NIT and
 * Honduras (hn_contrataciones_abiertas) name→RTN and Perú (pe_sunat_registry)
 * name→RUC and Paraguay (py_set_registry) name→RUC. No promise of MX/… enrichment
 * is made here;
 * unsupported countries fall through to the shared "unsupported" result (soft
 * warning) automatically.
 *
 * The factory keeps its historical name `buildColombiaOfficialSourceResolvers`
 * because callers and guard tests import it by that name.
 *
 * Safe client: the snapshot reads are RLS-locked to `service_role`, so it uses
 * the approved, env-guarded `createSupabaseAdminClient` factory (NOT an
 * inline `createClient(process.env…)`). The client is used strictly
 * READ-ONLY (a bounded SELECT against `source_company_snapshots`). It is
 * NEVER used to write — every write in a caller's flow still goes through
 * that caller's own RLS session client.
 *
 * Best-effort: if the approved factory cannot produce a client (missing/unsafe
 * env — it fails closed by design), this returns `[]`, and enrichment
 * degrades to the shared "source_catalog_unavailable" soft warning. It never
 * throws, so it can never break a caller's flow.
 *
 * Provider-neutral by design: this module has no Lusha- or Apollo-specific
 * logic. Do not add provider-specific branches here — a provider-specific
 * need belongs in that provider's own bridge/wiring module, injecting a
 * provider-specific resolver alongside this one instead.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import { createColombiaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/colombia-official-source-resolver';
import { buildColombiaSnapshotQuery } from '@/server/prospect-batches/colombia-snapshot-query';
import { createDominicanOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';
import { buildDominicanSnapshotQuery } from '@/server/prospect-batches/dominican-republic-snapshot-query';
import { createArgentinaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/argentina-official-source-resolver';
import { buildArgentinaSnapshotQuery } from '@/server/prospect-batches/argentina-snapshot-query';
import { createEcuadorOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/ecuador-official-source-resolver';
import { buildEcuadorSnapshotQuery } from '@/server/prospect-batches/ecuador-snapshot-query';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { buildSnapshotNameQuery } from '@/server/prospect-batches/snapshot-name-query';
import {
  CENTRAL_AMERICA_LEGAL_FORMS,
  normalizeCompanyNameCore,
} from '@/server/source-catalog/company-name-core';
import { normalizePeruCompanyCore } from '@/server/source-catalog/connectors/sunat-peru/pe-sunat-registry-row';
import { normalizeParaguayCompanyCore } from '@/server/source-catalog/connectors/set-paraguay/py-set-registry-row';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import {
  buildRuesNameLiveQuery,
  CO_RUES_LIVE_SOURCE_KEY,
  normalizeColombiaCompanyCore,
} from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/rues-name-live-query';

const normalizeCentralAmericaCore = (name: string | null | undefined) =>
  normalizeCompanyNameCore(name, CENTRAL_AMERICA_LEGAL_FORMS);

/**
 * Build the read-only official-source resolvers shared by every discovery
 * provider. Returns `[]` (never throws) when a safe service-role client is
 * unavailable.
 */
export function buildColombiaOfficialSourceResolvers(): OfficialSourceResolver[] {
  let snapshotClient;
  try {
    snapshotClient = createSupabaseAdminClient();
  } catch {
    // Env missing/unsafe (factory fails closed) → no resolver; enrichment is a
    // soft "source_catalog_unavailable" and the caller's flow continues unaffected.
    return [];
  }

  return [
    // SOURCES-CO-RUES-LIVE-NIT-1 — Supersociedades primero; si no da NIT fuerte,
    // el registro de las cámaras de comercio en vivo (gratuito, sólo lectura).
    createFallbackOfficialSourceResolver(
      createColombiaOfficialSourceResolver({
        querySnapshots: buildColombiaSnapshotQuery(snapshotClient),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'CO',
        sourceKey: CO_RUES_LIVE_SOURCE_KEY,
        taxIdentifierType: 'NIT',
        validTaxId: /^[89]\d{8}$/,
        normalizeCore: normalizeColombiaCompanyCore,
        querySnapshots: buildRuesNameLiveQuery(),
        singleWordIsSignalOnly: true,
      }),
    ),
    createDominicanOfficialSourceResolver({
      querySnapshots: buildDominicanSnapshotQuery(snapshotClient),
    }),
    createArgentinaOfficialSourceResolver({
      querySnapshots: buildArgentinaSnapshotQuery(snapshotClient),
    }),
    createEcuadorOfficialSourceResolver({
      querySnapshots: buildEcuadorSnapshotQuery(snapshotClient),
    }),
    // SOURCES-GT-HN-BY-NAME-1 — registros ya cargados; la dueña autorizó (30-09)
    // dejar de tratarlos como sólo lectura para la identidad fiscal.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'GT',
      sourceKey: 'gt_rgae_proveedores',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{4,12}K?$/,
      normalizeCore: normalizeCentralAmericaCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'gt_rgae_proveedores', 'GT'),
    }),
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'HN',
      sourceKey: 'hn_contrataciones_abiertas',
      taxIdentifierType: 'RTN',
      validTaxId: /^\d{14}$/,
      normalizeCore: normalizeCentralAmericaCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'hn_contrataciones_abiertas', 'HN'),
    }),
    // SOURCES-PE-RUC-BY-NAME-1 — sociedades activas y habidas del padrón de SUNAT.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'PE',
      sourceKey: 'pe_sunat_registry',
      taxIdentifierType: 'RUC',
      validTaxId: /^20\d{9}$/,
      normalizeCore: normalizePeruCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'pe_sunat_registry', 'PE'),
    }),
    // SOURCES-PY-RUC-BY-NAME-1 — sociedades activas del padrón de RUC de la SET.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'PY',
      sourceKey: 'py_set_registry',
      taxIdentifierType: 'RUC',
      validTaxId: /^80\d{6}-\d$/,
      normalizeCore: normalizeParaguayCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'py_set_registry', 'PY'),
    }),
  ];
}
