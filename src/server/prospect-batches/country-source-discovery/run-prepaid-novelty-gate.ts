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
  PREPAID_EXCLUSION_DOMAIN_CAP,
  type ProviderExclusionDomainPlan,
} from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
// ADDENDUM PROVIDER-SEEN §§ 4, 6 — la memoria de lo ya pagado y el planificador
// provider-neutral de exclusiones.
import {
  planProviderExclusions,
  type ProviderExclusionPlan,
} from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import {
  buildProviderSeenMemory,
  EMPTY_PROVIDER_SEEN_MEMORY,
  type ProviderSeenMemory,
  type ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  buildProviderSeenTelemetry,
  PROVIDER_SEEN_LOAD_EMPTY,
  PROVIDER_SEEN_LOAD_FAILED,
  PROVIDER_SEEN_LOAD_UNAVAILABLE,
  type ProviderSeenLoadSummary,
} from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import {
  NO_OP_PROVIDER_SEEN_STORE,
  PROVIDER_SEEN_LOAD_LIMIT,
  type ProviderSeenStore,
} from '@/server/prospect-batches/provider-seen/provider-seen-store';
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
  /**
   * ADDENDUM PROVIDER-SEEN § 4 — memoria de lo que este proveedor ya nos mostró
   * en corridas ANTERIORES.
   *
   * Ausente ⇒ `NO_OP_PROVIDER_SEEN_STORE`, que lee vacío. Memoria vacía ⇒ 0
   * aciertos ⇒ 0 exclusiones por provider-seen ⇒ la corrida se comporta
   * exactamente como antes de este PR.
   */
  providerSeenStore?: ProviderSeenStore | null;
};

export type PrePaidNoveltyGateInput = {
  countryCode: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
  /**
   * ADDENDUM PROVIDER-SEEN §§ 5, 6 — para QUÉ proveedor se planifica.
   *
   * 🔴 Obligatorio a propósito, sin valor por defecto: la CAPACIDAD de exclusión
   * es distinta por proveedor (Lusha acepta dominios; Apollo no acepta nada), y
   * un defecto silencioso convertiría una ruta nueva en la exclusión de otra.
   * Que el compilador lo exija es una guarda más fuerte que una prueba estática.
   */
  provider: ProviderSeenProvider;
};

