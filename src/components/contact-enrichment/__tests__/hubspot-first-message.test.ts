import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomaticRoutingMessage } from '../contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiResult } from '../contact-enrichment-chat-types';

function result(over: Partial<AutomaticRoutingUiResult>): AutomaticRoutingUiResult {
  return {
    success: true, status: 'no_fallback_needed', automaticRoutingEnabled: true, fallbackExecuted: false,
    attempt1AttemptId: 'a1', attempt2AttemptId: null, blockedReason: null, reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: null, lusha: null }, failedProviders: [], ...over,
  };
}

describe('Primero HubSpot — mensaje del chat', () => {
  it('HubSpot bastó: lo dice y avisa que no se gastaron proveedores', () => {
    const { content, tone } = buildAutomaticRoutingMessage(
      result({ status: 'hubspot_first_satisfied', hubspotFirstCandidates: 3, hubspotFirstSatisfied: true }),
    );
    assert.match(content, /3 contactos de HubSpot/);
    assert.match(content, /no gasté Apollo ni Lusha/);
    assert.equal(tone, undefined);
  });

  it('HubSpot + proveedor: suma ambos e indica cuántos ya estaban en HubSpot', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ hubspotFirstCandidates: 1, providerCandidatesCreated: { apollo: 2, lusha: null } }),
    );
    assert.match(content, /3 contactos para revisar \(1 ya estaban en HubSpot\)/);
  });

  it('sin HubSpot el mensaje es el de siempre', () => {
    assert.match(
      buildAutomaticRoutingMessage(result({ providerCandidatesCreated: { apollo: 2, lusha: null } })).content,
      /^Encontré 2 contactos para revisar\./,
    );
  });
});
