// Tests para computeHubSpotContactSyncReadiness — lógica pura sin Supabase.
// Cubre los 12 escenarios del hito 17A.4D.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeHubSpotContactSyncReadiness,
  type HubSpotConnectionRow,
} from '../hubspot-contact-sync';

function makeRow(overrides: Partial<HubSpotConnectionRow> = {}): HubSpotConnectionRow {
  return {
    connection_status: 'connected',
    credentials_status: 'stored',
    vault_secret_id: '799e473b-a87c-4780-9903-77aca5541007',
    metadata: {
      scopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
      ],
    },
    ...overrides,
  };
}

// 1. Todo OK → ok true, status ready
test('1. todo OK → ok=true, status=ready', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow());
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ready');
  assert.equal(r.checks.integrationConnected, true);
  assert.equal(r.checks.credentialsStored, true);
  assert.equal(r.checks.vaultSecretLinked, true);
  assert.equal(r.checks.contactsRead, true);
  assert.equal(r.checks.contactsWrite, true);
  assert.equal(r.checks.companiesRead, true);
  assert.equal(r.checks.companiesWrite, true);
  assert.deepEqual(r.missingScopes, []);
});

// 2. Falta integración (row null) → ok false, not_connected
test('2. row null → ok=false, status=not_connected', () => {
  const r = computeHubSpotContactSyncReadiness(null);
  assert.equal(r.ok, false);
  assert.equal(r.status, 'not_connected');
  assert.equal(r.checks.integrationConnected, false);
  assert.equal(r.checks.vaultSecretLinked, false);
});

// 3. connection_status != connected → ok false, not_connected
test('3. connection_status=disconnected → ok=false, status=not_connected', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow({ connection_status: 'disconnected' }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 'not_connected');
});

// 4. connection_status = error → ok false
test('4. connection_status=error → ok=false, status=not_connected', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow({ connection_status: 'error' }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 'not_connected');
});

// 5. credentials_status != stored → missing_credentials
test('5. credentials_status=missing → ok=false, status=missing_credentials', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow({ credentials_status: 'missing' }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 'missing_credentials');
  assert.equal(r.checks.integrationConnected, true);
  assert.equal(r.checks.credentialsStored, false);
});

// 6. vault_secret_id null → missing_vault_secret
test('6. vault_secret_id=null → ok=false, status=missing_vault_secret', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow({ vault_secret_id: null }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 'missing_vault_secret');
  assert.equal(r.checks.integrationConnected, true);
  assert.equal(r.checks.credentialsStored, true);
  assert.equal(r.checks.vaultSecretLinked, false);
});

// 7. Falta contacts.read → missingScopes incluye contacts.read
test('7. falta contacts.read → missingScopes incluye crm.objects.contacts.read', () => {
  const r = computeHubSpotContactSyncReadiness(
    makeRow({
      metadata: {
        scopes: [
          'crm.objects.contacts.write',
          'crm.objects.companies.read',
          'crm.objects.companies.write',
        ],
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 'missing_scopes');
  assert.equal(r.checks.contactsRead, false);
  assert.equal(r.checks.contactsWrite, true);
  assert.ok(r.missingScopes.includes('crm.objects.contacts.read'));
});

// 8. Falta contacts.write → missingScopes incluye contacts.write
test('8. falta contacts.write → missingScopes incluye crm.objects.contacts.write', () => {
  const r = computeHubSpotContactSyncReadiness(
    makeRow({
      metadata: {
        scopes: [
          'crm.objects.contacts.read',
          'crm.objects.companies.read',
          'crm.objects.companies.write',
        ],
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.checks.contactsWrite, false);
  assert.ok(r.missingScopes.includes('crm.objects.contacts.write'));
});

// 9. Falta companies.read → missingScopes incluye companies.read
test('9. falta companies.read → missingScopes incluye crm.objects.companies.read', () => {
  const r = computeHubSpotContactSyncReadiness(
    makeRow({
      metadata: {
        scopes: [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.companies.write',
        ],
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.checks.companiesRead, false);
  assert.ok(r.missingScopes.includes('crm.objects.companies.read'));
});

// 10. Falta companies.write → missingScopes incluye companies.write
test('10. falta companies.write → missingScopes incluye crm.objects.companies.write', () => {
  const r = computeHubSpotContactSyncReadiness(
    makeRow({
      metadata: {
        scopes: [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.companies.read',
        ],
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.checks.companiesWrite, false);
  assert.ok(r.missingScopes.includes('crm.objects.companies.write'));
});

// 11. scope_readiness=null en fila no bloquea (campo no existe en HubSpotConnectionRow)
test('11. campo scope_readiness ignorado (no existe en el tipo)', () => {
  const row = makeRow();
  // @ts-expect-error — simulamos campo extra de DB no mapeado
  row.scope_readiness = null;
  const r = computeHubSpotContactSyncReadiness(row);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ready');
});

// 12. No expone tokens ni metadata sensible (resultado solo tiene checks booleanos y scope names)
test('12. resultado no contiene tokens ni metadata sensible', () => {
  const r = computeHubSpotContactSyncReadiness(makeRow());
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes('vault_secret_id'), 'No debe exponer vault_secret_id');
  assert.ok(!serialized.includes('799e473b'), 'No debe exponer el valor del secreto');
  assert.ok(!serialized.includes('hub_id'), 'No debe exponer hub_id');
});
