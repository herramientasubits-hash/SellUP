/**
 * country-source-capability.ts — ¿tiene este país una fuente gratuita cableada?
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 7, 12, 22(G), 26.
 *
 * ── 🔴 «Cableada» significa consciente de criterios, no «existe» ─────────────
 *
 * El catálogo de fuentes del repo registra adapters para Chile (`cl_res`), México
 * (`mx_denue`) y Colombia (`co_rues`). Ninguno de los tres aparece aquí, y el
 * motivo es § 4: hoy ninguno recibe los criterios de la corrida. `co_rues`
 * concretamente sólo propaga `limit` y `offset` a `runSocrataCandidateDryRun`, que
 * consulta CUATRO datasets (rues, secop2, reps, superfinanciera) con un `$where`
 * fijo que sólo excluye personas naturales e inactivos. Una macro industria no
 * viaja en esa petición. Devolver su muestra reduciría el objetivo con lo primero
 * que Socrata tuviera a mano, que es exactamente lo prohibido.
 *
 * ── 🔴 Este registro NO decide el proveedor siguiente (§ 26) ─────────────────
 *
 * Resuelve capacidad de FUENTE y nada más. No sabe qué proveedor de pago viene
 * después ni le importa: la misma capa la consumen la ruta Apollo y la ruta
 * Lusha, y una futura cadena fuente → primario → secundario → Tavily la puede
 * consumir igual sin que aquí se cablee «después va Lusha».
 */

import type { CountrySourceAdapter } from './country-source-types';
import {
  buildCoSiisDiscoveryAdapter,
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  type CoSiisSnapshotQuery,
} from './co-siis-discovery-adapter';
import {
  buildDoDgiiDiscoveryAdapter,
  DO_DGII_DISCOVERY_SOURCE_KEY,
  type DoDgiiDiscoveryReads,
} from './do-dgii-discovery-adapter';
import {
  AR_RNS_DISCOVERY_SOURCE_KEY,
  buildArRnsDiscoveryAdapter,
  type ArRnsDiscoveryReads,
} from './ar-rns-discovery-adapter';
import {
  buildMxDenueDiscoveryAdapter,
  MX_DENUE_DISCOVERY_SOURCE_KEY,
  type MxDenueDiscoveryReads,
} from './mx-denue-discovery-adapter';
import {
  buildEcScvsDirectoryDiscoveryAdapter,
  EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type EcScvsDirectoryDiscoveryReads,
} from './ec-scvs-directory-discovery-adapter';
import {
  buildClSiiDirectoryDiscoveryAdapter,
  CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type ClSiiDirectoryDiscoveryReads,
} from './cl-sii-directory-discovery-adapter';
import {
  buildPeSunatDirectoryDiscoveryAdapter,
  PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type PeSunatDirectoryDiscoveryReads,
} from './pe-sunat-directory-discovery-adapter';
import {
  buildPyDncpDirectoryDiscoveryAdapter,
  PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type PyDncpDirectoryDiscoveryReads,
} from './py-dncp-directory-discovery-adapter';
import { macroHasMxCoverage } from './mx-denue-macro-table';
import { macroHasPyDncpCoverage } from './py-dncp-macro-table';
import {
  buildGtGuatecomprasDirectoryDiscoveryAdapter,
  GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY,
  type GtGuatecomprasDirectoryDiscoveryReads,
} from './gt-guatecompras-directory-discovery-adapter';
import { macroHasGtGuatecomprasCoverage } from './gt-guatecompras-macro-table';
import { macroHasPeCoverage } from './pe-sunat-macro-table';
import { macroHasEcCoverage } from './ec-scvs-macro-table';
import { macroHasClCoverage } from './cl-sii-macro-table';
import { macroHasCoSiisCoverage } from './co-siis-macro-table';
import { CO_PUBLIC_ENTITY_DISCOVERY_MACROS } from './co-siis-discovery-adapter';
import { macroHasDgiiCoverage } from './do-dgii-macro-table';
import { macroHasArCoverage } from './ar-rns-macro-table';

