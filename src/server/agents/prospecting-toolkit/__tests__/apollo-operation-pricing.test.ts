/**
 * Tests — apollo-operation-pricing.ts
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 · re-autorizado por
 * AGENT1-APOLLO-BILLING-MODE-V2.
 *
 * Lo que este archivo fijaba y sigue fijando: la reserva conoce las DOS
 * operaciones facturables. El lote de QA del 2026-07-30 se cobró contra una
 * reserva que sólo conocía la búsqueda.
 *
 * Lo que este archivo fijaba y estaba MAL: los números de esa reserva. Se
 * escribieron bajo «1 crédito por organización devuelta» (`1 query × 3
 * results = 3`), un modelo que Apollo Support desmintió: Organization Search
 * cobra 1 crédito por PÁGINA NO VACÍA. Mantener esas aserciones habría
 * convertido este archivo en un trinquete que defiende el defecto — bloqueando
 * justamente su corrección.
 *
 * Pure module: no network, no provider call, no process.env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_BILLABLE_OPERATION_KEYS,
  APOLLO_BILLABLE_UNIT,
  APOLLO_PRICING_SOURCE,
  APOLLO_PRICING_VERSION,
  APOLLO_PRICING_VERSION_V1_PER_RESULT,
  creditsForApolloEnrichmentCalls,
  creditsForApolloNonEmptyPages,
  creditsForApolloOperation,
  creditsForApolloOperationUnit,
  estimateApolloRunCreditBreakdown,
  isApolloBillableOperation,
  toApolloRunCreditBreakdownMetadata,
} from '../apollo-operation-pricing';

/**
 * Los topes por defecto de la ruta legacy: 1 invocación de búsqueda que paga
 * como máximo 1 página, y 1 enrichment.
 *
 * `maxResultsPerQuery: 3` se conserva a propósito — es el `per_page` real de
 * esa configuración y NO debe afectar a ningún crédito.
 */
const DEFAULT_CAPS = {
  maxQueriesPerRun: 1,
  maxPagesPerQuery: 1,
  maxResultsPerQuery: 3,
  maxEnrichmentsPerRun: 1,
};

describe('A. Both billable operations are part of the reservation', () => {
  it('reserves search AND enrichment when the cascade is enabled', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true });

    assert.equal(b.searchReservedCredits, 1, '1 invocación x 1 página no vacía');
    assert.equal(b.enrichmentReservedCredits, 1, '1 enrichment');
    assert.equal(b.totalReservedCredits, 2);
  });

  it('la reserva sigue cubriendo la operación que el defecto de QA olvidaba', () => {
    const withEnrichment = estimateApolloRunCreditBreakdown({
      ...DEFAULT_CAPS,
      enrichmentEnabled: true,
    });

    // El defecto de 2026-07-30 no era el tamaño de la reserva: era que la
    // reserva ignoraba el enrichment. Eso se comprueba con la RELACIÓN entre
    // las dos partidas, no con el número que el modelo viejo producía.
    assert.ok(
      withEnrichment.totalReservedCredits > withEnrichment.searchReservedCredits,
      'el total debe exceder la búsqueda sola',
    );
    assert.equal(
      withEnrichment.totalReservedCredits,
      withEnrichment.searchReservedCredits + withEnrichment.enrichmentReservedCredits,
    );
  });

  it('reserves zero enrichment credits when the cascade is disabled', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: false });

    assert.equal(b.enrichmentReservedCredits, 0, 'a disabled cascade cannot call');
    assert.equal(b.totalReservedCredits, 1);
    // The operation is still recorded as considered.
    assert.equal(b.inputs.enrichmentEnabled, false);
  });

  it('exposes both canonical operation keys', () => {
    assert.deepEqual([...APOLLO_BILLABLE_OPERATION_KEYS], [
      'organizations_search',
      'organization_enrichment',
    ]);
  });
});

