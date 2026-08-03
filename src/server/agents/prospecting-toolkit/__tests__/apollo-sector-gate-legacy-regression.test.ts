/**
 * apollo-sector-gate-legacy-regression.test.ts — El cambio sectorial del § 5
 * afecta TAMBIÉN al flujo Apollo legacy.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 8.
 *
 * `evaluateApolloSectorRelevanceForPaidOperation` tiene UN solo llamador de
 * producción —`evaluateApolloEnrichmentEligibility`— y ese gate corre en la ruta
 * Apollo legacy, con `ENABLE_APOLLO_TWO_ROUND_DISCOVERY` apagado. Por tanto el
 * cambio NO está gateado por el flag y afirmar que el flujo legacy es idéntico
 * byte a byte sería falso.
 *
 * Lo que cambia, y sólo esto:
 *
 *   antes  — `retail` sin señales específicas ⇒ contradicción ⇒ rechazo
 *   ahora  — `retail` sin señales específicas ⇒ evidencia INSUFICIENTE ⇒ puede
 *            competir por un enrichment bajo el cap
 *
 * Lo que NO cambia: `retail banking` sigue siendo contradicción y sigue
 * rechazándose antes de gastar.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateApolloSectorRelevanceForPaidOperation } from '../apollo-sector-relevance-gate';
import { evaluateApolloEnrichmentEligibility } from '../apollo-enrichment-eligibility-gate';
import { isApolloTwoRoundDiscoveryEnabled } from '@/lib/feature-flags.server';
import type { WebSearchResult } from '../types';

const SECTOR = 'Supermercados e Hipermercados';

function organization(options: {
  name: string;
  domain: string;
  industry: string | null;
  snippet?: string;
}): WebSearchResult {
  return {
    title: options.name,
    url: `https://${options.domain}`,
    snippet: options.snippet ?? null,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      domain: options.domain,
      industry: options.industry,
      country_code: 'CO',
      apollo_profile: { industry: options.industry, industries: [] },
    },
  };
}

const CITIGROUP = organization({
  name: 'Citigroup',
  domain: 'citi.com',
  industry: 'retail banking',
  snippet: 'servicios de banca minorista',
});

const RETAIL_ONLY = organization({
  name: 'Cadena Comercial Andina',
  domain: 'cadenaandina.com.co',
  industry: 'retail',
});

const REAL_SUPERMARKET = organization({
  name: 'Supermercados del Valle',
  domain: 'supervalle.com.co',
  industry: 'retail',
  snippet: 'cadena de supermercados y tiendas de abarcotes; autoservicio y grocery',
});

describe('§ 8 · el gate sectorial, con el flag de dos rondas APAGADO', () => {
  test('el flujo legacy es el que corre: el flag está apagado por defecto', () => {
    const previous = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    try {
      assert.equal(isApolloTwoRoundDiscoveryEnabled(), false);
    } finally {
      if (previous !== undefined) process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previous;
    }
  });

  test('banca minorista se RECHAZA antes del enrichment, igual que antes', () => {
    const previous = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    try {
      const eligibility = evaluateApolloEnrichmentEligibility(CITIGROUP, {
        targetCountryCode: 'CO',
        sector: SECTOR,
      });
      assert.equal(eligibility.eligible, false);
      assert.equal(
        eligibility.eligible === false && eligibility.skipReason,
        'sector_relevance_contradicted',
      );
    } finally {
      if (previous !== undefined) process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previous;
    }
  });

  test('CAMBIO DECLARADO — `retail` a secas deja de ser contradicción también en legacy', () => {
    const previous = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    try {
      const decision = evaluateApolloSectorRelevanceForPaidOperation(RETAIL_ONLY, SECTOR).decision;
      assert.equal(decision, 'sector_evidence_missing_needs_enrichment');

      // Y por tanto el gate legacy lo deja competir por un enrichment bajo el
      // cap, en vez de rechazarlo. Éste es el cambio que el PR declara.
      const eligibility = evaluateApolloEnrichmentEligibility(RETAIL_ONLY, {
        targetCountryCode: 'CO',
        sector: SECTOR,
      });
      assert.equal(eligibility.eligible, true);
    } finally {
      if (previous !== undefined) process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previous;
    }
  });

  test('un supermercado real NO se bloquea', () => {
    const decision = evaluateApolloSectorRelevanceForPaidOperation(
      REAL_SUPERMARKET,
      SECTOR,
    ).decision;
    assert.equal(decision, 'relevant');
  });
});

describe('§ 8 · el mismo veredicto con el flag de dos rondas ENCENDIDO', () => {
  test('el gate sectorial no depende del flag: mismos veredictos', () => {
    const previous = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
    try {
      assert.equal(
        evaluateApolloSectorRelevanceForPaidOperation(CITIGROUP, SECTOR).decision,
        'sector_relevance_contradicted',
      );
      assert.equal(
        evaluateApolloSectorRelevanceForPaidOperation(RETAIL_ONLY, SECTOR).decision,
        'sector_evidence_missing_needs_enrichment',
      );
      assert.equal(
        evaluateApolloSectorRelevanceForPaidOperation(REAL_SUPERMARKET, SECTOR).decision,
        'relevant',
      );
    } finally {
      if (previous === undefined) delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
      else process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previous;
    }
  });

  test('un sector sin mapping sigue sin autorizar gasto en ninguno de los dos modos', () => {
    const decision = evaluateApolloSectorRelevanceForPaidOperation(
      RETAIL_ONLY,
      'Sector Inexistente Sin Mapeo',
    ).decision;
    assert.equal(decision, 'sector_not_mapped');
  });
});
