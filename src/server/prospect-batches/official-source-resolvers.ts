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
 * name→RUC, Paraguay (py_set_registry) name→RUC, Uruguay
 * (uy_rupe_registry) name→RUT, Estados Unidos (SEC, then IRS) name→EIN and
 * España (es_placsp_registry, adjudicatarias) name→NIF, Chile
 * (cl_sii_registry, then cl_res_registry) name→RUT, Costa Rica (cr_company_registry)
 * name→cédula jurídica, Bolivia (SEPREC, live) name→NIT and México
 * (mx_compranet_rfc_registry, proveedores del Estado) name→RFC and Panamá
 * (pa_panamacompra_ruc_registry, proveedores del Estado) name→RUC; Honduras uses
 * hn_ocds_rtn_registry (ONCAE + SEFIN) before the 72-row pilot. No promise for
 * other countries is made here;
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
import { normalizeUruguayCompanyCore } from '@/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';
import { normalizeUsCompanyCore } from '@/server/source-catalog/connectors/us-ein/us-ein-registry-rows';
import { normalizeSpainCompanyCore } from '@/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import {
  MX_COMPRANET_RFC_SOURCE_KEY,
  normalizeMexicoCompanyCore,
} from '@/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import {
  normalizePanamaCompanyCore,
  PA_PANAMACOMPRA_RUC_SOURCE_KEY,
} from '@/server/source-catalog/connectors/panamacompra-pa/pa-panamacompra-ruc-rows';
import {
  HN_OCDS_RTN_SOURCE_KEY,
  normalizeHondurasCompanyCore,
} from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';
import { normalizeChileCompanyCore } from '@/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import {
  CL_SII_REGISTRY_SOURCE_KEY,
  normalizeChileSiiCore,
} from '@/server/source-catalog/connectors/sii-chile/cl-sii-registry-rows';
import { normalizeCostaRicaCompanyCore } from '@/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';
import {
  BO_SEPREC_LIVE_SOURCE_KEY,
  buildSeprecNameLiveQuery,
  normalizeBoliviaCompanyCore,
} from '@/server/source-catalog/connectors/seprec-bolivia/seprec-name-live-query';
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
    // SOURCES-HN-RTN-BY-NAME-1 — personas jurídicas de ONCAE + SEFIN (OCDS, 2018-2026);
    // si no da RTN fuerte, el snapshot piloto de Contrataciones Abiertas (72 filas).
    createFallbackOfficialSourceResolver(
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'HN',
        sourceKey: HN_OCDS_RTN_SOURCE_KEY,
        taxIdentifierType: 'RTN',
        validTaxId: /^\d{4}9\d{9}$/,
        normalizeCore: normalizeHondurasCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, HN_OCDS_RTN_SOURCE_KEY, 'HN'),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'HN',
        sourceKey: 'hn_contrataciones_abiertas',
        taxIdentifierType: 'RTN',
        validTaxId: /^\d{14}$/,
        normalizeCore: normalizeCentralAmericaCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, 'hn_contrataciones_abiertas', 'HN'),
      }),
    ),
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
    // SOURCES-UY-RUT-BY-NAME-1 — empresas activas del RUPE (proveedores del Estado).
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'UY',
      sourceKey: 'uy_rupe_registry',
      taxIdentifierType: 'RUT',
      validTaxId: /^\d{12}$/,
      normalizeCore: normalizeUruguayCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'uy_rupe_registry', 'UY'),
    }),
    // SOURCES-US-EIN-BY-NAME-1 — empresas activas de la SEC primero; si no dan EIN
    // fuerte, organizaciones sin ánimo de lucro grandes del IRS. Requiere la
    // migración 141 (tipo 'EIN') antes de cargar estas fuentes.
    createFallbackOfficialSourceResolver(
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'US',
        sourceKey: 'us_sec_edgar_registry',
        taxIdentifierType: 'EIN',
        validTaxId: /^\d{2}-\d{7}$/,
        normalizeCore: normalizeUsCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, 'us_sec_edgar_registry', 'US'),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'US',
        sourceKey: 'us_irs_eo_registry',
        taxIdentifierType: 'EIN',
        validTaxId: /^\d{2}-\d{7}$/,
        normalizeCore: normalizeUsCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, 'us_irs_eo_registry', 'US'),
      }),
    ),
    // SOURCES-ES-NIF-BY-NAME-1 — sociedades adjudicatarias de la Plataforma de
    // Contratación. Requiere la migración 141 (tipo 'NIF') antes de cargarla.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'ES',
      sourceKey: 'es_placsp_registry',
      taxIdentifierType: 'NIF',
      validTaxId: /^[A-HJNPQRSUVW]\d{7}[0-9A-J]$/,
      normalizeCore: normalizeSpainCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'es_placsp_registry', 'ES'),
    }),
    // SOURCES-CL-SII-REGISTRY-1 — personas jurídicas activas del SII (desde 1993,
    // con trabajadores informados); si no da RUT fuerte, el Registro de Empresas
    // y Sociedades (SOURCES-CL-RUT-BY-NAME-1, sólo constituidas desde 2013).
    createFallbackOfficialSourceResolver(
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'CL',
        sourceKey: CL_SII_REGISTRY_SOURCE_KEY,
        taxIdentifierType: 'RUT',
        validTaxId: /^\d{7,8}-[\dK]$/,
        normalizeCore: normalizeChileSiiCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, CL_SII_REGISTRY_SOURCE_KEY, 'CL', {
          withWorkforce: true,
        }),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'CL',
        sourceKey: 'cl_res_registry',
        taxIdentifierType: 'RUT',
        validTaxId: /^\d{7,8}-[\dK]$/,
        normalizeCore: normalizeChileCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, 'cl_res_registry', 'CL'),
      }),
    ),
    // SOURCES-MX-RFC-BY-NAME-1 — personas morales con contratos en CompraNet
    // (sólo quienes le vendieron al Estado). Un nombre de una sola palabra sin
    // forma societaria («Softtek») queda como pista: una marca suelta puede ser otra.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'MX',
      sourceKey: MX_COMPRANET_RFC_SOURCE_KEY,
      taxIdentifierType: 'RFC',
      validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
      normalizeCore: normalizeMexicoCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, MX_COMPRANET_RFC_SOURCE_KEY, 'MX'),
      singleWordIsSignalOnly: true,
    }),
    // SOURCES-PA-RUC-BY-NAME-1 — personas jurídicas del buscador de proveedores de
    // PanamaCompraEnCifras (sólo quienes participan en compras públicas).
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'PA',
      sourceKey: PA_PANAMACOMPRA_RUC_SOURCE_KEY,
      taxIdentifierType: 'RUC',
      validTaxId: /^\d{3,}-\d{1,4}-\d{1,7}$/,
      normalizeCore: normalizePanamaCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, PA_PANAMACOMPRA_RUC_SOURCE_KEY, 'PA'),
      singleWordIsSignalOnly: true,
    }),
    // SOURCES-CR-CEDULA-BY-NAME-1 — PYMES activas del MEIC + proveedores SICOP con nombre.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'CR',
      sourceKey: 'cr_company_registry',
      taxIdentifierType: 'cedula_juridica',
      validTaxId: /^3\d{9}$/,
      normalizeCore: normalizeCostaRicaCompanyCore,
      querySnapshots: buildSnapshotNameQuery(snapshotClient, 'cr_company_registry', 'CR'),
    }),
    // SOURCES-BO-NIT-BY-NAME-LIVE-1 — Bolivia no publica padrón: búsqueda EN VIVO en
    // el registro de comercio (SEPREC), acotada en tiempo y en número de consultas.
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'BO',
      sourceKey: BO_SEPREC_LIVE_SOURCE_KEY,
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{7,13}$/,
      normalizeCore: normalizeBoliviaCompanyCore,
      querySnapshots: buildSeprecNameLiveQuery(),
      singleWordIsSignalOnly: true,
    }),
  ];
}
