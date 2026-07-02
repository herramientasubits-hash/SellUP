/**
 * Tests — HubSpot Snapshot Readiness (Hito 17A.9D.1)
 *
 * Verifica evaluateHubSpotSnapshotReadiness sin Supabase real ni HubSpot real.
 * Función pura — solo lógica de lectura (contacts.read + companies.read).
 *
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateHubSpotSnapshotReadiness,
  type HubSpotConnectionRow,
} from '../hubspot-contacts-reader';

// ── Fixtures ──────────────────────────────────────────────────

const FULL_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.companies.read',
  'oauth',
];

function makeRow(overrides: Partial<HubSpotConnectionRow> = {}): HubSpotConnectionRow {
  return {
    connection_status: 'connected',
    credentials_status: 'stored',
    vault_secret_id: 'vault-uuid-1234',
    metadata: { scopes: FULL_SCOPES },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('evaluateHubSpotSnapshotReadiness', () => {

  it('1. conexión válida con todos los scopes → canRead=true', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow());
    assert.equal(result.canRead, true);
    assert.equal(result.skipReason, undefined);
    assert.ok(result.scopes.includes('crm.objects.contacts.read'));
  });

  it('2. conexión válida sin scopes declarados → canRead=true (best-effort)', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ metadata: null }));
    assert.equal(result.canRead, true);
    assert.equal(result.skipReason, undefined);
    assert.deepEqual(result.scopes, []);
  });

  it('3. row null → not_connected', () => {
    const result = evaluateHubSpotSnapshotReadiness(null);
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'not_connected');
  });

  it('4. connection_status = disconnected → not_connected', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ connection_status: 'disconnected' }));
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'not_connected');
  });

  it('5. connection_status = error → not_connected', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ connection_status: 'error' }));
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'not_connected');
  });

  it('6. connection_status = not_tested → not_connected', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ connection_status: 'not_tested' }));
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'not_connected');
  });

  it('7. credentials_status = missing → credentials_not_stored', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ credentials_status: 'missing' }));
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'credentials_not_stored');
  });

  it('8. vault_secret_id = null → no_vault_secret', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ vault_secret_id: null }));
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'no_vault_secret');
  });

  it('9. scopes presentes pero falta contacts.read → missing_contacts_read_scope', () => {
    const scopesSinContactsRead = FULL_SCOPES.filter(
      (s) => s !== 'crm.objects.contacts.read'
    );
    const result = evaluateHubSpotSnapshotReadiness(
      makeRow({ metadata: { scopes: scopesSinContactsRead } })
    );
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'missing_contacts_read_scope');
    assert.ok(result.scopes.includes('crm.objects.companies.read'));
  });

  it('10. scopes presentes pero falta companies.read → missing_companies_read_scope', () => {
    const scopesSinCompaniesRead = FULL_SCOPES.filter(
      (s) => s !== 'crm.objects.companies.read'
    );
    const result = evaluateHubSpotSnapshotReadiness(
      makeRow({ metadata: { scopes: scopesSinCompaniesRead } })
    );
    assert.equal(result.canRead, false);
    assert.equal(result.skipReason, 'missing_companies_read_scope');
    assert.ok(result.scopes.includes('crm.objects.contacts.read'));
  });

  it('11. scopes vacíos (array vacío) → canRead=true (best-effort)', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow({ metadata: { scopes: [] } }));
    assert.equal(result.canRead, true);
    assert.equal(result.skipReason, undefined);
    assert.deepEqual(result.scopes, []);
  });

  it('12. no expone vault_secret_id ni tokens en el resultado', () => {
    const result = evaluateHubSpotSnapshotReadiness(makeRow());
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('vault-uuid-1234'), 'vault_secret_id no debe aparecer en el resultado');
    assert.ok(!resultStr.includes('Bearer'), 'no debe haber tokens en el resultado');
  });

});
