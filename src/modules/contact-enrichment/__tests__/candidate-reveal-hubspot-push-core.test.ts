/**
 * AGENT2A-HUBSPOT-REVEAL-PUSH — lo revelado de un candidato que ya existe en HubSpot viaja a su
 * contacto de HubSpot EN CUANTO se revela, sin esperar a la aprobación.
 *
 * Se demuestra:
 *  - sólo se completan propiedades VACÍAS (nunca se sobrescribe), y sólo los canales del reveal;
 *  - el correo va aparte y un 409 no impide que el teléfono y el LinkedIn lleguen;
 *  - sin contacto de HubSpot, rechazado, sin conexión o sin poder leer: cero escrituras;
 *  - nunca lanza y el rastro no guarda PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY,
  resolveCandidateHubSpotContactId,
  runCandidateRevealHubSpotPush,
  type CandidateRevealPushCandidate,
  type CandidateRevealPushDeps,
} from '../candidate-reveal-hubspot-push-core';
import type { HubSpotExistingContactMatch } from '@/modules/contacts/contact-hubspot-sync-core';

const NOW = '2026-10-29T20:00:00.000Z';

function candidate(overrides: Partial<CandidateRevealPushCandidate> = {}): CandidateRevealPushCandidate {
  return {
    id: 'cand-1',
    status: 'pending_review',
    source: 'hubspot',
    sourceContactId: 'hs-77',
    matchedHubSpotContactId: 'hs-77',
    phone: '+57 300 111 2222',
    linkedinUrl: 'https://www.linkedin.com/in/ana-perez',
    email: 'ana@empresa.com',
    enrichmentMetadata: { hubspot_first: true },
    ...overrides,
  };
}

function hubspotContact(overrides: Partial<HubSpotExistingContactMatch> = {}): HubSpotExistingContactMatch {
  return {
    id: 'hs-77',
    properties: {
      firstname: 'Ana',
      lastname: 'Pérez',
      jobtitle: 'Gerente de RR. HH.',
      phone: null,
      mobilephone: null,
      hs_linkedin_url: null,
    },
    email: 'ana@empresa.com',
    ...overrides,
  };
}

interface Spy {
  filled: { id: string; properties: Record<string, string> }[];
  emails: { id: string; email: string }[];
  traces: Record<string, unknown>[];
  reads: string[];
}

function makeDeps(
  spy: Spy,
  opts: {
    candidate?: CandidateRevealPushCandidate | null;
    existing?: HubSpotExistingContactMatch | null;
    connection?: { connected: boolean; canWriteContacts: boolean };
    fillResult?: { ok: true; written: string[] } | { error: string };
    emailResult?: { ok: true } | { error: string };
    readThrows?: boolean;
  } = {},
): CandidateRevealPushDeps {
  return {
    nowIso: NOW,
    loadCandidate: async () => (opts.candidate === undefined ? candidate() : opts.candidate),
    checkConnection: async () => opts.connection ?? { connected: true, canWriteContacts: true },
    findHubSpotContactById: async (id) => {
      spy.reads.push(id);
      if (opts.readThrows) throw new Error('HTTP 500');
      return opts.existing === undefined ? hubspotContact() : opts.existing;
    },
    fillEmptyHubSpotContactProperties: async (id, properties) => {
      spy.filled.push({ id, properties: properties as Record<string, string> });
      return (opts.fillResult as never) ?? { ok: true, written: Object.keys(properties) as never };
    },
    fillEmptyHubSpotContactEmail: async (id, email) => {
      spy.emails.push({ id, email });
      return opts.emailResult ?? { ok: true };
    },
    persistTrace: async (_id, metadata) => {
      spy.traces.push(metadata);
    },
  };
}

const newSpy = (): Spy => ({ filled: [], emails: [], traces: [], reads: [] });

describe('1. un reveal llega a HubSpot sin aprobar', () => {
  it('completa teléfono y LinkedIn vacíos del contacto de HubSpot', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush('cand-1', 'reveal_phone_apollo_webhook', makeDeps(spy));
    assert.equal(report.outcome, 'filled');
    assert.equal(report.hubspotContactId, 'hs-77');
    assert.equal(spy.filled.length, 1);
    assert.equal(spy.filled[0].id, 'hs-77');
    assert.deepEqual(Object.keys(spy.filled[0].properties).sort(), ['hs_linkedin_url', 'phone']);
    assert.equal(spy.filled[0].properties.phone, '+57 300 111 2222');
    // El correo ya estaba en HubSpot: no se toca.
    assert.deepEqual(spy.emails, []);
  });

  it('un candidato aprobado o en revisión da igual: lo que manda es el contacto de HubSpot', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_linkedin',
      makeDeps(spy, { candidate: candidate({ status: 'approved' }) }),
    );
    assert.equal(report.outcome, 'filled');
  });
});

describe('2. nunca sobrescribe', () => {
  it('lo que HubSpot ya tiene no viaja', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_lusha_waterfall',
      makeDeps(spy, {
        existing: hubspotContact({
          properties: { phone: '+57 1 999 9999', hs_linkedin_url: null, mobilephone: null },
        }),
      }),
    );
    assert.equal(report.outcome, 'filled');
    assert.deepEqual(Object.keys(spy.filled[0].properties), ['hs_linkedin_url']);
  });

  it('todo lleno ⇒ cero escrituras y `nothing_to_fill`', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_recovery',
      makeDeps(spy, {
        existing: hubspotContact({
          properties: { phone: '+57 1 999', hs_linkedin_url: 'https://linkedin.com/in/x', mobilephone: null },
        }),
      }),
    );
    assert.equal(report.outcome, 'nothing_to_fill');
    assert.deepEqual(spy.filled, []);
  });

  it('nombre y cargo NO viajan aunque HubSpot los tenga vacíos', async () => {
    const spy = newSpy();
    await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_cache_hit',
      makeDeps(spy, {
        existing: hubspotContact({
          properties: { firstname: null, lastname: null, jobtitle: null, phone: null, hs_linkedin_url: null },
        }),
      }),
    );
    const sent = Object.keys(spy.filled[0].properties);
    assert.equal(sent.includes('firstname'), false);
    assert.equal(sent.includes('jobtitle'), false);
  });
});

describe('3. el correo va aparte', () => {
  it('correo vacío en HubSpot ⇒ se completa', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_email',
      makeDeps(spy, { existing: hubspotContact({ email: null }) }),
    );
    assert.equal(report.email, 'filled');
    assert.deepEqual(spy.emails, [{ id: 'hs-77', email: 'ana@empresa.com' }]);
  });

  it('un 409 del correo no impide que el teléfono llegue', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_email',
      makeDeps(spy, { existing: hubspotContact({ email: '' }), emailResult: { error: 'HUBSPOT_EMAIL_HTTP_409' } }),
    );
    assert.equal(report.outcome, 'filled');
    assert.equal(report.email, 'failed');
    assert.equal(spy.filled.length, 1);
  });

  it('correo no leído (`undefined`) ⇒ no se escribe', async () => {
    const spy = newSpy();
    const existing = hubspotContact();
    delete existing.email;
    await runCandidateRevealHubSpotPush('cand-1', 'reveal_email', makeDeps(spy, { existing }));
    assert.deepEqual(spy.emails, []);
  });
});

describe('4. cero escrituras cuando no corresponde', () => {
  it('candidato sin contacto en HubSpot (Apollo sin emparejar)', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_apollo_webhook',
      makeDeps(spy, { candidate: candidate({ source: 'apollo', sourceContactId: 'ap-1', matchedHubSpotContactId: null }) }),
    );
    assert.equal(report.outcome, 'not_in_hubspot');
    assert.deepEqual(spy.reads, []);
    assert.deepEqual(spy.traces, []);
  });

  it('candidato de Apollo emparejado con un contacto de HubSpot ⇒ sí viaja', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_apollo_webhook',
      makeDeps(spy, { candidate: candidate({ source: 'apollo', sourceContactId: 'ap-1', matchedHubSpotContactId: 'hs-77' }) }),
    );
    assert.equal(report.outcome, 'filled');
  });

  it('candidato rechazado', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_linkedin',
      makeDeps(spy, { candidate: candidate({ status: 'rejected' }) }),
    );
    assert.equal(report.outcome, 'candidate_rejected');
    assert.deepEqual(spy.reads, []);
  });

  it('HubSpot sin permiso de escritura', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_linkedin',
      makeDeps(spy, { connection: { connected: true, canWriteContacts: false } }),
    );
    assert.equal(report.outcome, 'hubspot_unavailable');
    assert.deepEqual(spy.reads, []);
    assert.deepEqual(spy.filled, []);
  });

  it('no se pudo leer el contacto ⇒ no se escribe (no se sabe qué está vacío)', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_linkedin',
      makeDeps(spy, { readThrows: true }),
    );
    assert.equal(report.outcome, 'hubspot_contact_unreadable');
    assert.deepEqual(spy.filled, []);
    assert.deepEqual(spy.emails, []);
  });

  it('nada revelado', async () => {
    const spy = newSpy();
    const report = await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_linkedin',
      makeDeps(spy, { candidate: candidate({ phone: null, linkedinUrl: '  ', email: null }) }),
    );
    assert.equal(report.outcome, 'nothing_revealed');
  });
});

describe('5. nunca lanza y el rastro no guarda PII', () => {
  it('una excepción del PATCH se reporta como `failed`', async () => {
    const spy = newSpy();
    const deps = makeDeps(spy);
    deps.fillEmptyHubSpotContactProperties = async () => {
      throw new Error('socket hang up');
    };
    const report = await runCandidateRevealHubSpotPush('cand-1', 'reveal_phone_apollo_webhook', deps);
    assert.equal(report.outcome, 'failed');
  });

  it('una excepción al leer el candidato no escapa', async () => {
    const spy = newSpy();
    const deps = makeDeps(spy);
    deps.loadCandidate = async () => {
      throw new Error('db down');
    };
    const report = await runCandidateRevealHubSpotPush('cand-1', 'reveal_linkedin', deps);
    assert.equal(report.outcome, 'candidate_unavailable');
  });

  it('el rastro acumula nombres de propiedades, nunca valores', async () => {
    const spy = newSpy();
    await runCandidateRevealHubSpotPush(
      'cand-1',
      'reveal_phone_apollo_webhook',
      makeDeps(spy, { existing: hubspotContact({ email: null }) }),
    );
    const trace = spy.traces[0][CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY] as Record<string, unknown>;
    assert.deepEqual(trace.properties_filled, ['email', 'hs_linkedin_url', 'phone']);
    assert.equal(trace.last_trigger, 'reveal_phone_apollo_webhook');
    assert.equal(spy.traces[0].hubspot_first, true, 'la metadata existente se conserva');
    const serialized = JSON.stringify(trace);
    assert.equal(serialized.includes('300 111'), false);
    assert.equal(serialized.includes('ana@empresa.com'), false);
    assert.equal(serialized.includes('ana-perez'), false);
  });
});

describe('6. resolveCandidateHubSpotContactId', () => {
  it('el emparejamiento manda; un candidato de HubSpot es su propio contacto', () => {
    assert.equal(
      resolveCandidateHubSpotContactId({ source: 'apollo', sourceContactId: 'x', matchedHubSpotContactId: 'hs-1' }),
      'hs-1',
    );
    assert.equal(
      resolveCandidateHubSpotContactId({ source: 'hubspot', sourceContactId: 'hs-2', matchedHubSpotContactId: null }),
      'hs-2',
    );
    assert.equal(
      resolveCandidateHubSpotContactId({ source: 'lusha', sourceContactId: 'l-1', matchedHubSpotContactId: '  ' }),
      null,
    );
  });
});
