// HUBSPOT-ENRICHMENT-REQUEST-1 — resguardo: «Enriquecer empresa de HubSpot» no escribe en HubSpot.
// El Agente 1 tiene 0 escrituras en HubSpot; el completado de país/industria sí escribe por
// defecto, así que este flujo debe pedirle `writeHubSpot: false` y no tocar los escritores.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FILES = ['hubspot-enrichment-request.ts', 'hubspot-enrichment-request.server.ts', 'hubspot-enrichment-request-actions.ts'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const HUBSPOT_WRITERS = [
  'hubspot-company-update',
  'hubspot-company-create',
  'hubspot-contact-sync',
  'updateHubSpotCompanyProperties',
  'createHubSpotCompany',
  "method: 'PATCH'",
  "method: 'POST'",
  'scheduleAccountProfileCompletion',
];

describe('enriquecer empresa de HubSpot — 0 escrituras en HubSpot', () => {
  for (const file of FILES) {
    it(`${file} no usa escritores de HubSpot`, () => {
      const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
      for (const writer of HUBSPOT_WRITERS) {
        assert.equal(code.includes(writer), false, `${file} contiene ${writer}`);
      }
    });
  }

  it('el completado de país/industria se llama con writeHubSpot: false', () => {
    const code = stripComments(readFileSync(join(ROOT, 'hubspot-enrichment-request.server.ts'), 'utf8'));
    const call = code.slice(code.indexOf('deps.completeProfile('));
    assert.ok(call.length > 0, 'no se encontró la llamada al completado');
    assert.match(call.slice(0, call.indexOf('}),') + 3), /writeHubSpot:\s*false/);
  });

  it('el completado respeta writeHubSpot: false antes de escribir en HubSpot', () => {
    const code = stripComments(readFileSync(join(ROOT, 'account-profile-completion.server.ts'), 'utf8'));
    const guard = code.indexOf("input.writeHubSpot === false");
    const write = code.indexOf('await writeBackToHubSpot(');
    assert.ok(guard > 0 && write > guard, 'la guarda debe ir antes de escribir en HubSpot');
  });
});
