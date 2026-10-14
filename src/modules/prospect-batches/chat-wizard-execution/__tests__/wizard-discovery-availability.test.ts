/**
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — matriz de disponibilidad del discovery.
 *
 * Módulo PURO bajo prueba: sin env, sin DOM, sin red, sin DB. Ningún proveedor se
 * llama en este archivo y ninguna rama puede gastar un crédito.
 *
 * Lo que fija:
 *   - los 20 países que el wizard ofrece admiten proveedor externo, TODOS;
 *   - la industria no puede hacer indisponible a un proveedor —incluidas las tres
 *     que mapean a un sector del proveedor OCULTO Lusha (salud, educación,
 *     tecnología), que eran justo las que quedaban sin camino;
 *   - 0, 1 o N subindustrias dan el mismo resultado, y el criterio adicional
 *     también: ninguno de los dos es siquiera un parámetro de la decisión;
 *   - `default` y `recomendado` no son `disponible`;
 *   - cada causa distinta tiene su propio código, y las familias no se mezclan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { VALID_COUNTRY_CODES } from '@/modules/prospect-batches/chat-wizard';
import {
  APOLLO_SKIP_REASON_KINDS,
  DISCOVERY_UNAVAILABLE_REASON_KINDS,
  EXECUTION_FAILURE_REASON_KINDS,
  PROVIDER_APPLICABLE_SEARCH_MODES,
  isProviderApplicableSearchMode,
  resolveWizardDiscoveryAvailability,
  type WizardDiscoveryAvailabilityInput,
} from '../wizard-discovery-availability';

function availabilityInput(
  overrides: Partial<WizardDiscoveryAvailabilityInput> = {},
): WizardDiscoveryAvailabilityInput {
  return {
    searchMode: 'exploratory',
    countryCode: 'CO',
    industryId: 'ind-health',
    supportedCountryCodes: VALID_COUNTRY_CODES,
    ...overrides,
  };
}

// ─── § 10 · matriz de países ───────────────────────────────────────────────────

describe('§ 10 — todos los países soportados admiten proveedor externo', () => {
  it('el catálogo del wizard no está vacío (la matriz probaría nada)', () => {
    assert.ok(LATAM_COUNTRIES.length >= 20, `países soportados: ${LATAM_COUNTRIES.length}`);
    assert.equal(VALID_COUNTRY_CODES.size, LATAM_COUNTRIES.length);
  });

  for (const country of LATAM_COUNTRIES) {
    it(`${country.code} (${country.name}) → disponible`, () => {
      const result = resolveWizardDiscoveryAvailability(
        availabilityInput({ countryCode: country.code }),
      );
      assert.equal(result.available, true, `${country.code} quedó no disponible`);
    });
  }

  it('disponibles = soportados, sin excepciones', () => {
    const unavailable = LATAM_COUNTRIES.filter(
      (c) => !resolveWizardDiscoveryAvailability(availabilityInput({ countryCode: c.code })).available,
    ).map((c) => c.code);
    assert.deepEqual(unavailable, []);
  });

  it('un país fuera del catálogo del wizard no se inventa disponibilidad', () => {
    const result = resolveWizardDiscoveryAvailability(availabilityInput({ countryCode: 'ZZ' }));
    assert.deepEqual(result, { available: false, reason: 'country_not_supported' });
  });
});

// ─── § 11 · matriz de criterios ────────────────────────────────────────────────

describe('§ 11 — ninguna combinación de criterios retira el proveedor', () => {
  /**
   * Las tres primeras mapean a un sector de Lusha (salud / educación / tecnología) y
   * son exactamente las que quedaban bloqueadas en los 20 países.
   */
  const INDUSTRIES = [
    'Salud',
    'Educación / EdTech',
    'Tecnología',
    'Minería',
    'Manufactura',
    'Servicios financieros / Fintech',
  ];

  for (const industry of INDUSTRIES) {
    it(`industria «${industry}» → disponible`, () => {
      assert.equal(
        resolveWizardDiscoveryAvailability(availabilityInput({ industryId: industry })).available,
        true,
      );
    });
  }

  it('la decisión no admite subindustrias ni criterio adicional como entrada', () => {
    // La forma del contrato es la prueba: 0, 1 o N subindustrias no pueden cambiar
    // el resultado porque no hay por dónde pasarlas. Un cambio futuro que quisiera
    // condicionar la disponibilidad al contenido de los criterios tendría que
    // ampliar la firma, y eso se ve en revisión.
    const keys = Object.keys(availabilityInput()).sort();
    assert.deepEqual(keys, ['countryCode', 'industryId', 'searchMode', 'supportedCountryCodes']);
  });

  it('el mismo país+industria da el mismo veredicto en cada llamada (determinista)', () => {
    const input = availabilityInput();
    assert.deepEqual(
      resolveWizardDiscoveryAvailability(input),
      resolveWizardDiscoveryAvailability(input),
    );
  });

  it('no muta la entrada', () => {
    const input = availabilityInput();
    const snapshot = { ...input };
    resolveWizardDiscoveryAvailability(input);
    assert.deepEqual(input, snapshot);
  });
});

// ─── § 4 · modos de búsqueda ───────────────────────────────────────────────────

