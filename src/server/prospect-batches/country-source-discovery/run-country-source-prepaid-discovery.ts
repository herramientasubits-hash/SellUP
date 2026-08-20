/**
 * run-country-source-prepaid-discovery.ts — el trabajo GRATUITO que ocurre antes
 * de que exista una reserva.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 5, 9, 10, 12, 14, 20.
 *
 * ── El orden, que es el hito entero ──────────────────────────────────────────
 *
 *   fuente de país  →  precisión Macro-v2 canónica  →  dedupe fuerte de SellUp
 *   →  comprobación de HubSpot de sólo lectura  →  novedad aceptada
 *
 * Cada paso puede sólo REDUCIR. Ninguno puede admitir lo que el anterior negó, y
 * ninguno puede gastar: aquí no hay cliente de proveedor, ni RPC de presupuesto,
 * ni escritura. Por construcción, no por disciplina.
 *
 * ── 🔴 Sin dominio, la identidad es la FISCAL (§ 22(I)) ──────────────────────
 *
 * Las fuentes oficiales colombianas no publican web. No se fabrica ninguna: la
 * comprobación de duplicados viaja con NIT + nombre normalizado + país, que es
 * identidad FUERTE (el NIT es único por empresa) y es exactamente la que § 9
 * autoriza. Un nombre difuso NUNCA se usa como exclusión previa al pago.
 *
 * ── 🔴 El descarte histórico no es una lista negra perpetua (§ 9) ────────────
 *
 * Auditado, y ya era correcto en Producción antes de este hito: el detector
 * canónico excluye `status = 'discarded'` de sus coincidencias, y el guard de
 * identidad activa excluye `qa_cleanup / discarded / rejected / duplicate /
 * archived` con el comentario «permiten reconsideración». Es decir, una empresa
 * descartada por estar fuera de la macro de OTRA corrida no queda vetada para
 * siempre. Este módulo no cambia esa semántica: la REUSA, que es la única forma
 * de que no pueda divergir.
 *
 * ── HubSpot: por candidato, nunca el CRM entero (§ 10) ───────────────────────
 *
 * Se usa el MISMO `checkCompanyDuplicate` que la ruta Lusha ya inyecta, que
 * consulta HubSpot por empresa y de sólo lectura. No se enumera el CRM y no se
 * escribe nada — no existe una dep que pueda hacerlo.
 */

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  assessCountrySourceMacroPrecision,
  isCountrySourceMacroPrecisionAdmitted,
} from './country-source-macro-precision';
import type { CountrySourceAdapter, CountrySourceCompany } from './country-source-types';
import {
  failedFreeSourceOutcome,
  notAttemptedFreeSourceOutcome,
  type PrePaidFreeSourceOutcome,
} from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';

/** READ-ONLY. El detector canónico SellUp + HubSpot. Nunca escribe. */
export type CheckCountrySourceCompanyDuplicate = (
  input: DuplicateCheckInput,
) => Promise<DuplicateCheckResult>;

export type CountrySourcePrePaidDiscoveryInput = {
  countryCode: string;
  macroIndustryKey: string;
  /** Objetivo del usuario. Nunca se acepta por encima de él (§ 14). */
  requestedTarget: number;
  /**
   * Cuántas filas leer de la fuente. Más que el objetivo a propósito: entre lo
   * leído y lo aceptable hay tres filtros, y leer justo el objetivo garantizaría
   * no cerrarlo nunca. La lectura es gratis; el techo lo pone el adapter.
   */
  readLimit?: number;
};

export type CountrySourcePrePaidDiscoveryDeps = {
  adapter: CountrySourceAdapter;
  checkCompanyDuplicate: CheckCountrySourceCompanyDuplicate;
};

export type CountrySourcePrePaidDiscoveryResult = {
  outcome: PrePaidFreeSourceOutcome;
  /** Empresas aceptadas: confirmadas, nuevas en SellUp y nuevas en HubSpot. */
  acceptedCompanies: readonly CountrySourceCompany[];
};

/** Cuántas filas se leen por defecto por cada empresa que se quiere aceptar. */
export const COUNTRY_SOURCE_READ_MULTIPLIER = 10;

function buildDuplicateCheckInput(
  company: CountrySourceCompany,
): DuplicateCheckInput {
  return {
    name: company.legalName ?? '',
    legalName: company.legalName,
    normalizedName: company.normalizedLegalName,
    // 🔴 Sin web declarada no se inventa ninguna (§ 22(I)).
    website: null,
    domain: company.domain,
    country: null,
    countryCode: company.countryCode,
    taxIdentifier: company.taxId,
  };
}

