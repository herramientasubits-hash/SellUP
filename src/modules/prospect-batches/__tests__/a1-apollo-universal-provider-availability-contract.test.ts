/**
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — contrato de disponibilidad universal.
 *
 * Complementa la matriz de `wizard-discovery-availability.test.ts` con las cuatro
 * propiedades que no se pueden probar llamando sólo al resolutor puro:
 *
 *   § 9  · paridad UI/servidor — el servidor no puede rechazar por «Lusha-elegible»
 *          una combinación que la UI ofrece como válida.
 *   § 6  · `default` y `recomendado` no son `disponible`.
 *   § 5  · disponibilidad ≠ seguridad de ejecución — los candados siguen ahí y los
 *          topes de la corrida no se movieron.
 *   § 12 · regresión del caso reportado, con cobertura de consulta y spend gate.
 *
 * Determinista: sin flags, sin proveedores, sin créditos, sin DB. Ningún test de
 * este archivo puede llamar a Apollo, Tavily ni Lusha.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLushaRouteHonored,
  resolveProspectDiscoveryProvider,
} from '@/modules/prospect-batches/prospect-discovery-provider';
import { resolveWizardDiscoveryAvailability } from '@/modules/prospect-batches/chat-wizard-execution/wizard-discovery-availability';
import { VALID_COUNTRY_CODES } from '@/modules/prospect-batches/chat-wizard';
import { evaluateWizardApolloAvailability } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-availability';
import { resolveWizardProviderOverrideCapability } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import {
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
  resolveApolloTwoRoundConfig,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/config';
import { estimateApolloTwoRoundBudget } from '@/server/agents/prospecting-toolkit/apollo-two-round/budget';
import {
  evaluateApolloSubindustrySearchCoverageSpendGate,
  resolveApolloSubindustrySearchCoverage,
} from '@/server/agents/prospecting-toolkit/apollo-subindustry-search-coverage';

const ROOT = process.cwd();

const FILES = {
  availability: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-discovery-availability.ts',
  ),
  summary: join(
    ROOT,
    'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx',
  ),
  executionAction: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  ),
  diagnostics: join(ROOT, 'src/app/api/debug/agent1-apollo-config/route.ts'),
  providerResolver: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver.ts',
  ),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf-8')]),
) as Record<keyof typeof FILES, string>;

/** Import specifiers only (module paths). */
function importPaths(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Quita comentarios de bloque y de línea.
 *
 * Estas afirmaciones son sobre el CÓDIGO, no sobre la prosa: el módulo de
 * disponibilidad documenta en detalle por qué no puede consultar la ruta de Lusha, y
 * un `doesNotMatch(/lusha/i)` sobre el archivo entero convertiría esa explicación en
 * un fallo. Un test que castiga la documentación se acaba «arreglando» borrándola.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const code = Object.fromEntries(
  Object.entries(src).map(([key, value]) => [key, stripComments(value)]),
) as Record<keyof typeof FILES, string>;

// ─── § 1 · el contrato de disponibilidad no puede leer la ruta de Lusha ────────

describe('el módulo de disponibilidad es estructuralmente incapaz de consultar Lusha', () => {
  it('no importa nada de Lusha ni del bridge de criterios', () => {
    for (const path of importPaths(code.availability)) {
      assert.doesNotMatch(path, /lusha/i, `import prohibido: ${path}`);
      assert.doesNotMatch(path, /discovery-provider/i, `import prohibido: ${path}`);
    }
  });

  it('su código no menciona Lusha ni sus estados de ruta', () => {
    assert.doesNotMatch(code.availability, /lusha/i);
    assert.doesNotMatch(code.availability, /blocked_lusha_disabled/);
    assert.doesNotMatch(code.availability, /default_ai/);
  });

  it('no lee entorno, no hace I/O y su código no nombra proveedores', () => {
    assert.doesNotMatch(code.availability, /process\.env/);
    assert.doesNotMatch(code.availability, /fetch\(/);
    assert.doesNotMatch(code.availability, /createClient/);
    // `APOLLO_SKIP_REASON_KINDS` es la tabla de familias del preflight, no una
    // decisión: se permite el nombre del identificador, no una rama que lo consulte.
    assert.doesNotMatch(code.availability, /tavily/i);
    assert.doesNotMatch(code.availability, /isApollo|searchApollo|apolloClient/);
  });

  it('no lleva su propia lista de países: la recibe inyectada', () => {
    // Un allowlist propio se desincroniza del catálogo del wizard, y ésa es la
    // clase de lista que produce «este país no, por razones históricas».
    assert.doesNotMatch(code.availability, /'CO'|"CO"/);
    assert.doesNotMatch(code.availability, /LATAM_COUNTRIES/);
    assert.match(code.availability, /supportedCountryCodes/);
  });

  it('la UI deriva el gate de este contrato, no de la ruta de Lusha', () => {
    assert.match(src.summary, /resolveWizardDiscoveryAvailability\(/);
    assert.doesNotMatch(code.summary, /isLushaBlocked/);
    assert.match(src.summary, /isLushaRouteHonored\(lushaCriteria\.provider\)/);
  });
});

// ─── § 9 · paridad UI / servidor ───────────────────────────────────────────────

describe('§ 9 — el servidor no rechaza por Lusha-elegible lo que la UI ofrece', () => {
  it('la acción de ejecución no consulta la elegibilidad de Lusha en ninguna forma', () => {
    for (const path of importPaths(code.executionAction)) {
      assert.doesNotMatch(path, /wizard-lusha-criteria/, `import prohibido: ${path}`);
      assert.doesNotMatch(path, /prospect-discovery-provider/, `import prohibido: ${path}`);
      assert.doesNotMatch(path, /prospect-wizard-route/, `import prohibido: ${path}`);
    }
    assert.doesNotMatch(code.executionAction, /isProspectLushaEligible/);
    assert.doesNotMatch(code.executionAction, /blocked_lusha_disabled/);
    assert.doesNotMatch(code.executionAction, /resolveWizardLushaCriteria/);
  });

  it('la disponibilidad que la UI calcula es la misma para todo país soportado', () => {
    // La UI y el servidor comparten este resolutor puro; no hay dos veredictos que
    // puedan discrepar.
    for (const countryCode of VALID_COUNTRY_CODES) {
      const verdict = resolveWizardDiscoveryAvailability({
        searchMode: 'exploratory',
        countryCode,
        industryId: 'Salud',
        supportedCountryCodes: VALID_COUNTRY_CODES,
      });
      assert.equal(verdict.available, true, `${countryCode} discrepó`);
    }
  });

  it('la ruta de Lusha con el flag apagado no es honrada, en ningún país soportado', () => {
    for (const countryCode of VALID_COUNTRY_CODES) {
      const decision = resolveProspectDiscoveryProvider({
        lushaPreviewEnabled: false,
        searchType: 'exploratory',
        sectorKey: 'healthcare',
        countryCode,
      });
      assert.equal(isLushaRouteHonored(decision.provider), false, `${countryCode} honró Lusha`);
    }
  });
});

// ─── § 6 · default y recomendado no son disponibilidad ─────────────────────────

describe('§ 6 — default ≠ disponible, recomendado ≠ disponible', () => {
  it('el predeterminado global sigue siendo Tavily y no se toca', () => {
    assert.match(src.providerResolver, /return \{ provider: 'tavily', reason: 'default' \}/);
  });

  it('el runtime sigue declarando que Apollo no es el recomendado', () => {
    assert.match(src.diagnostics, /apollo_discovery_default_recommended: false/);
  });

  it('la disponibilidad no conoce el predeterminado ni el recomendado', () => {
    assert.doesNotMatch(code.availability, /AGENT1_WIZARD_DISCOVERY_PROVIDER/);
    assert.doesNotMatch(code.availability, /recommended/i);
    assert.doesNotMatch(code.availability, /default_recommended/);
  });

  it('§ 14 — el diagnóstico publica el flag del proveedor oculto y los modos aplicables', () => {
    assert.match(src.diagnostics, /lusha_preview_enabled_resolved/);
    assert.match(src.diagnostics, /agent1_provider_applicable_search_modes/);
    // Y sigue sin publicar secretos: sólo la PRESENCIA de la clave.
    assert.match(src.diagnostics, /has_apollo_api_key/);
    assert.doesNotMatch(code.diagnostics, /APOLLO_API_KEY['"]?\s*\]?\s*[,}]/);
  });
});

// ─── § 5 · disponibilidad ≠ seguridad de ejecución ────────────────────────────

describe('§ 5 — los candados de ejecución siguen fail-closed', () => {
  const allOk = {
    isFeatureEnabled: () => true,
    isProviderCapabilityAvailable: async () => true,
    isRolePermitted: async () => true,
    hasBudgetAvailable: async () => true,
    isProviderConfigured: async () => true,
    hasCredential: async () => true,
  };

  it('con todos los candados abiertos, disponible', async () => {
    assert.deepEqual(await evaluateWizardApolloAvailability({ ...allOk }), { available: true });
  });

  it('flag de Apollo apagado ⇒ feature_disabled, y NO «proveedor no soportado»', async () => {
    assert.deepEqual(
      await evaluateWizardApolloAvailability({ ...allOk, isFeatureEnabled: () => false }),
      { available: false, skipReason: 'feature_disabled' },
    );
  });

  it('credencial ausente ⇒ credential_unavailable', async () => {
    assert.deepEqual(
      await evaluateWizardApolloAvailability({ ...allOk, hasCredential: async () => false }),
      { available: false, skipReason: 'credential_unavailable' },
    );
  });

  it('presupuesto agotado ⇒ budget_unavailable, sin degradar el proveedor', async () => {
    const result = await evaluateWizardApolloAvailability({
      ...allOk,
      hasBudgetAvailable: async () => false,
    });
    assert.deepEqual(result, { available: false, skipReason: 'budget_unavailable' });
    // Y la disponibilidad de la BÚSQUEDA no cambia por quedarse sin presupuesto:
    // son dos hechos distintos y la UI debe poder decir el correcto.
    assert.equal(
      resolveWizardDiscoveryAvailability({
        searchMode: 'exploratory',
        countryCode: 'CO',
        industryId: 'Salud',
        supportedCountryCodes: VALID_COUNTRY_CODES,
      }).available,
      true,
    );
  });

  it('una comprobación que lanza se lee como indisponible', async () => {
    assert.deepEqual(
      await evaluateWizardApolloAvailability({
        ...allOk,
        hasCredential: async () => {
          throw new Error('boom');
        },
      }),
      { available: false, skipReason: 'availability_check_failed' },
    );
  });

  it('el selector no ofrece Apollo sin sus tres candados, aunque la búsqueda esté disponible', () => {
    const base = {
      isAuthenticated: true,
      isAdmin: true,
      runOverrideEnabled: true,
      apolloCompanySearchEnabled: true,
      apolloTwoRoundDiscoveryEnabled: true,
    };
    assert.deepEqual(resolveWizardProviderOverrideCapability(base).allowedProviders, [
      'tavily',
      'apollo_organizations',
    ]);
    assert.deepEqual(
      resolveWizardProviderOverrideCapability({ ...base, apolloCompanySearchEnabled: false })
        .allowedProviders,
      ['tavily'],
    );
    assert.equal(
      resolveWizardProviderOverrideCapability({ ...base, isAdmin: false })
        .canSelectDiscoveryProvider,
      false,
    );
  });
});

describe('§ 5 — los topes de la corrida no se movieron', () => {
  it('los cinco topes absolutos siguen en 5 / 2 / 10 / 20 / 5', () => {
    assert.equal(TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX, 5);
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
    assert.equal(MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX, 10);
    assert.equal(MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX, 20);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX, 5);
  });

  it('en los topes, el techo registrable de la corrida sigue siendo 25 créditos', () => {
    const { config } = resolveApolloTwoRoundConfig({
      targetEligibleCompanies: '5',
      maxRounds: '2',
      maxResultsPerRound: '10',
      maxRawResultsPerRun: '20',
      maxEnrichmentsPerRun: '5',
    });
    assert.deepEqual(config, {
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });
    assert.equal(estimateApolloTwoRoundBudget(config).maximumInternalRecordedCredits, 25);
  });
});

// ─── § 12 · regresión RUN 1 (Salud / Colombia) ────────────────────────────────

describe('§ 12 — RUN 1 Salud / Colombia: disponible, cubierta y con spend gate abierto', () => {
  const RUN1_SUBINDUSTRIES = [
    'Redes Hospitalarias y Clínicas',
    'Laboratorios Clínicos y Diagnóstico',
    'Medicina Prepagada y EPS',
  ] as const;

  it('el proveedor está disponible para la combinación exacta reportada', () => {
    assert.deepEqual(
      resolveWizardDiscoveryAvailability({
        searchMode: 'exploratory',
        countryCode: 'CO',
        industryId: 'Salud',
        supportedCountryCodes: VALID_COUNTRY_CODES,
      }),
      { available: true },
    );
  });

  it('cobertura de consulta 3/3 y spend gate permitido', () => {
    // Los términos llegan por el resolutor de catálogo INYECTADO, con la misma forma
    // que la versión publicada: un término `keyword` por subindustria (verificado en
    // Producción con una lectura de sólo lectura, 0 créditos, 0 escrituras). La suite
    // no toca la base: un test que dependiera de la DB no sería determinista.
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: [...RUN1_SUBINDUSTRIES],
      catalogSearchTerms: (label) =>
        (RUN1_SUBINDUSTRIES as readonly string[]).includes(label ?? '')
          ? {
              canonicalSubindustryId: `sub-${label}`,
              canonicalSubindustry: label as string,
              terms: [`${label as string} términos`],
            }
          : null,
    });
    assert.equal(coverage.requestedCount, 3);
    assert.equal(coverage.coveredCount, 3);
    assert.equal(coverage.uncoveredCount, 0);
    assert.deepEqual(coverage.uncoveredSubindustries, []);

    const verdict = evaluateApolloSubindustrySearchCoverageSpendGate(coverage);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.blockReason, null);
  });

  it('una subindustria sin términos sigue bloqueando ANTES del gasto', () => {
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: [...RUN1_SUBINDUSTRIES],
      catalogSearchTerms: () => null,
    });
    const verdict = evaluateApolloSubindustrySearchCoverageSpendGate(coverage);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.blockReason, 'apollo_subindustry_search_coverage_incomplete');
  });
});
