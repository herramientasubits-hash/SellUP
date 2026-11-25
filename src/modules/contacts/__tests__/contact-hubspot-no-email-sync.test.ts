// Dueña 25-11 — contactos aprobados SIN correo hacia HubSpot. HubSpot no exige correo, pero sin
// él no deduplica: SellUp busca a la persona por LinkedIn y por nombre en su empresa antes de
// crear, y no crea si hay varias con ese nombre.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canSyncWithoutEmail,
  decideHubSpotContactWithoutEmail,
  linkedinProfileKey,
  linkedinUrlVariants,
  type HubSpotIdentityCandidate,
} from '../contact-hubspot-no-email-identity-core';
import {
  runSyncContactToHubSpot,
  SYNC_MESSAGES,
  type ContactForSync,
  type HubSpotContactCreateInput,
  type SyncContactDeps,
} from '../contact-hubspot-sync-core';
import { readHubSpotSyncState } from '../contact-hubspot-sync-state';
import { buildHubSpotContactCreateBody } from '@/server/integrations/hubspot-contact-sync';

const candidate = (over: Partial<HubSpotIdentityCandidate> = {}): HubSpotIdentityCandidate => ({
  id: 'hs-1',
  firstname: 'Ana María',
  lastname: 'Pérez',
  email: null,
  linkedinUrl: null,
  ...over,
});

describe('identidad sin correo (puro)', () => {
  it('el perfil de LinkedIn se compara sin www, barra final, mayúsculas ni codificación', () => {
    assert.equal(linkedinProfileKey('https://www.linkedin.com/in/AnaPerez/'), 'anaperez');
    assert.equal(linkedinProfileKey('linkedin.com/in/herrerani%C3%B1o'), 'herreraniño');
    assert.equal(linkedinProfileKey('https://www.linkedin.com/company/sportium'), null);
    assert.equal(canSyncWithoutEmail({ firstname: 'Ana', lastname: null, linkedinUrl: null }), false);
    assert.equal(canSyncWithoutEmail({ firstname: null, lastname: null, linkedinUrl: 'linkedin.com/in/ana' }), true);
  });

  it('el mismo LinkedIn es la misma persona', () => {
    const d = decideHubSpotContactWithoutEmail(
      [candidate({ id: 'x', firstname: 'Otro', linkedinUrl: 'https://linkedin.com/in/anaperez' })],
      { firstname: 'Ana María', lastname: 'Pérez', linkedinUrl: 'https://www.linkedin.com/in/AnaPerez/' },
    );
    assert.deepEqual(d, { kind: 'match', id: 'x', by: 'linkedin' });
  });

  it('una sola persona con el mismo nombre (sin tildes) en la empresa ⇒ se vincula', () => {
    const d = decideHubSpotContactWithoutEmail(
      [candidate({ firstname: 'ana maria', lastname: 'perez' }), candidate({ id: 'hs-2', firstname: 'Luis', lastname: 'Gómez' })],
      { firstname: 'Ana María', lastname: 'Pérez', linkedinUrl: 'https://linkedin.com/in/anaperez' },
    );
    assert.deepEqual(d, { kind: 'match', id: 'hs-1', by: 'name' });
  });

  it('varias con el mismo nombre ⇒ ambiguo; con otro LinkedIn no cuenta', () => {
    const identity = { firstname: 'Ana María', lastname: 'Pérez', linkedinUrl: 'https://linkedin.com/in/anaperez' };
    assert.deepEqual(decideHubSpotContactWithoutEmail([candidate(), candidate({ id: 'hs-2' })], identity), {
      kind: 'ambiguous',
      count: 2,
    });
    assert.deepEqual(
      decideHubSpotContactWithoutEmail([candidate({ linkedinUrl: 'https://linkedin.com/in/otra-ana' })], identity),
      { kind: 'none' },
    );
  });

  it('variantes del LinkedIn para buscar por igualdad (máximo 5)', () => {
    const variants = linkedinUrlVariants('https://www.linkedin.com/in/anaperez/');
    assert.ok(variants.includes('https://www.linkedin.com/in/anaperez'));
    assert.ok(variants.length <= 5);
    assert.deepEqual(linkedinUrlVariants(null), []);
  });

  it('el alta sin correo no manda la clave `email` (vacía la BORRARÍA)', () => {
    const body = buildHubSpotContactCreateBody(
      { email: null, firstname: 'Ana', lastname: 'Pérez', jobtitle: null, phone: null, mobilePhone: null, linkedinUrl: 'https://linkedin.com/in/ana' },
      false,
    );
    assert.equal('email' in body, false);
    assert.equal(body.hs_linkedin_url, 'https://linkedin.com/in/ana');
  });
});