/**
 * ¿Qué dijo el detector canónico sobre esta empresa?
 *
 * Se clasifica en tres cubetas y no en dos porque § 20 pide separar «SellUp ya la
 * tiene» de «HubSpot ya la tiene»: son dos motivos distintos de no gastar y un
 * operador necesita poder distinguirlos.
 *
 * 🔴 `possible_duplicate` NO cuenta como conocida. Una coincidencia probable es
 * justo lo que un humano tiene que revisar; tratarla como conocida escondería
 * empresas nuevas, y tratarla como nueva es seguro porque el candidato llega a
 * revisión con su estado de duplicado a la vista.
 */
function classifyKnownness(result: DuplicateCheckResult): 'sellup_known' | 'hubspot_known' | 'novel' {
  const sellupExact = result.matches.some(
    (m) => m.source === 'sellup' && m.status === 'existing_in_sellup',
  );
  if (sellupExact) return 'sellup_known';

  const hubspotExact = result.matches.some(
    (m) => m.source === 'hubspot' && m.status === 'existing_in_hubspot',
  );
  if (hubspotExact) return 'hubspot_known';

  return 'novel';
}

/**
 * Ejecuta el descubrimiento gratuito de un país y devuelve cuántas empresas
 * NUEVAS y CONFIRMADAS quedaron, más esas empresas.
 *
 * Fail-open (§ 12): cualquier excepción del adapter o del detector se traduce a
 * un desenlace fallido con `acceptedNovel = 0`. La corrida sigue y el proveedor de
 * pago recibe el objetivo entero. Una fuente rota nunca deja el wizard inservible
 * ni inventa cobertura.
 */
export async function runCountrySourcePrePaidDiscovery(
  input: CountrySourcePrePaidDiscoveryInput,
  deps: CountrySourcePrePaidDiscoveryDeps,
): Promise<CountrySourcePrePaidDiscoveryResult> {
  const requestedTarget = Math.max(0, Math.trunc(input.requestedTarget));
  if (requestedTarget === 0) {
    return { outcome: notAttemptedFreeSourceOutcome(), acceptedCompanies: [] };
  }

  const readLimit = Math.max(
    requestedTarget,
    Math.trunc(input.readLimit ?? requestedTarget * COUNTRY_SOURCE_READ_MULTIPLIER),
  );

  let sourceKey: string | null = null;
  let rawReturned = 0;
  let companies: readonly CountrySourceCompany[] = [];

  try {
    const discovery = await deps.adapter({
      countryCode: input.countryCode,
      macroIndustryKey: input.macroIndustryKey,
      limit: readLimit,
    });
    sourceKey = discovery.sourceKey;
    rawReturned = discovery.companies.length;
    companies = discovery.companies;
  } catch {
    // El mensaje crudo no se propaga: puede traer detalles de conexión.
    return {
      outcome: failedFreeSourceOutcome(sourceKey, 'source_unavailable'),
      acceptedCompanies: [],
    };
  }

  let macroConfirmed = 0;
  let ambiguous = 0;
  let rejected = 0;
  let sellupKnown = 0;
  let hubspotKnown = 0;
  const acceptedCompanies: CountrySourceCompany[] = [];
  // Dedupe DENTRO de la propia lectura: una fuente puede publicar dos registros
  // de la misma empresa (matrícula renovada, sucursal). Contarla dos veces
  // cerraría el hueco con una sola empresa.
  const seenIdentities = new Set<string>();

  for (const company of companies) {
    const precision = assessCountrySourceMacroPrecision({
      macroIndustryKey: input.macroIndustryKey,
      company,
    });

    if (!isCountrySourceMacroPrecisionAdmitted(precision)) {
      if (precision.verdict === 'rejected') rejected++;
      else ambiguous++;
      continue;
    }
    macroConfirmed++;

    const identity = (company.taxId ?? company.normalizedLegalName ?? company.recordIdentityKey)
      .toLowerCase();
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);

    // 🔴 El objetivo se comprueba ANTES de preguntar por duplicados: una empresa
    // que ya no cabe no necesita comprobarse, y HubSpot es una llamada de red.
    if (acceptedCompanies.length >= requestedTarget) continue;

    let duplicate: DuplicateCheckResult;
    try {
      duplicate = await deps.checkCompanyDuplicate(buildDuplicateCheckInput(company));
    } catch {
      // El detector falló para ESTA empresa. Fail-closed a nivel de empresa: sin
      // saber si es conocida, no puede reducir el hueco. La corrida sigue.
      continue;
    }

    switch (classifyKnownness(duplicate)) {
      case 'sellup_known':
        sellupKnown++;
        break;
      case 'hubspot_known':
        hubspotKnown++;
        break;
      default:
        acceptedCompanies.push(company);
        break;
    }
  }

  return {
    outcome: {
      sourceKey,
      attempted: true,
      rawReturned,
      macroConfirmed,
      ambiguous,
      rejected,
      sellupKnown,
      hubspotKnown,
      acceptedNovel: acceptedCompanies.length,
      failed: false,
      failureCode: null,
    },
    acceptedCompanies,
  };
}