/**
 * Países con descubrimiento gratuito consciente de criterios.
 *
 * SOURCES-DO-FREE-DISCOVERY-1 — República Dominicana entra con el padrón DGII,
 * clasificado por la tabla oficial aprobada (`do-dgii-macro-table.ts`) y
 * restringido a proveedoras del Estado (`do-dgii-discovery-adapter.ts`).
 *
 * SOURCES-AR-RNS-1 — Argentina entra con el Registro Nacional de Sociedades
 * cruzado con las adjudicaciones de COMPR.AR, clasificado por la tabla aprobada
 * (`ar-rns-macro-table.ts`) (`ar-rns-discovery-adapter.ts`).
 *
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1 — México entra con el DENUE del INEGI en
 * vivo (gratuito), clasificado por la tabla SCIAN aprobada
 * (`mx-denue-macro-table.ts`), sólo establecimientos de 51+ personas.
 *
 * SOURCES-EC-FREE-DISCOVERY-1 — Ecuador entra con el directorio de compañías de
 * la Superintendencia de Compañías cruzado con su ranking, clasificado por la
 * tabla CIIU (`ec-scvs-macro-table.ts`), sólo compañías activas de 200+ empleados.
 *
 * SOURCES-CL-SII-FREE-DISCOVERY-1 — Chile entra con las personas jurídicas del
 * SII (código de actividad + trabajadores), clasificadas por la tabla aprobada
 * (`cl-sii-macro-table.ts`), sólo empresas de 100+ trabajadores.
 *
 * SOURCES-PE-FREE-DISCOVERY-1 — Perú entra con el Padrón RUC abierto de SUNAT
 * (actividad CIIU Rev. 4 + trabajadores) cruzado con el padrón reducido,
 * clasificado por la tabla CIIU (`pe-sunat-macro-table.ts`), sólo sociedades y
 * entidades activas y habidas de 200+ trabajadores.
 *
 * SOURCES-PY-CLOSE-1 — Paraguay entra con las sociedades que el Estado contrató
 * (adjudicaciones de la DNCP en datos abiertos), clasificadas por lo que venden
 * (UNSPSC, `py-dncp-macro-table.ts`), sin consorcios y sin las que declararon ser
 * micro, pequeña o mediana.
 *
 * SOURCES-GT-CLOSE-1 — Guatemala entra con las sociedades a las que el Estado
 * adjudicó en Guatecompras (datos abiertos OCDS), clasificadas por lo que venden
 * (UNSPSC, `gt-guatecompras-macro-table.ts`), sólo agentes de retención del IVA o
 * con al menos Q5 millones adjudicados.
 */
export const COUNTRY_SOURCE_DISCOVERY_COUNTRIES = ['CO', 'DO', 'AR', 'MX', 'EC', 'CL', 'PE', 'PY', 'GT'] as const;

export type CountrySourceCapability = {
  countryCode: string;
  sourceKey: string;
};

const CAPABILITIES: Readonly<Record<string, CountrySourceCapability>> = Object.freeze({
  CO: { countryCode: 'CO', sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY },
  DO: { countryCode: 'DO', sourceKey: DO_DGII_DISCOVERY_SOURCE_KEY },
  AR: { countryCode: 'AR', sourceKey: AR_RNS_DISCOVERY_SOURCE_KEY },
  MX: { countryCode: 'MX', sourceKey: MX_DENUE_DISCOVERY_SOURCE_KEY },
  EC: { countryCode: 'EC', sourceKey: EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY },
  CL: { countryCode: 'CL', sourceKey: CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY },
  PE: { countryCode: 'PE', sourceKey: PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY },
  PY: { countryCode: 'PY', sourceKey: PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY },
  GT: { countryCode: 'GT', sourceKey: GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY },
});

/** ¿Está cableado el descubrimiento gratuito para este país? */
export function resolveCountrySourceCapability(
  countryCode: string | null | undefined,
): CountrySourceCapability | null {
  if (typeof countryCode !== 'string') return null;
  return CAPABILITIES[countryCode.trim().toUpperCase()] ?? null;
}

/**
 * ¿La fuente de ESTE país puede preguntar algo útil para esta macro?
 *
 * Colombia: la macro tiene códigos CIIU derivados del evaluador canónico.
 * República Dominicana: la macro tiene actividades DGII en la tabla aprobada.
 * Argentina: la macro tiene actividades ARCA en la tabla aprobada.
 * México: la macro tiene filtros SCIAN en la tabla aprobada.
 * Ecuador: la macro tiene actividades CIIU del INEC en la tabla.
 * Chile: la macro tiene actividades del SII en la tabla aprobada.
 * Perú: la macro tiene clases CIIU Rev. 4 en la tabla.
 * Paraguay: la macro tiene clases UNSPSC en la tabla.
 * Guatemala: la macro tiene clases UNSPSC en la tabla (la misma de Paraguay).
 * Sin cobertura la fuente no consulta nada (nunca una muestra genérica).
 */