function contactWithoutEmail(over: Partial<ContactForSync> = {}): ContactForSync {
  return {
    id: 'contact-1',
    account_id: 'account-1',
    full_name: 'Ana María Pérez',
    first_name: 'Ana María',
    last_name: 'Pérez',
    email: null,
    phone: '+57 300 555 0000',
    mobile_phone: null,
    job_title: 'Gerente de Talento',
    linkedin_url: 'https://www.linkedin.com/in/anaperez',
    hubspot_contact_id: null,
    metadata: {},
    ...over,
  };
}

function deps(over: Partial<SyncContactDeps> & { contact?: ContactForSync } = {}) {
  const spy = { created: [] as HubSpotContactCreateInput[], persisted: [] as Array<Record<string, unknown>>, identityCalls: 0 };
  const d: SyncContactDeps = {
    actorId: 'user-1',
    nowIso: '2026-11-25T12:00:00.000Z',
    method: 'auto',
    loadContact: async () => over.contact ?? contactWithoutEmail(),
    loadAccount: async () => ({ id: 'account-1', name: 'Sportium', hubspot_company_id: 'hs-company-9' }),
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactByEmail: async () => assert.fail('sin correo no se busca por correo'),
    findHubSpotContactsForIdentity: async () => {
      spy.identityCalls += 1;
      return [];
    },
    createHubSpotContact: async (input) => {
      spy.created.push(input);
      return { id: 'hs-new' };
    },
    updateHubSpotContact: async () => assert.fail('no hay PATCH'),
    associateContactWithCompany: async () => ({ ok: true }),
    persistSync: async (_id, patch) => {
      spy.persisted.push(patch as unknown as Record<string, unknown>);
      return {};
    },
    ...over,
  };
  return { d, spy };
}

describe('motor: contacto aprobado sin correo', () => {
  it('con LinkedIn y nadie igual en su empresa ⇒ se crea sin correo y se asocia', async () => {
    const { d, spy } = deps();
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.status, 'created');
    assert.equal(result.ok && result.message, SYNC_MESSAGES.createdWithoutEmail);
    assert.equal(spy.identityCalls, 1);
    assert.equal(spy.created[0].email, null);
    assert.equal(spy.created[0].linkedinUrl, 'https://www.linkedin.com/in/anaperez');
  });

  it('ya está en su empresa (mismo nombre) ⇒ se vincula, no se crea', async () => {
    const { d, spy } = deps({ findHubSpotContactsForIdentity: async () => [candidate({ id: 'hs-ana' })] });
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(result.ok && result.status, 'linked_existing');
    assert.equal(result.ok && result.hubspotContactId, 'hs-ana');
    assert.equal(spy.created.length, 0);
  });

  it('varias personas con ese nombre ⇒ no se crea y queda bloqueado con el motivo', async () => {
    const { d, spy } = deps({ findHubSpotContactsForIdentity: async () => [candidate(), candidate({ id: 'hs-2' })] });
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.errorCode, 'MISSING_EMAIL');
    assert.equal(!result.ok && result.message, SYNC_MESSAGES.ambiguousWithoutEmail);
    assert.equal(spy.created.length, 0);
    const state = readHubSpotSyncState(spy.persisted.at(-1)?.metadata as Record<string, unknown>);
    assert.equal(state?.status, 'blocked_no_email');
    assert.equal(state?.last_error, 'ambiguous_without_email');
  });

  it('si no se pudo leer HubSpot ⇒ falla cerrado, no crea', async () => {
    const { d, spy } = deps({
      findHubSpotContactsForIdentity: async () => {
        throw new Error('HTTP 500');
      },
    });
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(!result.ok && result.errorCode, 'HUBSPOT_ERROR');
    assert.equal(spy.created.length, 0);
  });

  it('sin correo NI LinkedIn ⇒ sigue bloqueado como antes, sin red', async () => {
    const { d, spy } = deps({ contact: contactWithoutEmail({ linkedin_url: null }) });
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(!result.ok && result.errorCode, 'MISSING_EMAIL');
    assert.equal(!result.ok && result.message, SYNC_MESSAGES.missingEmail);
    assert.equal(spy.identityCalls, 0);
  });

  it('sin la búsqueda de identidad cableada ⇒ comportamiento anterior (bloqueado)', async () => {
    const { d } = deps({ findHubSpotContactsForIdentity: undefined });
    const result = await runSyncContactToHubSpot('contact-1', d);
    assert.equal(!result.ok && result.errorCode, 'MISSING_EMAIL');
  });

  it('con correo no cambia nada: se busca por correo, no por identidad', async () => {
    let byEmail = 0;
    const { d, spy } = deps({
      contact: contactWithoutEmail({ email: 'ana@sportium.co' }),
      findHubSpotContactByEmail: async () => {
        byEmail += 1;
        return null;
      },
    });
    await runSyncContactToHubSpot('contact-1', d);
    assert.equal(byEmail, 1);
    assert.equal(spy.identityCalls, 0);
    assert.equal(spy.created[0].email, 'ana@sportium.co');
  });
});
