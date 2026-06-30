// Tests para evaluateHubSpotConnectionRow — lógica pura de readiness sin Supabase.
// Cubre los escenarios definidos en el hito 17A.4C bug-fix.
//
// Por qué el fix anterior no detectó el bug real:
//   Los tests solo cubrían evaluateHubSpotConnectionRow (pura, sin DB). El bug
//   estaba en la capa de query: getHubSpotContactSyncConnection usaba
//   .eq('integration_key', 'hubspot') sobre external_integration_connections,
//   tabla que NO tiene esa columna (sí la tiene external_integrations). PostgREST
//   devolvía error → data null → connected:false. La lógica pura era correcta;
//   el schema real no fue validado con tests de integración.
//
// Los tests de evaluateHubSpotConnectionRow siguen siendo válidos y se amplían
// con casos que documentan el contrato del schema real de dos pasos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateHubSpotConnectionRow,
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

// ── Test 1: conexión válida completa ─────────────────────────────

test('1. conexión válida → connected=true, canWriteContacts=true', () => {
  const result = evaluateHubSpotConnectionRow(makeRow());
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, true);
});

// ── Test 2: scope_readiness null no bloquea si metadata.scopes tiene los scopes ──

test('2. scope_readiness null en fila no bloquea (se ignora; se usa metadata.scopes)', () => {
  // La columna scope_readiness no está en HubSpotConnectionRow — el evaluador
  // no la usa. Verificamos que una fila sin esa columna pasa correctamente.
  const row = makeRow();
  // @ts-expect-error — simulamos fila con campo extra ignorado
  row.scope_readiness = null;
  const result = evaluateHubSpotConnectionRow(row);
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, true);
});

// ── Test 3: vault_secret_id null bloquea ─────────────────────────

test('3. vault_secret_id null → connected=false', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ vault_secret_id: null }));
  assert.equal(result.connected, false);
  assert.equal(result.canWriteContacts, false);
});

// ── Test 4: falta contacts.write en scopes ───────────────────────

test('4. scopes sin contacts.write → connected=true, canWriteContacts=false', () => {
  const result = evaluateHubSpotConnectionRow(
    makeRow({
      metadata: {
        scopes: ['crm.objects.contacts.read', 'crm.objects.companies.read'],
      },
    }),
  );
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, false);
});

// ── Test 5: connection_status o credentials_status incorrectos ───

test('5a. connection_status != connected → connected=false', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ connection_status: 'disconnected' }));
  assert.equal(result.connected, false);
});

test('5b. connection_status = active (valor no permitido) → connected=false', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ connection_status: 'active' }));
  assert.equal(result.connected, false);
});

test('5c. credentials_status != stored → connected=false', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ credentials_status: 'missing' }));
  assert.equal(result.connected, false);
});

test('5d. credentials_status = valid (valor no permitido) → connected=false', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ credentials_status: 'valid' }));
  assert.equal(result.connected, false);
});

// ── Test 6: row null ─────────────────────────────────────────────

test('6. row null → connected=false (sin confundir con error de vault)', () => {
  const result = evaluateHubSpotConnectionRow(null);
  assert.equal(result.connected, false);
  assert.equal(result.canWriteContacts, false);
});

// ── Test extra: sin scopes declarados → canWriteContacts=true (permisivo) ──

test('7. sin scopes declarados (metadata.scopes vacío) → canWriteContacts=true (best-effort)', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ metadata: { scopes: [] } }));
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, true);
});

test('8. metadata null → canWriteContacts=true (best-effort, sin scopes declarados)', () => {
  const result = evaluateHubSpotConnectionRow(makeRow({ metadata: null }));
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, true);
});

// ── Contrato del schema real (dos pasos) ─────────────────────────
// evaluateHubSpotConnectionRow recibe solo la fila de external_integration_connections.
// getHubSpotContactSyncConnection hace dos queries:
//   1. external_integrations WHERE integration_key='hubspot'  → obtiene id
//   2. external_integration_connections WHERE integration_id=<id> → obtiene fila
// Estos tests documentan que evaluateHubSpotConnectionRow cubre correctamente
// ambos casos de "no hay conexión" que pueden venir del paso 2.

test('9. schema real: integración encontrada pero sin conexión → row null → connected=false', () => {
  // Simula paso 2 que devuelve null (maybeSingle sin match)
  const result = evaluateHubSpotConnectionRow(null);
  assert.equal(result.connected, false);
  assert.equal(result.canWriteContacts, false);
});

test('10. schema real: conexión con vault_secret_id y todos los scopes → connected=true', () => {
  // Fila que vendría del paso 2 con schema correcto
  const row: HubSpotConnectionRow = {
    connection_status: 'connected',
    credentials_status: 'stored',
    vault_secret_id: 'cddab8d9-8786-43d2-99ef-f9a65b0fabde',
    metadata: {
      scopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
        'crm.objects.deals.read',
        'crm.objects.owners.read',
        'crm.schemas.companies.read',
        'oauth',
      ],
    },
  };
  const result = evaluateHubSpotConnectionRow(row);
  assert.equal(result.connected, true);
  assert.equal(result.canWriteContacts, true);
});

test('11. schema real: fila sin integration_key (columna no existe) no afecta evaluación', () => {
  // external_integration_connections no tiene integration_key — el evaluador
  // no la busca, por lo que una fila sin esa propiedad pasa igual.
  const row = makeRow();
  assert.ok(!('integration_key' in row), 'HubSpotConnectionRow no debe incluir integration_key');
  const result = evaluateHubSpotConnectionRow(row);
  assert.equal(result.connected, true);
});
