import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHubSpotCompanyResolution } from '../hubspot-company-resolution-core';

describe('classifyHubSpotCompanyResolution — tres desenlaces, sin la exigencia de NIT de prospección', () => {
  it('no_match → crear', () => {
    const result = classifyHubSpotCompanyResolution({ hubspotMatchStatus: 'no_match' });
    assert.equal(result.action, 'create');
  });

  it('coincidencia confiable con cliente → bloquear en silencio, igual que prospectos', () => {
    const result = classifyHubSpotCompanyResolution({
      hubspotMatchStatus: 'exact_match_customer',
    });
    assert.equal(result.action, 'block_silent');
  });

  for (const status of [
    'exact_match_ex_customer',
    'exact_match_prospect_active',
    'exact_match_prospect_recyclable',
  ] as const) {
    it(`${status} → bloquear en silencio`, () => {
      assert.equal(
        classifyHubSpotCompanyResolution({ hubspotMatchStatus: status }).action,
        'block_silent',
      );
    });
  }

  it('possible_match_requires_review → pausar para revisión humana', () => {
    const result = classifyHubSpotCompanyResolution({
      hubspotMatchStatus: 'possible_match_requires_review',
    });
    assert.equal(result.action, 'pending_review');
  });

  it('not_attempted (sin conexión) → bloquear en silencio, nunca crear a ciegas', () => {
    assert.equal(
      classifyHubSpotCompanyResolution({ hubspotMatchStatus: 'not_attempted' }).action,
      'block_silent',
    );
  });

  it('hubspot_lookup_failed (búsqueda falló) → bloquear en silencio, nunca crear a ciegas', () => {
    assert.equal(
      classifyHubSpotCompanyResolution({ hubspotMatchStatus: 'hubspot_lookup_failed' }).action,
      'block_silent',
    );
  });
});