describe('B. Provenance travels with the breakdown', () => {
  it('carries pricingSource and pricingVersion', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true });
    assert.equal(b.pricingSource, APOLLO_PRICING_SOURCE);
    assert.equal(b.pricingVersion, APOLLO_PRICING_VERSION);
    assert.ok(b.pricingVersion.length > 0);
  });

  it('la versión de pricing que se ESCRIBE es v2, y v1 sólo existe para leer', () => {
    assert.notEqual(APOLLO_PRICING_VERSION, APOLLO_PRICING_VERSION_V1_PER_RESULT);
    assert.match(APOLLO_PRICING_VERSION, /per-page/);
    // Una reserva estampada hoy no puede declarar el modelo viejo.
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true });
    assert.notEqual(b.pricingVersion, APOLLO_PRICING_VERSION_V1_PER_RESULT);
  });

  it('echoes the caps so a reservation is reproducible from its record', () => {
    const b = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 3,
      maxPagesPerQuery: 5,
      maxResultsPerQuery: 100,
      maxEnrichmentsPerRun: 3,
      enrichmentEnabled: true,
    });
    assert.deepEqual(b.inputs, {
      maxQueriesPerRun: 3,
      maxPagesPerQuery: 5,
      maxResultsPerQuery: 100,
      maxEnrichmentsPerRun: 3,
      enrichmentEnabled: true,
    });
    assert.equal(b.totalReservedCredits, 18, '3 invocaciones x 5 páginas + 3 enrichment');
  });

  it('metadata projection carries no secrets — only caps and identifiers', () => {
    const meta = toApolloRunCreditBreakdownMetadata(
      estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true }),
    );
    const serialized = JSON.stringify(meta).toLowerCase();
    for (const forbidden of ['api_key', 'apikey', 'authorization', 'bearer', 'token', 'secret']) {
      assert.ok(!serialized.includes(forbidden), `must not contain ${forbidden}`);
    }
    assert.equal(meta.total_reserved_credits, 2);
    assert.equal(meta.search_reserved_credits, 1);
    assert.equal(meta.enrichment_reserved_credits, 1);
    // La unidad viaja con el número: sin ella, «1» es ambiguo.
    assert.equal(meta.search_billing_unit, 'non_empty_page');
    assert.equal(meta.max_pages_per_query, 1);
  });
});

describe('C. Degenerate caps never produce a negative or fractional reservation', () => {
  it('clamps zero, negative and non-finite caps to zero', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const b = estimateApolloRunCreditBreakdown({
        maxQueriesPerRun: bad,
        maxPagesPerQuery: bad,
        maxResultsPerQuery: bad,
        maxEnrichmentsPerRun: bad,
        enrichmentEnabled: true,
      });
      assert.equal(b.totalReservedCredits, 0, `cap ${bad} must not reserve credits`);
      assert.ok(b.totalReservedCredits >= 0);
    }
  });

  it('floors fractional caps rather than reserving a fractional credit', () => {
    const b = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1.9,
      maxPagesPerQuery: 3.9,
      maxResultsPerQuery: 3.9,
      maxEnrichmentsPerRun: 1.9,
      enrichmentEnabled: true,
    });
    assert.equal(b.searchReservedCredits, 3, '1 invocación x 3 páginas');
    assert.equal(b.enrichmentReservedCredits, 1);
    assert.ok(Number.isInteger(b.totalReservedCredits));
  });
});

describe('D. Per-operation unit pricing is the shared source', () => {
  it('declara la unidad facturable de cada operación', () => {
    assert.equal(APOLLO_BILLABLE_UNIT.organizations_search, 'non_empty_page');
    assert.equal(APOLLO_BILLABLE_UNIT.organization_enrichment, 'enrichment_call_attempted');
  });

  it('convierte PÁGINAS no vacías en créditos de búsqueda', () => {
    assert.equal(creditsForApolloNonEmptyPages(3), 3);
    assert.equal(creditsForApolloNonEmptyPages(0), 0);
    assert.equal(creditsForApolloEnrichmentCalls(1), 1);
  });

  it('los envoltorios nombrados y la función genérica dan el mismo número', () => {
    for (const n of [0, 1, 5, 10]) {
      assert.equal(
        creditsForApolloNonEmptyPages(n),
        creditsForApolloOperation('organizations_search', n),
      );
      assert.equal(
        creditsForApolloEnrichmentCalls(n),
        creditsForApolloOperation('organization_enrichment', n),
      );
    }
  });

  it('never returns a negative credit count', () => {
    assert.equal(creditsForApolloNonEmptyPages(-4), 0);
    assert.equal(creditsForApolloNonEmptyPages(Number.NaN), 0);
  });

  it('unit price is exposed for both operations', () => {
    assert.equal(creditsForApolloOperationUnit('organizations_search'), 1);
    assert.equal(creditsForApolloOperationUnit('organization_enrichment'), 1);
  });

  it('recognises exactly the billable operations', () => {
    assert.equal(isApolloBillableOperation('organizations_search'), true);
    assert.equal(isApolloBillableOperation('organization_enrichment'), true);
    assert.equal(isApolloBillableOperation('multi_query_web_search'), false);
    assert.equal(isApolloBillableOperation('people_search'), false);
  });
});
