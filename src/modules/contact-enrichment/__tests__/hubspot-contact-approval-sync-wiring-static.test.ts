/**
 * AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC — cableado real de `triggerContactHubSpotSync`.
 *
 * Cuando el hook de aprobación (Task E2) dejó de construir estas dependencias inline y pasó a
 * delegar en este archivo (Task E1), las pruebas que verificaban esta forma exacta —re-leer la
 * fila en vez de confiar en el payload recién insertado, marcar el intento como `auto`, y hacer
 * que esa marca llegue también a la auditoría— vivían apuntando al archivo equivocado. Esta
 * suite las reubica sobre el archivo real donde esa lógica vive ahora.
 *
 * Estática y pura: se lee el código fuente, sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

const WIRING_CODE = stripComments(read('src/modules/contact-enrichment/hubspot-contact-approval-sync.ts'));

describe('triggerContactHubSpotSync — el contacto se RELEE de la fila', () => {
  it('loadSubject no confía en el payload insertado: vuelve a leer contacts', () => {
    assert.match(WIRING_CODE, /loadSubject:[\s\S]{0,400}from\('contacts'\)/);
    assert.match(WIRING_CODE, /select\('id, hubspot_contact_id, metadata'\)/);
    assert.match(WIRING_CODE, /\.is\('archived_at', null\)/);
  });
});

describe('triggerContactHubSpotSync — no reimplementa el motor, lo cablea con method: auto', () => {
  it("buildContactHubSpotSyncDeps se llama con method: 'auto'", () => {
    assert.match(WIRING_CODE, /buildContactHubSpotSyncDeps\(\{[\s\S]{0,200}method: 'auto'/);
  });

  it('no reimplementa HubSpot directamente', () => {
    for (const forbidden of ['findHubSpotContactByEmail(', 'createHubSpotContact(', 'fetch(']) {
      assert.equal(
        WIRING_CODE.includes(forbidden),
        false,
        `${forbidden} sería una segunda implementación de HubSpot`,
      );
    }
  });
});

describe('triggerContactHubSpotSync — el método automático viaja también a la auditoría', () => {
  it("logAudit escribe method: 'auto' dentro de details.hubspot_sync", () => {
    const auditAt = WIRING_CODE.indexOf('logAudit:');
    assert.ok(auditAt > 0, 'falta el callback logAudit');
    const auditBlock = WIRING_CODE.slice(auditAt, auditAt + 800);
    assert.match(auditBlock, /hubspot_sync:[\s\S]{0,300}method: 'auto'/);
  });
});
