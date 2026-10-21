// AGENT2-AUDIT-FIXES-1 — el chat explica por qué una búsqueda quedó en cero.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomaticRoutingMessage, explainZeroResult } from '../contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiDiagnosis, AutomaticRoutingUiResult } from '../contact-enrichment-chat-types';

const diag = (over: Partial<AutomaticRoutingUiDiagnosis>): AutomaticRoutingUiDiagnosis => ({
  apolloSkipped: false,
  apolloOrganization: 'found_by_domain',
  apolloPeopleFound: 0,
  apolloRejected: 0,
  apolloAlreadyKnown: 0,
  freeStages: { hubspotFirst: 'disabled', contactBank: 'disabled', companySite: 'disabled' },
  lushaRecentZeroAt: null,
  lushaRan: false,
  ...over,
});

const zeroResult = (diagnosis?: AutomaticRoutingUiDiagnosis): AutomaticRoutingUiResult => ({
  success: true,
  status: 'fallback_executed',
  automaticRoutingEnabled: true,
  fallbackExecuted: true,
  attempt1AttemptId: 'a1',
  attempt2AttemptId: null,
  blockedReason: null,
  reusedExistingCandidates: 0,
  providerCandidatesCreated: { apollo: 0, lusha: 0 },
  failedProviders: [],
  diagnosis,
});

describe('explainZeroResult', () => {
  it('sin diagnóstico no agrega nada (mensaje de siempre)', () => {
    assert.equal(explainZeroResult(undefined), '');
    assert.equal(buildAutomaticRoutingMessage(zeroResult()).content, 'No se encontraron contactos.');
  });

  it('Apollo no se llamó: pide el dominio', () => {
    const text = explainZeroResult(diag({ apolloSkipped: true, apolloPeopleFound: null }));
    assert.match(text, /Faltan el dominio y el nombre/);
    assert.match(text, /Agrega el dominio/);
  });

  it('empresa no encontrada en Apollo: revisar el dominio', () => {
    const text = explainZeroResult(diag({ apolloOrganization: 'not_found' }));
    assert.match(text, /no reconoce esta empresa/);
    assert.match(text, /Revisa que el dominio/);
  });

  it('empresa encontrada sólo por nombre y sin personas: sugiere corregir el dominio', () => {
    const text = explainZeroResult(diag({ apolloOrganization: 'found_by_name' }));
    assert.match(text, /sólo encontró la empresa por el nombre/);
    assert.match(text, /corrígelo/);
  });

  it('Apollo trajo gente pero nadie sirvió, con conocidos', () => {
    const text = explainZeroResult(diag({ apolloPeopleFound: 10, apolloRejected: 7, apolloAlreadyKnown: 3 }));
    assert.match(text, /Apollo trajo 10 personas: 3 ya eran contactos/);
  });

  it('sitio y Lusha: explica cada uno', () => {
    const text = explainZeroResult(
      diag({
        freeStages: { hubspotFirst: 'disabled', contactBank: 'disabled', companySite: 'site_no_text' },
        lushaRecentZeroAt: '2026-10-14T12:00:00.000Z',
      }),
    );
    assert.match(text, /sólo con JavaScript/);
    assert.match(text, /No volví a gastar Lusha: el 14 de octubre/);
    assert.match(explainZeroResult(diag({ lushaRan: true })), /Lusha tampoco encontró/);
  });

  it('el mensaje final conserva el inicio y el tono de advertencia', () => {
    const message = buildAutomaticRoutingMessage(zeroResult(diag({ apolloOrganization: 'not_found' })));
    assert.equal(message.tone, 'warning');
    assert.match(message.content, /^No se encontraron contactos\.\n\nApollo no reconoce/);
  });
});
