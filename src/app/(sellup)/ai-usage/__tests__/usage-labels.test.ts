// Nombres legibles de /ai-usage: cada agent_key y provider_key que el código
// escribe tiene que leerse en español, no como la clave cruda.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentLabel, providerLabel } from '../usage-labels';
import { UNATTRIBUTED_AGENT_KEY } from '@/modules/ai-usage/usage-aggregators';

describe('agentLabel', () => {
  it('conoce los agentes que crean ejecuciones hoy', () => {
    assert.equal(agentLabel('prospect_generation'), 'Generación de prospectos');
    assert.equal(agentLabel('candidate_enrichment'), 'Enriquecimiento de candidatos');
    assert.equal(agentLabel('agent_2a_contact_enrichment'), 'Enriquecimiento de contactos');
  });

  it('nombra la cubeta de consultas sin ejecución', () => {
    assert.equal(agentLabel(UNATTRIBUTED_AGENT_KEY), 'Sin agente asignado');
  });

  it('sin traducción usa el nombre guardado y, si no hay, la clave', () => {
    assert.equal(agentLabel('otro', 'Otro agente'), 'Otro agente');
    assert.equal(agentLabel('otro'), 'otro');
  });
});

describe('providerLabel', () => {
  it('conoce los proveedores que escriben consumo', () => {
    assert.equal(providerLabel('apollo'), 'Apollo');
    assert.equal(providerLabel('apollo_organizations'), 'Apollo');
    assert.equal(providerLabel('lusha'), 'Lusha');
    assert.equal(providerLabel('tavily'), 'Tavily');
    assert.equal(providerLabel('anthropic'), 'Anthropic (Claude)');
    assert.equal(providerLabel('claude'), 'Anthropic (Claude)');
    assert.equal(providerLabel('google'), 'Google (Gemini)');
    assert.equal(providerLabel('gemini'), 'Google (Gemini)');
    assert.equal(providerLabel('hubspot'), 'HubSpot');
  });
});
