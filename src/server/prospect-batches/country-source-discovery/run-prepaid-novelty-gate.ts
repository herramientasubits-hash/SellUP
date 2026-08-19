/**
 * run-prepaid-novelty-gate.ts — LA capa previa al pago. Un solo punto de entrada
 * para Apollo y para Lusha.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 8, 11, 12, 15, 25, 30.
 *
 * ── 🔴 Por qué es una sola función y no una por proveedor (§ 25) ─────────────
 *
 * El benchmark final Apollo-vs-Lusha sólo significa algo si los dos embudos
 * empiezan en el mismo sitio. Si Lusha descontara empresas gratuitas y Apollo no,
 * la diferencia medida sería la de las dos capas previas y se le atribuiría a los
 * proveedores. Lo específico de cada uno empieza DESPUÉS de esta función, cuando
 * ya se conocen `residualGap` y las exclusiones soportadas.
 *
 * ── 🔴 Todo aquí es gratis, y no puede dejar de serlo ────────────────────────
 *
 * Las deps que recibe son: un adapter de fuente (lectura), un detector de
 * duplicados (lectura) y un lector de dominios conocidos (lectura). No hay RPC de
 * presupuesto, ni cliente de proveedor, ni escritura. No es disciplina: es que no
 * existe la capacidad.
 *
 * ── Fail-open siempre (§ 12) ─────────────────────────────────────────────────
 *
 * País sin fuente, fuente sin cablear, lectura caída, macro sin cobertura: todos
 * terminan en `residualGap = requestedTarget` y la ruta de pago hace exactamente
 * lo de hoy. Ninguno hace el wizard inservible.
 */

import {
  buildPrePaidNoveltyContext,
  providerOnlyPrePaidNoveltyContext,
  type PrePaidNoveltyContext,
} from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import {
  planProviderExclusionDomains,
  PREPAID_EXCLUSION_DOMAIN_CAP,
  type ProviderExclusionDomainPlan,
} from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import {
  buildPrePaidNoveltyTelemetry,
} from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-telemetry';
import { macroHasCiiuCoverage } from './macro-ciiu-index';
import { resolveCountrySourceCapability } from './country-source-capability';
import {
  runCountrySourcePrePaidDiscovery,
  type CheckCountrySourceCompanyDuplicate,
} from './run-country-source-prepaid-discovery';
import type { CountrySourceAdapter, CountrySourceCompany } from './country-source-types';

/**
 * Lector ACOTADO de dominios que SellUp ya conoce (cuentas y candidatos
 * activos), para la pista de exclusión.
 *
 * 🔴 § 10 / § 30(E) — deliberadamente NO existe un lector de «todos los dominios
 * de HubSpot». Enumerar el CRM entero para construir esta lista sería una
 * exportación sin cota, que el hito prohíbe. Los dominios de HubSpot entran en la
 * exclusión sólo si ya están disponibles localmente; la comprobación de HubSpot
 * POR CANDIDATO —que sí es canónica y acotada— sigue ocurriendo en el paso de
 * novedad, que es donde de verdad decide.
 */
export type ListKnownExclusionDomains = (input: {
  countryCode: string;
  limit: number;
}) => Promise<readonly (string | null)[]>;

export type PrePaidNoveltyGateDeps = {
  /** `null` ⇒ el país no tiene fuente gratuita cableada. Fail-open. */
  countrySourceAdapter?: CountrySourceAdapter | null;
  checkCompanyDuplicate?: CheckCountrySourceCompanyDuplicate | null;
  listKnownExclusionDomains?: ListKnownExclusionDomains | null;
};

export type PrePaidNoveltyGateInput = {
  countryCode: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
};

export type PrePaidNoveltyGateResult = {
  context: PrePaidNoveltyContext;
  exclusionPlan: ProviderExclusionDomainPlan;
  /** Empresas gratuitas aceptadas, listas para la ingesta canónica (§ 13). */
  acceptedCompanies: readonly CountrySourceCompany[];
  /** Vista serializable para `metadata`. snake_case. */
  telemetry: Record<string, unknown>;
};

const EMPTY_EXCLUSION_PLAN: ProviderExclusionDomainPlan = {
  available: 0,
  sent: [],
  omittedDueToCap: 0,
};

