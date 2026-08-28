/**
 * wizard-run-provider-copy.test.ts — copy del modo Apollo y de la superficie
 * administrativa.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 4, § 5, § 10 · casos 22–25 y 30.
 *
 * Lo que se demuestra:
 *
 *   los cinco topes anunciados salen de la configuración efectiva, no de literales
 *   los créditos se anuncian como TECHO («hasta 12»), nunca como consumo
 *   la explicación de Apollo no disponible no nombra variables ni valores
 *   un desacuerdo entre lo pedido y lo resuelto produce una nota sanitizada
 *
 * Todo offline: módulo puro, sin DOM, sin env, sin proveedores.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_RUN_MODE_FILTERS_CAVEAT,
  APOLLO_RUN_MODE_LIMITS_TITLE,
  APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE,
  RUN_PROVIDER_OPTION_LABELS,
  RUN_PROVIDER_SECTION_TITLE,
  buildApolloRunModeCopy,
  describeProviderResolutionMismatch,
} from '../wizard-run-provider-copy';
import type { ApolloRunModeLimits } from '../wizard-run-provider-copy';
import {
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/config';
import { defaultApolloTwoRoundConfig } from '@/server/agents/prospecting-toolkit/apollo-two-round/index';
import { estimateApolloTwoRoundBudget } from '@/server/agents/prospecting-toolkit/apollo-two-round/budget';

/**
 * Topes por defecto del contrato, derivados de la MISMA fuente que la ejecución y
 * la reserva. Si alguien cambia un default o un tope absoluto, este helper cambia
 * con él y las aserciones siguen siendo verdaderas — que es exactamente el punto:
 * el copy no puede quedarse anclado a un número que el runtime ya no aplica.
 *
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING — antes reconstruía el objeto a mano
 * a partir de los cinco `*_DEFAULT` sueltos, lo que se saltaba la invariante de
 * `resolveApolloTwoRoundConfig` que eleva `maxRawResultsPerRun` a lo que las
 * rondas pueden alcanzar de verdad (`maxRounds × maxResultsPerRound`). Con
 * `maxResultsPerRound` en 10, esa reconstrucción manual quedaba en 10/2/10/10/2
 * mientras la config REAL que ejecuta la corrida resuelve 10/2/10/20/2 — el
 * copy habría anunciado un tope crudo que el runtime no aplica. Llamar al
 * resolutor real es lo único que garantiza que el copy nunca diverja.
 */
function defaultLimits(): ApolloRunModeLimits {
  const config = defaultApolloTwoRoundConfig();
  return {
    ...config,
    maxInternalCredits: estimateApolloTwoRoundBudget(config).maximumInternalRecordedCredits,
  };
}

describe('§ 2 · etiquetas de la superficie', () => {
  it('la sección se llama «Proveedor de esta corrida»', () => {
    assert.equal(RUN_PROVIDER_SECTION_TITLE, 'Proveedor de esta corrida');
  });

  it('las opciones son Tavily y «Apollo — dos rondas»', () => {
    assert.equal(RUN_PROVIDER_OPTION_LABELS.tavily, 'Tavily');
    assert.equal(RUN_PROVIDER_OPTION_LABELS.apollo_organizations, 'Apollo — dos rondas');
  });
});

describe('§ 5 · copy del modo Apollo con los topes del contrato', () => {
  const limits = defaultLimits();
  const copy = buildApolloRunModeCopy(limits);

  it('el titular anuncia el objetivo como «hasta», no como promesa', () => {
    assert.match(copy.headline, /^Apollo intentará encontrar hasta 10 empresas nuevas y válidas/);
    assert.match(copy.headline, /máximo de 2 rondas\.$/);
  });

  it('el bloque de máximos se titula «Máximos de esta ejecución:»', () => {
    assert.equal(copy.limitsTitle, APOLLO_RUN_MODE_LIMITS_TITLE);
    assert.equal(copy.limitsTitle, 'Máximos de esta ejecución:');
  });

  it('caso 23 — el tope de resultados por ronda y el raw total son los reales', () => {
    assert.ok(copy.limits.includes('10 resultados por ronda'));
    assert.ok(copy.limits.includes('20 resultados raw en total'));
  });

  it('caso 24 — el tope de enrichments es el real', () => {
    assert.ok(copy.limits.includes('2 enrichments'));
  });

  it('caso 25 — los créditos internos se anuncian como TECHO («hasta 12»)', () => {
    const creditsLine = copy.limits.find((line) => line.includes('créditos internos'));
    assert.equal(creditsLine, 'Hasta 12 créditos internos');
    // La cifra sale del presupuesto real, no de un literal en el copy.
    assert.equal(limits.maxInternalCredits, 12);
  });

  it('§ 5 — nunca afirma que se consumirán los créditos', () => {
    const everything = [copy.headline, copy.limitsTitle, ...copy.limits, ...copy.caveats].join(' ');
    assert.ok(!/se consumirán/i.test(everything));
    assert.ok(!/costará/i.test(everything));
    assert.ok(!/cuesta/i.test(everything));
  });

  it('§ 5 — advierte que no se garantiza el objetivo ni se relajan filtros', () => {
    assert.ok(copy.caveats.includes('No se garantiza encontrar diez empresas.'));
    assert.ok(copy.caveats.includes(APOLLO_RUN_MODE_FILTERS_CAVEAT));
    assert.equal(
      APOLLO_RUN_MODE_FILTERS_CAVEAT,
      'Los filtros de calidad y duplicados no se reducirán para alcanzar el objetivo.',
    );
  });

  it('caso 22 — el copy no puede anunciar más rondas que el tope absoluto', () => {
    // Si alguien intentara anunciar tres rondas, el tope absoluto del contrato
    // (2) sería la contradicción visible. Se fija aquí para que el copy y el
    // guardrail no puedan divergir sin que un test lo diga.
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
    assert.ok(limits.maxRounds <= MAX_SEARCH_ROUNDS_ABSOLUTE_MAX);
    assert.ok(limits.targetEligibleCompanies <= TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX);
    assert.ok(limits.maxResultsPerRound <= MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX);
    assert.ok(limits.maxRawResultsPerRun <= MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX);
    assert.ok(limits.maxEnrichmentsPerRun <= MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX);
  });
});