describe('§ 4 — sólo los modos de discovery por criterios admiten proveedor', () => {
  it('los dos tokens de «empresas por criterios» son aplicables', () => {
    assert.deepEqual([...PROVIDER_APPLICABLE_SEARCH_MODES].sort(), [
      'companies_by_criteria',
      'exploratory',
    ]);
    assert.equal(isProviderApplicableSearchMode('exploratory'), true);
    assert.equal(isProviderApplicableSearchMode('companies_by_criteria'), true);
    assert.equal(isProviderApplicableSearchMode(' exploratory '), true);
  });

  it('un modo que no es discovery no habilita proveedor artificialmente', () => {
    for (const mode of ['competitors', 'suppliers', 'import', 'upload', 'manual', '', null]) {
      const result = resolveWizardDiscoveryAvailability(availabilityInput({ searchMode: mode }));
      assert.deepEqual(
        result,
        { available: false, reason: 'search_mode_not_provider_applicable' },
        `modo ${String(mode)} no debía admitir proveedor`,
      );
    }
  });
});

// ─── Criterios incompletos ─────────────────────────────────────────────────────

describe('criterios incompletos siguen bloqueados, y con su propia causa', () => {
  it('sin país', () => {
    assert.deepEqual(resolveWizardDiscoveryAvailability(availabilityInput({ countryCode: null })), {
      available: false,
      reason: 'country_not_selected',
    });
  });

  it('sin industria', () => {
    assert.deepEqual(resolveWizardDiscoveryAvailability(availabilityInput({ industryId: '  ' })), {
      available: false,
      reason: 'industry_not_selected',
    });
  });
});

// ─── § 12 · regresión del caso reportado (Salud / Colombia) ────────────────────

describe('§ 12 — RUN 1 Salud / Colombia: el caso exacto de la QA visual', () => {
  it('disponible con las tres subindustrias de Salud', () => {
    // Las tres subindustrias («Redes Hospitalarias y Clínicas», «Laboratorios
    // Clínicos y Diagnóstico», «Medicina Prepagada y EPS») no participan de esta
    // decisión, y eso es el punto: su contenido —que contiene los alias `clinicas`
    // y `eps` del sector salud de Lusha— era lo que activaba el bloqueo.
    assert.deepEqual(
      resolveWizardDiscoveryAvailability(
        availabilityInput({ searchMode: 'exploratory', countryCode: 'CO', industryId: 'Salud' }),
      ),
      { available: true },
    );
  });
});

// ─── § 16 · modelo de razones ──────────────────────────────────────────────────

describe('§ 16 — cada causa distinta tiene su propio código y su propia familia', () => {
  it('ningún motivo de disponibilidad se clasifica como problema del proveedor externo', () => {
    // `search_mode_not_provider_applicable` es el único `provider_unsupported`: es
    // la única causa que de verdad dice «ningún proveedor externo sirve aquí».
    const unsupported = Object.entries(DISCOVERY_UNAVAILABLE_REASON_KINDS)
      .filter(([, kind]) => kind === 'provider_unsupported')
      .map(([code]) => code);
    assert.deepEqual(unsupported, ['search_mode_not_provider_applicable']);
  });

  it('un flag apagado, una credencial ausente y un presupuesto agotado son familias DISTINTAS', () => {
    assert.equal(APOLLO_SKIP_REASON_KINDS.feature_disabled, 'feature_disabled');
    assert.equal(APOLLO_SKIP_REASON_KINDS.credential_unavailable, 'missing_credentials');
    assert.equal(APOLLO_SKIP_REASON_KINDS.provider_not_configured, 'missing_credentials');
    assert.equal(APOLLO_SKIP_REASON_KINDS.budget_unavailable, 'budget_exhausted');
    assert.equal(APOLLO_SKIP_REASON_KINDS.role_not_permitted, 'not_permitted');
  });

  it('NINGÚN motivo del preflight del proveedor se clasifica como «proveedor no soportado»', () => {
    // Ésta es la confusión que produjo el defecto: un bloqueo de configuración se
    // presentó como si el proveedor no sirviera para la búsqueda.
    for (const [code, kind] of Object.entries(APOLLO_SKIP_REASON_KINDS)) {
      assert.notEqual(kind, 'provider_unsupported', `${code} se clasificó como no soportado`);
    }
  });

  it('presupuesto agotado NO es «proveedor no soportado» en ninguna capa', () => {
    for (const code of [
      'BUDGET_EXCEEDED',
      'BUDGET_PERIOD_CLOSED',
      'BUDGET_PERIOD_NOT_CONFIGURED',
      'EXECUTION_CREDIT_LIMIT_EXCEEDED',
      'BUDGET_RESERVATION_FAILED',
    ] as const) {
      assert.equal(EXECUTION_FAILURE_REASON_KINDS[code], 'budget_exhausted');
    }
    for (const kind of Object.values(EXECUTION_FAILURE_REASON_KINDS)) {
      assert.notEqual(kind, 'provider_unsupported');
    }
  });

  it('los códigos de las tres capas no se solapan: una causa, un código', () => {
    const codes = [
      ...Object.keys(DISCOVERY_UNAVAILABLE_REASON_KINDS),
      ...Object.keys(APOLLO_SKIP_REASON_KINDS),
      ...Object.keys(EXECUTION_FAILURE_REASON_KINDS),
    ];
    assert.equal(new Set(codes).size, codes.length);
  });

  it('persistencia y catálogo conservan familia propia, no se colapsan en «inválido»', () => {
    assert.equal(EXECUTION_FAILURE_REASON_KINDS.PERSISTENCE_NOT_READY, 'persistence_not_ready');
    assert.equal(EXECUTION_FAILURE_REASON_KINDS.CATALOG_CHANGED, 'catalog_coverage_failed');
  });
});
