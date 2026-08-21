/**
 * AGENT2A-APOLLO-PEOPLE-SEARCH-BILLING-TRUTH-1.1 — copy correction tests.
 *
 * People Search no cobra créditos (soporte de Apollo lo confirmó). Antes de este
 * hito, la UI de ApolloResultSummary (contact-enrichment-chat-result.tsx) seguía
 * describiendo el corte por tope de VOLUMEN de resultados como si fuera un
 * "presupuesto agotado", contradiciendo la contabilidad de costo cero ya corregida
 * en el runner/adaptador. `blocked_by_search_budget` / `search_budget_reached`
 * siguen siendo nombres internos legacy (ver SearchGuardrailMeta en
 * apollo-people-adapter.ts) — sólo el texto orientado al usuario cambia aquí.
 *
 * No DOM rendering required — mirrors the exact derived expressions used in
 * ApolloResultSummary, following the pattern established in
 * lusha-empty-vs-unavailable-branch-17b4x7c3d.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type StoppedEarlyReason = 'target_reviewable_reached' | 'search_budget_reached' | 'all_attempts_exhausted' | null;

// ── Mirror of the exact ternary in ApolloResultSummary (contact-enrichment-chat-result.tsx) ──

function stoppedReasonLabel(reason: StoppedEarlyReason): string {
  return reason === 'target_reviewable_reached'
    ? 'objetivo alcanzado'
    : reason === 'search_budget_reached'
      ? 'límite de resultados alcanzado'
      : 'intentos agotados';
}

function searchCreditsLabel(estimatedSearchCredits: number): string {
  return estimatedSearchCredits === 0 ? 'sin costo' : `${estimatedSearchCredits} créditos`;
}

function blockedBySearchBudgetMessage(maxResultsPerRun: number): string {
  return `Búsqueda detenida al alcanzar el límite de ${maxResultsPerRun} resultados.`;
}

describe('ApolloResultSummary copy — stopped_early_reason label', () => {
  it('search_budget_reached renders as a results-limit message, not a budget message', () => {
    const label = stoppedReasonLabel('search_budget_reached');
    assert.equal(label, 'límite de resultados alcanzado');
    assert.match(label, /límite de resultados/i);
    assert.doesNotMatch(label, /presupuesto agotado/i);
    assert.doesNotMatch(label, /presupuesto|créditos|costo|gasto/i);
  });

  it('other reasons are unaffected by the copy correction', () => {
    assert.equal(stoppedReasonLabel('target_reviewable_reached'), 'objetivo alcanzado');
    assert.equal(stoppedReasonLabel('all_attempts_exhausted'), 'intentos agotados');
    assert.equal(stoppedReasonLabel(null), 'intentos agotados');
  });
});

describe('ApolloResultSummary copy — blocked_by_search_budget banner', () => {
  it('never says "cortada por presupuesto", describes the results cap instead', () => {
    const message = blockedBySearchBudgetMessage(15);
    assert.equal(message, 'Búsqueda detenida al alcanzar el límite de 15 resultados.');
    assert.doesNotMatch(message, /Búsqueda cortada por presupuesto/i);
    assert.doesNotMatch(message, /presupuesto|créditos|costo|gasto/i);
  });
});

describe('ApolloResultSummary copy — search credits stay "sin costo"', () => {
  it('renders "sin costo" when estimated_search_credits is 0 (the only real value now)', () => {
    assert.equal(searchCreditsLabel(0), 'sin costo');
  });

  it('would still render a credit count if a nonzero value were ever passed (regression guard)', () => {
    assert.equal(searchCreditsLabel(3), '3 créditos');
  });
});