describe('§ 5 · el copy sigue a la configuración, no a un literal', () => {
  it('con topes rebajados anuncia los rebajados', () => {
    const reduced: ApolloRunModeLimits = {
      targetEligibleCompanies: 3,
      maxRounds: 1,
      maxResultsPerRound: 2,
      maxRawResultsPerRun: 2,
      maxEnrichmentsPerRun: 0,
      maxInternalCredits: 2,
    };
    const copy = buildApolloRunModeCopy(reduced);

    assert.match(copy.headline, /hasta 3 empresas nuevas y válidas/);
    assert.match(copy.headline, /máximo de 1 ronda\.$/);
    assert.ok(copy.limits.includes('2 resultados por ronda'));
    assert.ok(copy.limits.includes('0 enrichments'));
    assert.ok(copy.limits.includes('Hasta 2 créditos internos'));
    assert.ok(copy.caveats.includes('No se garantiza encontrar tres empresas.'));
  });

  it('un objetivo de una empresa se redacta en singular', () => {
    const copy = buildApolloRunModeCopy({
      targetEligibleCompanies: 1,
      maxRounds: 1,
      maxResultsPerRound: 1,
      maxRawResultsPerRun: 1,
      maxEnrichmentsPerRun: 1,
      maxInternalCredits: 1,
    });
    assert.match(copy.headline, /hasta 1 empresa nueva y válida/);
    assert.ok(copy.caveats.includes('No se garantiza encontrar una empresa.'));
    assert.ok(copy.limits.includes('Hasta 1 crédito interno'));
  });
});

describe('§ 4 · la explicación de Apollo no disponible está sanitizada', () => {
  it('dice qué pasa, no qué candado lo impide', () => {
    assert.equal(
      APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE,
      'Apollo no está disponible para esta ejecución.',
    );
  });

  it('caso 30 — no nombra variables de entorno ni sus valores', () => {
    const forbidden = [
      'ENABLE_APOLLO_COMPANY_SEARCH',
      'ENABLE_APOLLO_TWO_ROUND_DISCOVERY',
      'ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE',
      'AGENT1_WIZARD_DISCOVERY_PROVIDER',
      'process.env',
      'false',
      'true',
      'admin',
      'role',
      'api_key',
      'vault',
    ];
    for (const token of forbidden) {
      assert.ok(
        !APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE.toLowerCase().includes(token.toLowerCase()),
        `el aviso no debe contener "${token}"`,
      );
    }
  });
});

describe('§ 10 · nota cuando lo pedido y lo resuelto no coinciden', () => {
  it('sin petición no hay nada que explicar', () => {
    assert.equal(
      describeProviderResolutionMismatch({
        requested: null,
        resolved: 'tavily',
        reason: 'global_default_provider',
      }),
      null,
    );
  });

  it('petición honrada: la fila del proveedor ya lo dice todo', () => {
    assert.equal(
      describeProviderResolutionMismatch({
        requested: 'apollo_organizations',
        resolved: 'apollo_organizations',
        reason: 'run_level_override_authorized',
      }),
      null,
    );
  });

  it('los tres motivos de rechazo comparten un mensaje indistinguible', () => {
    const reasons = [
      'requested_provider_disabled_by_kill_switch',
      'requested_provider_not_authorized',
      'run_override_capability_disabled',
    ] as const;
    const messages = reasons.map((reason) =>
      describeProviderResolutionMismatch({
        requested: 'apollo_organizations',
        resolved: 'tavily',
        reason,
      }),
    );
    assert.deepEqual(new Set(messages), new Set([APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE]));
  });

  it('un reintento explica que se conservó el proveedor original', () => {
    assert.equal(
      describeProviderResolutionMismatch({
        requested: 'apollo_organizations',
        resolved: 'apollo_organizations',
        reason: 'preserved_from_previous_attempt',
      }),
      'Se conservó el proveedor del intento anterior de esta corrida.',
    );
  });
});
