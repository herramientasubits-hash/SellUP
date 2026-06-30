// Tests para evaluateHubSpotConnectionRow — lógica pura de readiness sin Supabase.
// Cubre los escenarios definidos en el hito 17A.4C bug-fix.

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