async function resolveExclusionPlan(
  input: PrePaidNoveltyGateInput,
  deps: PrePaidNoveltyGateDeps,
  acceptedCompanies: readonly CountrySourceCompany[],
): Promise<ProviderExclusionDomainPlan> {
  const known: (string | null)[] = [];

  if (deps.listKnownExclusionDomains) {
    try {
      const rows = await deps.listKnownExclusionDomains({
        countryCode: input.countryCode,
        // Se lee un poco por encima del tope para que el recorte determinista
        // tenga de dónde elegir y `omittedDueToCap` diga la verdad.
        limit: PREPAID_EXCLUSION_DOMAIN_CAP * 2,
      });
      known.push(...rows);
    } catch {
      // Sin dominios conocidos la exclusión queda vacía. Es una pista, no una
      // autoridad: el dedupe local posterior sigue intacto.
    }
  }

  // Los aceptados de la fuente gratuita también se excluyen: ya están cubiertos y
  // volver a pagarlos sería el mismo derroche en otra capa. Hoy aportan cero
  // porque las fuentes oficiales colombianas no publican web (§ 22(I)).
  for (const company of acceptedCompanies) known.push(company.domain);

  return planProviderExclusionDomains(known);
}

/**
 * Resuelve el plan previo al pago de una corrida.
 *
 * `providerRequired === false` es la señal operativa del hito: el llamador NO debe
 * estimar créditos, NO debe reservar, NO debe construir el cliente del proveedor y
 * NO debe llamarlo (§ 15).
 */
export async function runPrePaidNoveltyGate(
  input: PrePaidNoveltyGateInput,
  deps: PrePaidNoveltyGateDeps,
): Promise<PrePaidNoveltyGateResult> {
  const base = {
    requestedTarget: input.requestedTarget,
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey,
  };

  const finish = async (
    context: PrePaidNoveltyContext,
    accepted: readonly CountrySourceCompany[],
  ): Promise<PrePaidNoveltyGateResult> => {
    const exclusionPlan = context.providerRequired
      ? await resolveExclusionPlan(input, deps, accepted)
      // Sin proveedor no hay a quién pasarle exclusiones; construirlas sería una
      // lectura para nadie.
      : EMPTY_EXCLUSION_PLAN;
    const withDomains = { ...context, exclusionDomains: exclusionPlan.sent };
    return {
      context: withDomains,
      exclusionPlan,
      acceptedCompanies: accepted,
      telemetry: buildPrePaidNoveltyTelemetry(withDomains, exclusionPlan, null),
    };
  };

  const capability = resolveCountrySourceCapability(input.countryCode);
  if (capability === null) {
    return finish(providerOnlyPrePaidNoveltyContext({ ...base, failureCode: 'country_without_source' }), []);
  }
  if (!deps.countrySourceAdapter || !deps.checkCompanyDuplicate) {
    return finish(providerOnlyPrePaidNoveltyContext({ ...base, failureCode: 'source_not_criteria_aware' }), []);
  }
  if (input.macroIndustryKey === null) {
    return finish(providerOnlyPrePaidNoveltyContext({ ...base, failureCode: 'macro_industry_unresolved' }), []);
  }
  // Una macro sin códigos CIIU que la confirmen no tiene nada que preguntar. Se
  // declara como ausencia de cobertura en vez de ejecutar una consulta que sólo
  // podría devolver una muestra genérica (§ 4).
  if (!macroHasCiiuCoverage(input.macroIndustryKey)) {
    return finish(providerOnlyPrePaidNoveltyContext({ ...base, failureCode: 'source_not_criteria_aware' }), []);
  }

  const discovery = await runCountrySourcePrePaidDiscovery(
    {
      countryCode: input.countryCode,
      macroIndustryKey: input.macroIndustryKey,
      requestedTarget: input.requestedTarget,
    },
    {
      adapter: deps.countrySourceAdapter,
      checkCompanyDuplicate: deps.checkCompanyDuplicate,
    },
  );

  const context = buildPrePaidNoveltyContext({
    ...base,
    freeSource: discovery.outcome,
    knownSellupCount: discovery.outcome.sellupKnown,
    knownHubspotCount: discovery.outcome.hubspotKnown,
  });

  return finish(context, discovery.acceptedCompanies);
}
