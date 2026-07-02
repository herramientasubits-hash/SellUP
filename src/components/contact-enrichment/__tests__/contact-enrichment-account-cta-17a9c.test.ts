/**
 * Tests — 17A.9C: CTA Enriquecer contactos desde Accounts
 *
 * Pure unit tests. No network, no DOM. Uses Node.js built-in test runner.
 *
 * Sections:
 *   A — preloadedCompany desde account: countryCode y hubspotCompanyId se preservan
 *   B — wizard con preloadedCompany no solicita búsqueda manual
 *   C — flujo desde /contacts sin preloadedCompany sigue funcionando
 *   D — account archivada: el botón no muestra (lógica disabled)
 *   E — account_id correcto en el candidato preloaded
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialContactEnrichmentChatState,
} from '../contact-enrichment-chat-reducer';
import type { ContactEnrichmentInitialCompany } from '../contact-enrichment-chat-types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function accountPreloadedCompany(
  overrides: Partial<ContactEnrichmentInitialCompany> = {},
): ContactEnrichmentInitialCompany {
  return {
    name: 'Siesa',
    domain: 'siesa.com',
    country: 'Colombia',
    countryCode: 'CO',
    sellupAccountId: 'acc-siesa-001',
    hubspotCompanyId: 'hs-123',
    ...overrides,
  };
}

// ── A — preloadedCompany preserva countryCode y hubspotCompanyId ──────────────

describe('A — preloadedCompany desde account', () => {
  it('A1 wizard arranca en confirming con la empresa preseleccionada', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.step, 'confirming');
    assert.ok(state.selectedCandidate);
    assert.equal(state.selectedCandidate?.name, 'Siesa');
  });

  it('A2 countryCode se preserva en el candidato seleccionado', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.countryCode, 'CO');
  });

  it('A3 hubspotCompanyId se preserva en el candidato seleccionado', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.hubspotCompanyId, 'hs-123');
  });

  it('A4 sellupAccountId se preserva en el candidato seleccionado', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.sellupAccountId, 'acc-siesa-001');
  });

  it('A5 domain se preserva en el candidato seleccionado', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.domain, 'siesa.com');
  });

  it('A6 preloadedCompany sin hubspotCompanyId → candidato con hubspotCompanyId undefined', () => {
    const state = createInitialContactEnrichmentChatState(
      accountPreloadedCompany({ hubspotCompanyId: undefined }),
    );
    assert.equal(state.selectedCandidate?.hubspotCompanyId, undefined);
  });

  it('A7 preloadedCompany sin countryCode → candidato con countryCode undefined', () => {
    const state = createInitialContactEnrichmentChatState(
      accountPreloadedCompany({ countryCode: undefined }),
    );
    assert.equal(state.selectedCandidate?.countryCode, undefined);
  });
});

// ── B — wizard con preloadedCompany no solicita búsqueda manual ───────────────

describe('B — wizard con preloadedCompany evita await_company', () => {
  it('B1 step inicial es confirming, no await_company', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.notEqual(state.step, 'await_company');
    assert.equal(state.step, 'confirming');
  });

  it('B2 hay exactamente un mensaje de asistente en el state inicial (intro preloaded)', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, 'assistant');
  });

  it('B3 query inicial es el nombre de la empresa', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.query, 'Siesa');
  });

  it('B4 source del candidato es sellup (no manual)', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.source, 'sellup');
  });
});

// ── C — flujo sin preloadedCompany sigue funcionando ─────────────────────────

describe('C — flujo desde /contacts sin preloadedCompany', () => {
  it('C1 sin preloadedCompany arranca en await_company con saludo', () => {
    const state = createInitialContactEnrichmentChatState();
    assert.equal(state.step, 'await_company');
    assert.equal(state.selectedCandidate, null);
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, 'assistant');
  });

  it('C2 sin preloadedCompany query inicial está vacío', () => {
    const state = createInitialContactEnrichmentChatState();
    assert.equal(state.query, '');
  });

  it('C3 undefined explícito equivale a sin preloadedCompany', () => {
    const state = createInitialContactEnrichmentChatState(undefined);
    assert.equal(state.step, 'await_company');
  });
});

// ── D — account archivada ─────────────────────────────────────────────────────

describe('D — account archivada: botón no visible', () => {
  it('D1 disabled=true no rompe el wizard (el botón simplemente no monta el drawer)', () => {
    // Verificamos que el state de wizard aún funciona correctamente aunque
    // el botón esté disabled en la UI — el wizard mismo no sabe de archived.
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.step, 'confirming');
    assert.equal(state.selectedCandidate?.name, 'Siesa');
  });
});

// ── E — account_id correcto en el run ─────────────────────────────────────────

describe('E — account_id se mantiene en el candidato', () => {
  it('E1 candidates array contiene exactamente el candidato preloaded', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].sellupAccountId, 'acc-siesa-001');
  });

  it('E2 matchConfidence es 1 (confianza máxima, preseleccionado por el usuario)', () => {
    const state = createInitialContactEnrichmentChatState(accountPreloadedCompany());
    assert.equal(state.selectedCandidate?.matchConfidence, 1);
  });

  it('E3 preloadedCompany de otra cuenta carga el accountId correcto', () => {
    const state = createInitialContactEnrichmentChatState(
      accountPreloadedCompany({
        name: 'Bancolombia',
        sellupAccountId: 'acc-bancolombia-999',
        hubspotCompanyId: 'hs-456',
        countryCode: 'CO',
      }),
    );
    assert.equal(state.selectedCandidate?.sellupAccountId, 'acc-bancolombia-999');
    assert.equal(state.selectedCandidate?.hubspotCompanyId, 'hs-456');
    assert.equal(state.selectedCandidate?.countryCode, 'CO');
  });
});
