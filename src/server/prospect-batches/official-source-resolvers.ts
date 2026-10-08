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
 * (rd_dgii_bulk, then the DGII trade name as a signal only) name→RNC, Argentina (ar_rns_registry) name→CUIT, Ecuador
 * (SCVS registry with employees, its acronyms, the SRI registry, then ec_scvs) name→RUC, Guatemala (gt_nit_registry + gt_nit_name_alias, then gt_rgae_proveedores) name→NIT and
 * Honduras (hn_ocds_rtn_registry + hn_rtn_name_alias, then hn_contrataciones_abiertas) name→RTN and Perú (pe_sunat_registry +
 * pe_sunat_name_alias) name→RUC, Paraguay (py_set_registry) name→RUC, Uruguay
 * (uy_rupe_registry) name→RUT, Estados Unidos (SEC, then IRS) name→EIN and
 * España (es_placsp_registry, adjudicatarias) name→NIF, Chile
 * (cl_sii_registry, then cl_res_registry) name→RUT, Costa Rica (cr_company_registry +
 * cr_company_name_alias) name→cédula jurídica, Bolivia (large taxpayers snapshot, then SEPREC live) name→NIT and México
 * (mx_compranet_rfc_registry, proveedores del Estado) name→RFC and Panamá
 * (pa_ruc_registry + pa_ruc_name_alias: PanamaCompra y Grandes Contribuyentes de la DGI) name→RUC and Nicaragua
 * (ni_ruc_registry + ni_ruc_name_alias: Grandes Contribuyentes de la DGI y licencias del MINSA) name→RUC; Honduras uses
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
import {
  createDominicanOfficialSourceResolver,
  normalizeDominicanCompanyCore,
} from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';
import { DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY } from '@/server/source-catalog/connectors/dgii-rd/do-size-registry-rows';
import { buildDominicanSnapshotQuery } from '@/server/prospect-batches/dominican-republic-snapshot-query';
import { createArgentinaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/argentina-official-source-resolver';
import { buildArgentinaSnapshotQuery } from '@/server/prospect-batches/argentina-snapshot-query';
import {
  AR_PUBLIC_ENTITIES_SOURCE_KEY,
  normalizeArPublicEntityCore,
} from '@/server/source-catalog/connectors/rns-argentina/ar-public-entities';
import { buildEcuadorOfficialSourceResolver } from '@/server/prospect-batches/ecuador-official-source-chain';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { buildSnapshotNameQuery } from '@/server/prospect-batches/snapshot-name-query';
import {
  CENTRAL_AMERICA_LEGAL_FORMS,
  normalizeCompanyNameCore,
} from '@/server/source-catalog/company-name-core';
import { createPeruOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/peru-official-source-resolver';
import { buildPeruSnapshotNameQuery } from '@/server/prospect-batches/peru-snapshot-query';
import { createParaguayOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/paraguay-official-source-resolver';
import { buildParaguaySnapshotNameQuery } from '@/server/prospect-batches/paraguay-snapshot-query';
import { createGuatemalaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/guatemala-official-source-resolver';
import { buildGuatemalaSnapshotNameQuery } from '@/server/prospect-batches/guatemala-snapshot-query';
import { normalizeUruguayCompanyCore } from '@/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';
import { normalizeUsCompanyCore } from '@/server/source-catalog/connectors/us-ein/us-ein-registry-rows';
import { normalizeSpainCompanyCore } from '@/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import {
  MX_COMPRANET_RFC_SOURCE_KEY,
  normalizeMexicoCompanyCore,
} from '@/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import { MX_RFC_PUBLIC_LISTS_SOURCE_KEY } from '@/server/source-catalog/connectors/mx-rfc-public-lists/mx-rfc-public-lists-rows';
import { createPanamaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/panama-official-source-resolver';
import { buildPanamaSnapshotNameQuery } from '@/server/prospect-batches/panama-snapshot-query';
import { createNicaraguaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/nicaragua-official-source-resolver';
import { buildNicaraguaSnapshotNameQuery } from '@/server/prospect-batches/nicaragua-snapshot-query';
import { createHondurasOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/honduras-official-source-resolver';
import { buildHondurasSnapshotNameQuery } from '@/server/prospect-batches/honduras-snapshot-query';
import { normalizeChileCompanyCore } from '@/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import { createChileOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/chile-official-source-resolver';
import { buildChileSnapshotNameQuery } from '@/server/prospect-batches/chile-snapshot-query';
import { createCostaRicaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/costa-rica-official-source-resolver';
import { buildCostaRicaSnapshotNameQuery } from '@/server/prospect-batches/costa-rica-snapshot-query';
import {
  BO_SEPREC_LIVE_SOURCE_KEY,
  buildSeprecNameLiveQuery,
  normalizeBoliviaCompanyCore,
} from '@/server/source-catalog/connectors/seprec-bolivia/seprec-name-live-query';
import { boliviaDomainConfirmsName, boliviaNameCarriesLegalForm } from '@/server/source-catalog/connectors/seprec-bolivia/bo-company-name-core';
import { BO_LARGE_TAXPAYERS_SOURCE_KEY } from '@/server/source-catalog/connectors/sin-bolivia/bo-large-taxpayer-rows';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import {
  buildRuesNameLiveQuery,
  CO_RUES_LIVE_SOURCE_KEY,
  normalizeColombiaCompanyCore,
} from '@/server/source-catalog/connectors/personas-juridicas-cc-colombia/rues-name-live-query';
import { createColombiaDomainOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/colombia-domain-official-source-resolver';
import { coSingleWordConfirmedByDomain } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { buildColombiaDomainSnapshotQuery } from './colombia-domain-snapshot-query';

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
      // SOURCES-CO-CLOSE-1 — si no, la WEB: entidades públicas (CHIP + SIGEP) y la
      // web cargada del SIIS; y por último las cámaras en vivo, donde una marca de
      // una palabra sólo es segura si su propia web la confirma.
      createFallbackOfficialSourceResolver(
        createColombiaDomainOfficialSourceResolver({
          queryByDomain: buildColombiaDomainSnapshotQuery(snapshotClient),
        }),
        createSnapshotNameOfficialSourceResolver({
          countryCode: 'CO',
          sourceKey: CO_RUES_LIVE_SOURCE_KEY,
          taxIdentifierType: 'NIT',
          validTaxId: /^[89]\d{8}$/,
          normalizeCore: normalizeColombiaCompanyCore,
          querySnapshots: buildRuesNameLiveQuery(),
          singleWordIsSignalOnly: true,
          singleWordConfirmedByDomain: coSingleWordConfirmedByDomain,
        }),
      ),
    ),
    // SOURCES-DO-SIZE-SIGNAL-1 — razón social en el padrón DGII primero; si no da
    // RNC seguro, el nombre comercial («CODETEL»), que sólo deja una pista.
    createFallbackOfficialSourceResolver(
      createDominicanOfficialSourceResolver({
        querySnapshots: buildDominicanSnapshotQuery(snapshotClient),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'DO',
        sourceKey: DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
        taxIdentifierType: 'RNC',
        validTaxId: /^\d{9}$/,
        normalizeCore: (name) => normalizeDominicanCompanyCore(name ?? ''),
        querySnapshots: buildSnapshotNameQuery(snapshotClient, DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY, 'DO'),
        signalOnly: true,
      }),
    ),
    // SOURCES-AR-PUBLIC-ENTITIES-1 — si el registro de sociedades no da un CUIT
    // fuerte, el directorio de entidades públicas (municipios, organismos
    // nacionales, universidades). Un nombre de una sola palabra queda como pista.
    createFallbackOfficialSourceResolver(
      createArgentinaOfficialSourceResolver({
        querySnapshots: buildArgentinaSnapshotQuery(snapshotClient),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'AR',
        sourceKey: AR_PUBLIC_ENTITIES_SOURCE_KEY,
        taxIdentifierType: 'CUIT',
        validTaxId: /^(30|33|34)\d{9}$/,
        normalizeCore: normalizeArPublicEntityCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, AR_PUBLIC_ENTITIES_SOURCE_KEY, 'AR'),
        singleWordIsSignalOnly: true,
      }),
    ),
    // SOURCES-EC-CLOSE-1 — SCVS (activas, con empleados) → siglas → SRI (entidades
    // públicas) → nombre comercial (pista) → SCVS de julio; ver el módulo.
    buildEcuadorOfficialSourceResolver(snapshotClient),
    // SOURCES-GT-CLOSE-1 — registro unido de NIT (Guatecompras, entidades
    // compradoras, agentes de retención del IVA de la SAT y RGAE) con sus alias;
    // si no da un NIT fuerte, el RGAE de siempre (SOURCES-GT-HN-BY-NAME-1).
    createFallbackOfficialSourceResolver(
      createGuatemalaOfficialSourceResolver({
        querySnapshots: buildGuatemalaSnapshotNameQuery(snapshotClient),
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'GT',
        sourceKey: 'gt_rgae_proveedores',
        taxIdentifierType: 'NIT',
        validTaxId: /^\d{4,12}K?$/,
        normalizeCore: normalizeCentralAmericaCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, 'gt_rgae_proveedores', 'GT'),
      }),
    ),
    // SOURCES-HN-RTN-BY-NAME-1 — personas jurídicas de ONCAE + SEFIN (OCDS, 2018-2026);
    // si no da RTN fuerte, el snapshot piloto de Contrataciones Abiertas (72 filas).
    // SOURCES-HN-CLOSE-1 — con sus alias (hn_rtn_name_alias), variantes del nombre y
    // el tramo «*MIPYME*» para el filtro de tamaño.
    createFallbackOfficialSourceResolver(
      createHondurasOfficialSourceResolver({
        querySnapshots: buildHondurasSnapshotNameQuery(snapshotClient),
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
    // SOURCES-PE-CLOSE-1 — con sus alias y entidades públicas (pe_sunat_name_alias),
    // variantes del nombre y trabajadores para el filtro de tamaño.
    createPeruOfficialSourceResolver({
      querySnapshots: buildPeruSnapshotNameQuery(snapshotClient),
    }),
    // SOURCES-PY-RUC-BY-NAME-1 — sociedades activas del padrón de RUC de la SET.
    // SOURCES-PY-CLOSE-1 — con sus alias (py_set_name_alias), variantes del nombre,
    // regla de una palabra y el tamaño MIPYME declarado a la DNCP.
    createParaguayOfficialSourceResolver({
      querySnapshots: buildParaguaySnapshotNameQuery(snapshotClient),
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
    // SOURCES-CL-NAME-ALIAS-1 — con variantes del nombre, siglas de organismos
    // públicos y el nombre comercial al final de la razón social (cl_sii_name_alias).
    createFallbackOfficialSourceResolver(
      createChileOfficialSourceResolver({
        querySnapshots: buildChileSnapshotNameQuery(snapshotClient),
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
    // SOURCES-MX-RFC-PUBLIC-LISTS-1 — si CompraNet no da un RFC seguro, las listas
    // públicas del SAT (importadores, donatarias) y de Nuevo León, con la MISMA regla.
    // SOURCES-MX-SIZE-BAND-1 — las dos leen además la estratificación declarada
    // (MICRO / PEQUEÑA / MEDIANA / GRANDE) para el gate ICP de tamaño.
    createFallbackOfficialSourceResolver(
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'MX',
        sourceKey: MX_COMPRANET_RFC_SOURCE_KEY,
        taxIdentifierType: 'RFC',
        validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
        normalizeCore: normalizeMexicoCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, MX_COMPRANET_RFC_SOURCE_KEY, 'MX', { withWorkforce: true }),
        singleWordIsSignalOnly: true,
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'MX',
        sourceKey: MX_RFC_PUBLIC_LISTS_SOURCE_KEY,
        taxIdentifierType: 'RFC',
        validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
        normalizeCore: normalizeMexicoCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, MX_RFC_PUBLIC_LISTS_SOURCE_KEY, 'MX', { withWorkforce: true }),
        singleWordIsSignalOnly: true,
      }),
    ),
    // SOURCES-PA-CLOSE-1 — registro unido de RUC de Panamá (proveedoras y entidades
    // compradoras de PanamaCompra + Grandes Contribuyentes de la DGI) y sus alias,
    // con limpieza propia de nombres, variantes con/sin «Panamá» y una palabra
    // segura sólo si la web la confirma. Sustituye a pa_panamacompra_ruc_registry.
    createPanamaOfficialSourceResolver({
      querySnapshots: buildPanamaSnapshotNameQuery(snapshotClient),
    }),
    // SOURCES-NI-CLOSE-2 — registro unido de RUC de Nicaragua (Grandes Contribuyentes
    // de la DGI 2019-2020 + licencias sanitarias del MINSA) y sus alias, con limpieza
    // propia de nombres (forma cortada por la DGI), variantes con/sin «Nicaragua» y
    // una palabra segura sólo si la web la confirma.
    createNicaraguaOfficialSourceResolver({
      querySnapshots: buildNicaraguaSnapshotNameQuery(snapshotClient),
    }),
    // SOURCES-CR-CEDULA-BY-NAME-1 — PYMES activas del MEIC + proveedores SICOP con nombre.
    // SOURCES-CR-CLOSE-1 — más Zona Franca, SUGEF, instituciones públicas de SICOP
    // (cédulas 2…/4…), alias (nombre anterior, siglas) y el tramo PYME del MEIC.
    createCostaRicaOfficialSourceResolver({
      querySnapshots: buildCostaRicaSnapshotNameQuery(snapshotClient),
    }),
    // SOURCES-BO-CLOSE-1 — Bolivia: primero la lista de grandes contribuyentes ya
    // cargada (PRICO/GRACO de Impuestos + PRIO/OEA de la Aduana, con nombre del
    // SEPREC; trae la categoría al filtro de tamaño); si no da NIT seguro, la
    // búsqueda EN VIVO en el SEPREC (SOURCES-BO-NIT-BY-NAME-LIVE-1), acotada en tiempo
    // y en consultas. En los dos, una marca de una palabra o una marca dentro de la
    // razón social sólo es segura si la web propia de la candidata la confirma.
    createFallbackOfficialSourceResolver(
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'BO',
        sourceKey: BO_LARGE_TAXPAYERS_SOURCE_KEY,
        taxIdentifierType: 'NIT',
        validTaxId: /^\d{7,13}$/,
        normalizeCore: normalizeBoliviaCompanyCore,
        querySnapshots: buildSnapshotNameQuery(snapshotClient, BO_LARGE_TAXPAYERS_SOURCE_KEY, 'BO', { withWorkforce: true }),
        singleWordIsSignalOnly: true,
        singleWordConfirmedByDomain: boliviaDomainConfirmsName,
        nameCarriesLegalForm: boliviaNameCarriesLegalForm,
      }),
      createSnapshotNameOfficialSourceResolver({
        countryCode: 'BO',
        sourceKey: BO_SEPREC_LIVE_SOURCE_KEY,
        taxIdentifierType: 'NIT',
        validTaxId: /^\d{7,13}$/,
        normalizeCore: normalizeBoliviaCompanyCore,
        querySnapshots: buildSeprecNameLiveQuery(),
        singleWordIsSignalOnly: true,
        singleWordConfirmedByDomain: boliviaDomainConfirmsName,
        nameCarriesLegalForm: boliviaNameCarriesLegalForm,
        brandConfirmedByDomain: boliviaDomainConfirmsName,
      }),
    ),
  ];
}
