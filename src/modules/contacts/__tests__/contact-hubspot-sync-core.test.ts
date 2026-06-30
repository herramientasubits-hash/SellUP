// Tests del core puro de sincronización contacto → HubSpot (Hito 17A.4C).
// Sin red, sin DB, sin auth: todo se inyecta vía deps. NO llama Apollo, NO toca
// candidatos, NO sincroniza al aprobar (esto es una acción manual aparte).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSyncContactToHubSpot,
  buildHubSpotContactProperties,
  splitContactName,
  buildSyncMetadata,
  sanitizeEmail,
  type ContactForSync,
  type AccountForSync,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';

// ── Fixtures ────────────────────────────────────────────────────

function makeContact(overrides: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: 'ana@empresa.com',
    phone: '+57 1 555 0000',
    mobile_phone: '+57 300 555 0000',
    job_title: 'Gerente de RRHH',
    linkedin_url: 'https://linkedin.com/in/anaperez',
    hubspot_contact_id: null,
    metadata: { source: 'contact_enrichment_candidate' },
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountForSync> = {}): AccountForSync {
  return {
    id: 'account-1',
    name: 'Empresa S.A.',
    hubspot_company_id: 'hs-company-99',
    ...overrides,
  };
}

interface SpyState {
  apolloCalls: number;
  candidateTouches: number;
  createdContacts: number;
  associations: Array<{ contactId: string; companyId: string }>;
  persisted: Array<{ contactId: string; patch: unknown }>;
  audits: number;
}

function makeDeps(
  overrides: Partial<SyncContactDeps> = {},
  spy?: SpyState,
): SyncContactDeps {
  const s = spy ?? {
    apolloCalls: 0,
    candidateTouches: 0,
    createdContacts: 0,
    associations: [],
    persisted: [],
    audits: 0,
  };
  return {
    actorId: 'user-1',
    nowIso: '2026-06-29T12:00:00.000Z',
    loadContact: async () => makeContact(),
    loadAccount: async () => makeAccount(),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => null,
    createHubSpotContact: async () => {
      s.createdContacts += 1;
      return { id: 'hs-contact-new' };
    },
    associateContactWithCompany: async (contactId, companyId) => {
      s.associations.push({ contactId, companyId });
      return { ok: true };
    },
    persistSync: async (contactId, patch) => {
      s.persisted.push({ contactId, patch });
      return {};
    },
    logAudit: async () => {
      s.audits += 1;
    },
    ...overrides,
  };
}

function freshSpy(): SpyState {
  return {
    apolloCalls: 0,
    candidateTouches: 0,
    createdContacts: 0,
    associations: [],
    persisted: [],
    audits: 0,
  };
}

// ── Helpers puros ───────────────────────────────────────────────

test('sanitizeEmail normaliza y rechaza inválidos', () => {
  assert.equal(sanitizeEmail('  Ana@Empresa.COM '), 'ana@empresa.com');
  assert.equal(sanitizeEmail('no-es-email'), null);
  assert.equal(sanitizeEmail(null), null);
});

test('splitContactName usa campos explícitos y cae a full_name', () => {
  assert.deepEqual(splitContactName(makeContact()), {
    firstname: 'Ana María',
    lastname: 'Pérez',
  });
  assert.deepEqual(
    splitContactName(makeContact({ first_name: null, last_name: null, full_name: 'Juan Gómez Díaz' })),
    { firstname: 'Juan', lastname: 'Gómez Díaz' },
  );
  assert.deepEqual(
    splitContactName(makeContact({ first_name: null, last_name: null, full_name: 'Cher' })),
    { firstname: 'Cher', lastname: null },
  );
});

test('buildHubSpotContactProperties omite LinkedIn y prioriza mobile_phone', () => {
  const props = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com');
  assert.equal(props.email, 'ana@empresa.com');
  assert.equal(props.jobtitle, 'Gerente de RRHH');
  assert.equal(props.phone, '+57 300 555 0000');
  // LinkedIn no debe viajar a HubSpot en este hito.
  assert.ok(!('linkedin_url' in props));
  assert.ok(!('hs_linkedin_url' in props));
});

test('buildSyncMetadata preserva metadata previa y agrega hubspot_sync', () => {
  const meta = buildSyncMetadata({
    existing: { source: 'x', keep: true },
    hubspotContactId: 'hs-1',
    mode: 'created',
    hubspotCompanyId: 'hs-company-99',
    companyAssociation: 'associated',
    actorId: 'user-1',
    nowIso: '2026-06-29T12:00:00.000Z',
  });
  assert.equal(meta.keep, true);
  assert.equal(meta.source, 'x');
  const sync = meta.hubspot_sync as Record<string, unknown>;
  assert.equal(sync.status, 'synced');
  assert.equal(sync.mode, 'created');
  assert.equal(sync.hubspot_contact_id, 'hs-1');
  assert.equal(sync.hubspot_company_id, 'hs-company-99');
  assert.equal(sync.company_association, 'associated');
  assert.equal(sync.synced_by, 'user-1');
});

// ── Validaciones / errores ──────────────────────────────────────

test('1. falla si el contacto no existe', async () => {
  const res = await runSyncContactToHubSpot('contact-1', makeDeps({ loadContact: async () => null }));
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'CONTACT_NOT_FOUND');
});