export function countrySourceMacroHasCoverage(
  countryCode: string | null | undefined,
  macroIndustryKey: string | null | undefined,
): boolean {
  const capability = resolveCountrySourceCapability(countryCode);
  if (capability === null) return false;
  if (capability.countryCode === 'DO') return macroHasDgiiCoverage(macroIndustryKey);
  if (capability.countryCode === 'AR') return macroHasArCoverage(macroIndustryKey);
  if (capability.countryCode === 'MX') return macroHasMxCoverage(macroIndustryKey);
  if (capability.countryCode === 'EC') return macroHasEcCoverage(macroIndustryKey);
  if (capability.countryCode === 'CL') return macroHasClCoverage(macroIndustryKey);
  if (capability.countryCode === 'PE') return macroHasPeCoverage(macroIndustryKey);
  if (capability.countryCode === 'PY') return macroHasPyDncpCoverage(macroIndustryKey);
  if (capability.countryCode === 'GT') return macroHasGtGuatecomprasCoverage(macroIndustryKey);
  // SOURCES-CO-CLOSE-1 — Colombia: tabla aprobada del SIIS + Gobierno desde el
  // directorio de entidades públicas.
  return (
    macroHasCoSiisCoverage(macroIndustryKey) ||
    (typeof macroIndustryKey === 'string' && CO_PUBLIC_ENTITY_DISCOVERY_MACROS.has(macroIndustryKey))
  );
}

/**
 * Construye el adapter del país. `null` cuando el país no tiene fuente o cuando
 * la lectura que necesita no fue inyectada — ausencia de credencial/cliente NO es
 * un fallo silencioso, es «sin fuente», que es fail-open hacia el pago.
 */
export function buildCountrySourceAdapter(
  countryCode: string | null | undefined,
  deps: {
    coSiisSnapshotQuery?: CoSiisSnapshotQuery | null;
    doDgiiDiscoveryReads?: DoDgiiDiscoveryReads | null;
    arRnsDiscoveryReads?: ArRnsDiscoveryReads | null;
    mxDenueDiscoveryReads?: MxDenueDiscoveryReads | null;
    ecScvsDirectoryDiscoveryReads?: EcScvsDirectoryDiscoveryReads | null;
    clSiiDirectoryDiscoveryReads?: ClSiiDirectoryDiscoveryReads | null;
    peSunatDirectoryDiscoveryReads?: PeSunatDirectoryDiscoveryReads | null;
    pyDncpDirectoryDiscoveryReads?: PyDncpDirectoryDiscoveryReads | null;
    gtGuatecomprasDirectoryDiscoveryReads?: GtGuatecomprasDirectoryDiscoveryReads | null;
  },
): CountrySourceAdapter | null {
  const capability = resolveCountrySourceCapability(countryCode);
  if (capability === null) return null;
  if (capability.countryCode === 'DO') {
    return deps.doDgiiDiscoveryReads ? buildDoDgiiDiscoveryAdapter(deps.doDgiiDiscoveryReads) : null;
  }
  if (capability.countryCode === 'AR') {
    return deps.arRnsDiscoveryReads ? buildArRnsDiscoveryAdapter(deps.arRnsDiscoveryReads) : null;
  }
  if (capability.countryCode === 'MX') {
    return deps.mxDenueDiscoveryReads ? buildMxDenueDiscoveryAdapter(deps.mxDenueDiscoveryReads) : null;
  }
  if (capability.countryCode === 'EC') {
    return deps.ecScvsDirectoryDiscoveryReads
      ? buildEcScvsDirectoryDiscoveryAdapter(deps.ecScvsDirectoryDiscoveryReads)
      : null;
  }
  if (capability.countryCode === 'CL') {
    return deps.clSiiDirectoryDiscoveryReads
      ? buildClSiiDirectoryDiscoveryAdapter(deps.clSiiDirectoryDiscoveryReads)
      : null;
  }
  if (capability.countryCode === 'PE') {
    return deps.peSunatDirectoryDiscoveryReads
      ? buildPeSunatDirectoryDiscoveryAdapter(deps.peSunatDirectoryDiscoveryReads)
      : null;
  }
  if (capability.countryCode === 'PY') {
    return deps.pyDncpDirectoryDiscoveryReads
      ? buildPyDncpDirectoryDiscoveryAdapter(deps.pyDncpDirectoryDiscoveryReads)
      : null;
  }
  if (capability.countryCode === 'GT') {
    return deps.gtGuatecomprasDirectoryDiscoveryReads
      ? buildGtGuatecomprasDirectoryDiscoveryAdapter(deps.gtGuatecomprasDirectoryDiscoveryReads)
      : null;
  }
  if (!deps.coSiisSnapshotQuery) return null;
  return buildCoSiisDiscoveryAdapter(deps.coSiisSnapshotQuery);
}