export type PrePaidNoveltyGateResult = {
  context: PrePaidNoveltyContext;
  /**
   * Vista heredada del plan de dominios, la que los consumidores de hoy leen.
   *
   * 🔴 Ya NO se calcula aparte: se DERIVA de `providerExclusionPlan.domains`. Dos
   * listas calculadas por separado podrían divergir y sólo una viaja al
   * proveedor.
   */
  exclusionPlan: ProviderExclusionDomainPlan;
  /** ADDENDUM PROVIDER-SEEN § 6 — el plan explicable, por dimensión y procedencia. */
  providerExclusionPlan: ProviderExclusionPlan;
  /** ADDENDUM PROVIDER-SEEN § 10 — qué rindió la carga de memoria previa. */
  providerSeen: ProviderSeenLoadSummary;
  /**
   * ADDENDUM PROVIDER-SEEN § 4 — la memoria en forma consultable, para que el
   * ejecutor de pago pueda contar aciertos sobre la respuesta.
   *
   * 🔴 Contar aciertos es TODO lo que hace. No descarta, no filtra y no reduce
   * el objetivo: el dedupe local sigue siendo la autoridad (§ 6).
   */
  providerSeenMemory: ProviderSeenMemory;
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

/**
 * Carga la memoria provider-seen de corridas anteriores.
 *
 * Nunca lanza: una memoria ilegible degrada a «no se pudo cargar», que la
 * telemetría publica como tal. Fail-open, como todo lo gratuito (§ 12 del hito
 * base): sin memoria la corrida gasta lo de hoy, jamás más.
 */
async function loadProviderSeen(
  provider: ProviderSeenProvider,
  store: ProviderSeenStore,
): Promise<{
  summary: ProviderSeenLoadSummary;
  ids: readonly string[];
  domains: readonly string[];
  records: readonly { providerEntityId: string | null; normalizedDomain: string | null }[];
}> {
  // 🔴 CUT-2 § 12 — un puerto que se declara no-persistente NO se consulta para
  // decidir nada: su `load()` devolvería `[]` y ese vacío no es una medición. Se
  // preserva tal cual el desenlace de siempre (`not_attempted`).
  if (store.nonPersistingReason !== undefined) {
    return { summary: PROVIDER_SEEN_LOAD_UNAVAILABLE, ids: [], domains: [], records: [] };
  }

  try {
    const records = await store.load({
      provider,
      entityType: 'company',
      limit: PROVIDER_SEEN_LOAD_LIMIT,
    });
    if (records.length === 0) {
      // 🔴 CUT-2 § 12 — la tabla estaba VACÍA y la lectura funcionó. `loaded` sigue
      // siendo `false` —no entró memoria, así que el plan de exclusión se comporta
      // exactamente igual que antes— pero `readOutcome: 'succeeded'` deja constancia
      // de que el hecho se midió. Un embudo publica 0 con esto y null sin ello.
      return { summary: PROVIDER_SEEN_LOAD_EMPTY, ids: [], domains: [], records: [] };
    }
    const ids: string[] = [];
    const domains: string[] = [];
    for (const record of records) {
      if (record.providerEntityId !== null) ids.push(record.providerEntityId);
      if (record.normalizedDomain !== null) domains.push(record.normalizedDomain);
    }
    return {
      summary: {
        loaded: true,
        unavailableReason: null,
        idsAvailable: ids.length,
        domainsAvailable: domains.length,
        readOutcome: 'succeeded',
      },
      ids,
      domains,
      records: records.map((record) => ({
        providerEntityId: record.providerEntityId,
        normalizedDomain: record.normalizedDomain,
      })),
    };
  } catch {
    // 🔴 CUT-2 § 12 — se preguntó y no hubo respuesta. NO es «cero»: es «no se
    // sabe». Fail-open igual que antes —la corrida sigue y gasta lo de siempre—
    // pero el desenlace queda nombrado en vez de disfrazado de memoria vacía.
    return { summary: PROVIDER_SEEN_LOAD_FAILED, ids: [], domains: [], records: [] };
  }
}

async function listSellupKnownDomains(
  input: PrePaidNoveltyGateInput,
  deps: PrePaidNoveltyGateDeps,
): Promise<readonly (string | null)[]> {
  if (!deps.listKnownExclusionDomains) return [];
  try {
    return await deps.listKnownExclusionDomains({
      countryCode: input.countryCode,
      // Se lee un poco por encima del tope para que el recorte determinista
      // tenga de dónde elegir y `omittedDueToCap` diga la verdad.
      limit: PREPAID_EXCLUSION_DOMAIN_CAP * 2,
    });
  } catch {
    // Sin dominios conocidos la exclusión queda más corta. Es una pista, no una
    // autoridad: el dedupe local posterior sigue intacto.
    return [];
  }
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

  const store = deps.providerSeenStore ?? NO_OP_PROVIDER_SEEN_STORE;

  const finish = async (
    context: PrePaidNoveltyContext,
    accepted: readonly CountrySourceCompany[],
  ): Promise<PrePaidNoveltyGateResult> => {
    // Sin proveedor no hay a quién pasarle exclusiones ni a quién recordarle nada:
    // ni se carga memoria ni se planifica. Sería trabajo para nadie.
    if (!context.providerRequired) {
      const idlePlan = planProviderExclusions(input.provider, {});
      return {
        context: { ...context, exclusionDomains: EMPTY_EXCLUSION_PLAN.sent },
        exclusionPlan: EMPTY_EXCLUSION_PLAN,
        providerExclusionPlan: idlePlan,
        providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
        providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
        acceptedCompanies: accepted,
        telemetry: {
          ...buildPrePaidNoveltyTelemetry(
            { ...context, exclusionDomains: EMPTY_EXCLUSION_PLAN.sent },
            EMPTY_EXCLUSION_PLAN,
            null,
          ),
          provider_seen: buildProviderSeenTelemetry({
            freeSource: context.freeSource,
            providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
            exclusionPlan: idlePlan,
            // § 9 — hecho observado: con hueco cerrado no se emitió NI UNA
            // petición. No es un ahorro estimado; es una petición que no existió.
            avoided: { requestsAvoided: 1, pagesAvoided: 0 },
          }),
        },
      };
    }

    const [providerSeen, sellupKnownDomains] = await Promise.all([
      loadProviderSeen(input.provider, store),
      listSellupKnownDomains(input, deps),
    ]);

    // 🔴 § 6 — las dos dimensiones se planifican por separado y la lista que
    // viaja sale de aquí, una sola vez.
    const providerExclusionPlan = planProviderExclusions(input.provider, {
      providerSeenIds: providerSeen.ids,
      providerSeenDomains: providerSeen.domains,
      sellupKnownDomains,
      // Los aceptados de la fuente gratuita también se excluyen: ya están
      // cubiertos y volver a pagarlos sería el mismo derroche en otra capa.
      freeSourceAcceptedDomains: accepted.map((company) => company.domain),
    });

    const exclusionPlan: ProviderExclusionDomainPlan = {
      available: providerExclusionPlan.domains.available,
      sent: providerExclusionPlan.domains.sent,
      omittedDueToCap: providerExclusionPlan.domains.omittedDueToCap,
    };

    const withDomains: PrePaidNoveltyContext = {
      ...context,
      exclusionDomains: exclusionPlan.sent,
      // 🔴 Informativo. NO reduce el hueco — ver el campo en el contexto.
      providerSeenKnown: providerSeen.ids.length + providerSeen.domains.length,
      providerExclusionCandidates: {
        ids: providerExclusionPlan.ids.sent,
        domains: providerExclusionPlan.domains.sent,
      },
    };

    return {
      context: withDomains,
      exclusionPlan,
      providerExclusionPlan,
      providerSeen: providerSeen.summary,
      providerSeenMemory: buildProviderSeenMemory(providerSeen.records),
      acceptedCompanies: accepted,
      telemetry: {
        ...buildPrePaidNoveltyTelemetry(withDomains, exclusionPlan, null),
        provider_seen: buildProviderSeenTelemetry({
          freeSource: context.freeSource,
          providerSeen: providerSeen.summary,
          exclusionPlan: providerExclusionPlan,
        }),
      },
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
