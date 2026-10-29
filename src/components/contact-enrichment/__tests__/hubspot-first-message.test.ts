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
    assert.match(content, /3 contactos para revisar \(1 ya estaba en HubSpot y 2 nuevos de Apollo\)/);
  });

  it('banco de contactos bastó: lo dice y avisa que no se gastaron proveedores', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ status: 'contact_bank_satisfied', contactBankCandidates: 3, contactBankSatisfied: true }),
    );
    assert.match(content, /^Encontré 3 contactos para revisar que SellUp ya conocía de esta empresa, así que no gasté Apollo ni Lusha\./);
  });

  it('HubSpot + banco bastaron juntos: nombra las dos fuentes', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ hubspotFirstCandidates: 2, contactBankCandidates: 1, contactBankSatisfied: true }),
    );
    assert.match(content, /3 contactos para revisar de HubSpot y de lo que SellUp ya conocía de esta empresa/);
  });

  it('banco + proveedor: suma y dice cuántos ya los conocía SellUp', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ contactBankCandidates: 2, providerCandidatesCreated: { apollo: 1, lusha: null } }),
    );
    assert.match(content, /3 contactos para revisar \(2 ya los conocía SellUp de esta empresa y 1 nuevo de Apollo\)/);
  });

  it('personas del sitio web: las suma y avisa que vienen sin correo', () => {
    const { content } = buildAutomaticRoutingMessage(
      result({ companySiteCandidates: 2, providerCandidatesCreated: { apollo: 0, lusha: 0 } }),
    );
    assert.match(content, /^Encontré 2 contactos para revisar \(2 del sitio web de la empresa, sin correo\)\./);
  });

  it('sin HubSpot el mensaje es el de siempre', () => {
    assert.match(
      buildAutomaticRoutingMessage(result({ providerCandidatesCreated: { apollo: 2, lusha: null } })).content,
      /^Encontré 2 contactos para revisar\./,
    );
  });
});