test('1b. falla si contactId es vacío', async () => {
  const res = await runSyncContactToHubSpot('   ', makeDeps());
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'CONTACT_NOT_FOUND');
});

test('2. falla si el contacto no tiene email', async () => {
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ loadContact: async () => makeContact({ email: null }) }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'MISSING_EMAIL');
});

test('3. falla si el contacto no tiene account_id', async () => {
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ loadContact: async () => makeContact({ account_id: null }) }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'MISSING_ACCOUNT');
});

test('4. falla si la cuenta no tiene hubspot_company_id', async () => {
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ loadAccount: async () => makeAccount({ hubspot_company_id: null }) }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'MISSING_HUBSPOT_COMPANY');
});

test('5. si el contacto ya tiene hubspot_contact_id → already_synced sin escribir', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ loadContact: async () => makeContact({ hubspot_contact_id: 'hs-existing' }) }, spy),

  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, 'already_synced');
  assert.equal(res.ok === true && res.hubspotContactId, 'hs-existing');
  // No debe crear, asociar ni persistir nada.
  assert.equal(spy.createdContacts, 0);
  assert.equal(spy.associations.length, 0);
  assert.equal(spy.persisted.length, 0);
});

test('6. falla claro si HubSpot no está conectado', async () => {
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ checkConnection: async () => ({ connected: false, canWriteContacts: false }) }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'HUBSPOT_NOT_CONNECTED');
});

test('6b. falla si falta scope de escritura de contactos', async () => {
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ checkConnection: async () => ({ connected: true, canWriteContacts: false }) }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'HUBSPOT_SCOPE_MISSING');
});

// ── Vincular existente vs crear ─────────────────────────────────

test('7. si existe contacto HubSpot por email → vincula, no crea duplicado', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ findHubSpotContactByEmail: async () => ({ id: 'hs-existing-42' }) }, spy),
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, 'linked_existing');
  assert.equal(res.ok === true && res.hubspotContactId, 'hs-existing-42');
  assert.equal(spy.createdContacts, 0); // no duplica
});

test('8. si no existe contacto HubSpot → crea contacto', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, 'created');
  assert.equal(res.ok === true && res.hubspotContactId, 'hs-contact-new');
  assert.equal(spy.createdContacts, 1);
});

test('9. tras crear/vincular guarda hubspot_contact_id local', async () => {
  const spy = freshSpy();
  await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  assert.equal(spy.persisted.length, 1);
  const patch = spy.persisted[0].patch as { hubspot_contact_id: string };
  assert.equal(patch.hubspot_contact_id, 'hs-contact-new');
});

test('10. guarda metadata hubspot_sync', async () => {
  const spy = freshSpy();
  await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  const patch = spy.persisted[0].patch as { metadata: Record<string, unknown> };
  const sync = patch.metadata.hubspot_sync as Record<string, unknown>;
  assert.equal(sync.status, 'synced');
  assert.equal(sync.mode, 'created');
  assert.equal(sync.hubspot_company_id, 'hs-company-99');
  // Preserva metadata previa del contacto.
  assert.equal(patch.metadata.source, 'contact_enrichment_candidate');
});

test('11. asocia el contacto con la company HubSpot', async () => {
  const spy = freshSpy();
  await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  assert.equal(spy.associations.length, 1);
  assert.deepEqual(spy.associations[0], {
    contactId: 'hs-contact-new',
    companyId: 'hs-company-99',
  });
});

test('11b. fallo de asociación no invalida el vínculo (queda registrado)', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ associateContactWithCompany: async () => ({ error: 'assoc 403' }) }, spy),
  );
  assert.equal(res.ok, true);
  const patch = spy.persisted[0].patch as { metadata: Record<string, unknown> };
  const sync = patch.metadata.hubspot_sync as Record<string, unknown>;
  assert.equal(sync.company_association, 'failed');
});

test('12. si falla la creación en HubSpot → no marca como synced (no persiste)', async () => {
  const spy = freshSpy();
  const res = await runSyncContactToHubSpot(
    'contact-1',
    makeDeps({ createHubSpotContact: async () => ({ error: 'HTTP 500' }) }, spy),
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.errorCode, 'HUBSPOT_ERROR');
  assert.equal(spy.persisted.length, 0);
  assert.equal(spy.associations.length, 0);
});

// ── Garantías de aislamiento del hito ───────────────────────────

test('13–15. no llama Apollo, no toca candidatos, no cambia status de candidato', async () => {
  // Las deps del core NO exponen Apollo ni candidatos: el aislamiento es estructural.
  const deps = makeDeps();
  assert.equal('runApolloEnrichment' in deps, false);
  assert.equal('updateCandidate' in deps, false);
  assert.equal('loadCandidate' in deps, false);
  // Y una corrida normal no invoca ninguna dep fuera del contrato declarado.
  const res = await runSyncContactToHubSpot('contact-1', deps);
  assert.equal(res.ok, true);
});

test('16. no crea un contacto local nuevo (solo actualiza el existente)', async () => {
  const spy = freshSpy();
  await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  // persistSync actualiza por contactId existente; no hay insertContact en las deps.
  assert.equal(spy.persisted[0].contactId, 'contact-1');
});

test('persiste solo tras éxito; audita una vez', async () => {
  const spy = freshSpy();
  await runSyncContactToHubSpot('contact-1', makeDeps({}, spy));
  assert.equal(spy.audits, 1);
});
