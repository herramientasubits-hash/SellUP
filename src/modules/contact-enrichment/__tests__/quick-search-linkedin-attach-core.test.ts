// AGENT2A-LINKEDIN-SEARCH-ATTACH-EXISTING — el LinkedIn buscado se guarda en la persona que ya
// existía (candidato «Por revisar» o contacto aprobado) y viaja a HubSpot sólo si allá está vacío.
//
// Dobles en memoria: sin Supabase ni HubSpot. URLs y nombres ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINKEDIN_ATTACH_HITO,
  LINKEDIN_ATTACH_METADATA_KEY,
  attachSearchedLinkedinToCandidate,
  attachSearchedLinkedinToContact,
  fillHubSpotContactLinkedin,
  planLinkedinAttach,
  type CandidateLinkedinAttachDeps,
  type ContactLinkedinAttachDeps,
  type HubSpotLinkedinFillDeps,
  type LinkedinAttachCandidate,
  type LinkedinAttachContact,
} from '../quick-search-linkedin-attach-core';
import type { HubSpotExistingContactMatch } from '@/modules/contacts/contact-hubspot-sync-core';

const SEARCHED = 'https://www.linkedin.com/in/persona-ficticia-123';
const OTHER = 'https://www.linkedin.com/in/otra-persona-456';
const NOW = '2026-11-17T15:00:00.000Z';

describe('planLinkedinAttach', () => {
  it('sin LinkedIn ⇒ se guarda', () => {
    assert.equal(planLinkedinAttach(null, SEARCHED), 'set');
    assert.equal(planLinkedinAttach('   ', SEARCHED), 'set');
  });
  it('mismo perfil (otra forma de la URL) ⇒ no se escribe', () => {
    assert.equal(planLinkedinAttach('https://co.linkedin.com/in/persona-ficticia-123/?trk=x', SEARCHED), 'unchanged');
  });
  it('otro perfil ⇒ se reemplaza (decisión 1 de Bryan)', () => {
    assert.equal(planLinkedinAttach(OTHER, SEARCHED), 'replaced');
    assert.equal(planLinkedinAttach('no-es-un-linkedin', SEARCHED), 'replaced');
  });
  it('la URL buscada no es un perfil ⇒ nada', () => {
    assert.equal(planLinkedinAttach(null, ''), null);
    assert.equal(planLinkedinAttach(null, 'https://www.linkedin.com/company/empresa'), null);
  });
});

function hubspotContact(linkedin: string | null): HubSpotExistingContactMatch {
  return { id: 'hs-77', properties: { firstname: 'Ana', phone: null, mobilephone: null, hs_linkedin_url: linkedin } };
}

function hubspotDeps(existing: HubSpotExistingContactMatch | null, overrides: Partial<HubSpotLinkedinFillDeps> = {}) {
  const writes: { id: string; properties: Record<string, unknown> }[] = [];
  const deps: HubSpotLinkedinFillDeps = {
    checkConnection: async () => ({ connected: true, canWriteContacts: true }),
    findHubSpotContactById: async () => existing,
    fillEmptyHubSpotContactProperties: async (id, properties) => {
      writes.push({ id, properties: { ...properties } });
      return { ok: true, written: Object.keys(properties) as never };
    },
    ...overrides,
  };
  return { deps, writes };
}

describe('fillHubSpotContactLinkedin', () => {
  it('HubSpot sin LinkedIn ⇒ sólo se escribe hs_linkedin_url', async () => {
    const { deps, writes } = hubspotDeps(hubspotContact(null));
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, deps), 'filled');
    assert.deepEqual(writes, [{ id: 'hs-77', properties: { hs_linkedin_url: SEARCHED } }]);
  });
  it('HubSpot ya tiene un LinkedIn (aunque sea otro) ⇒ nunca se pisa', async () => {
    const { deps, writes } = hubspotDeps(hubspotContact(OTHER));
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, deps), 'nothing_to_fill');
    assert.equal(writes.length, 0);
  });
  it('sin contacto de HubSpot ⇒ not_in_hubspot, sin leer', async () => {
    let read = false;
    const { deps } = hubspotDeps(hubspotContact(null), { findHubSpotContactById: async () => ((read = true), null) });
    assert.equal(await fillHubSpotContactLinkedin(null, SEARCHED, deps), 'not_in_hubspot');
    assert.equal(read, false);
  });
  it('sin conexión o sin permiso ⇒ no escribe', async () => {
    const { deps, writes } = hubspotDeps(hubspotContact(null), {
      checkConnection: async () => ({ connected: true, canWriteContacts: false }),
    });
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, deps), 'hubspot_unavailable');
    assert.equal(writes.length, 0);
  });
  it('no se pudo leer el contacto ⇒ no escribe', async () => {
    const { deps, writes } = hubspotDeps(null);
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, deps), 'hubspot_contact_unreadable');
    const { deps: throwing } = hubspotDeps(null, {
      findHubSpotContactById: async () => {
        throw new Error('500');
      },
    });
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, throwing), 'hubspot_contact_unreadable');
    const { deps: noProps } = hubspotDeps({ id: 'hs-77' });
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, noProps), 'hubspot_contact_unreadable');
    assert.equal(writes.length, 0);
  });
  it('HubSpot rechaza o lanza ⇒ failed, nunca lanza', async () => {
    const { deps } = hubspotDeps(hubspotContact(null), { fillEmptyHubSpotContactProperties: async () => ({ error: 'x' }) });
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, deps), 'failed');
    const { deps: throwing } = hubspotDeps(hubspotContact(null), {
      fillEmptyHubSpotContactProperties: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(await fillHubSpotContactLinkedin('hs-77', SEARCHED, throwing), 'failed');
  });
});

function candidate(overrides: Partial<LinkedinAttachCandidate> = {}): LinkedinAttachCandidate {
  return { id: 'cand-1', status: 'pending_review', linkedinUrl: null, enrichmentMetadata: { hubspot_first: true }, ...overrides };
}

function candidateDeps(row: LinkedinAttachCandidate | null, overrides: Partial<CandidateLinkedinAttachDeps> = {}) {
  const writes: Parameters<CandidateLinkedinAttachDeps['writeCandidateLinkedin']>[] = [];
  const pushed: string[] = [];
  const deps: CandidateLinkedinAttachDeps = {
    nowIso: NOW,
    loadCandidate: async () => row,
    writeCandidateLinkedin: async (...args) => {
      writes.push(args);
      return true;
    },
    pushToHubSpot: async (id) => {
      pushed.push(id);
    },
    ...overrides,
  };
  return { deps, writes, pushed };
}

describe('attachSearchedLinkedinToCandidate', () => {
  it('candidato sin LinkedIn ⇒ se guarda (condicionado a vacío) y se envía a HubSpot', async () => {
    const { deps, writes, pushed } = candidateDeps(candidate());
    assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'set');
    assert.equal(writes.length, 1);
    const [id, input] = writes[0];
    assert.equal(id, 'cand-1');
    assert.equal(input.linkedinUrl, SEARCHED);
    assert.equal(input.expectedCurrent, null);
    // Conserva la metadata y deja el rastro sin la URL.
    assert.equal(input.enrichmentMetadata.hubspot_first, true);
    assert.deepEqual(input.enrichmentMetadata[LINKEDIN_ATTACH_METADATA_KEY], {
      hito: LINKEDIN_ATTACH_HITO,
      at: NOW,
      action: 'set',
      source: 'linkedin_quick_search',
    });
    assert.equal(JSON.stringify(input.enrichmentMetadata).includes('persona-ficticia'), false);
    assert.deepEqual(pushed, ['cand-1']);
  });

  it('candidato con OTRO LinkedIn ⇒ se reemplaza, condicionado al valor leído', async () => {
    const { deps, writes, pushed } = candidateDeps(candidate({ linkedinUrl: OTHER }));
    assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'replaced');
    assert.equal(writes[0][1].expectedCurrent, OTHER);
    assert.equal(writes[0][1].linkedinUrl, SEARCHED);
    assert.deepEqual(pushed, ['cand-1']);
  });

  it('mismo LinkedIn ⇒ no escribe, pero verifica HubSpot', async () => {
    const { deps, writes, pushed } = candidateDeps(candidate({ linkedinUrl: `${SEARCHED}/` }));
    assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'unchanged');
    assert.equal(writes.length, 0);
    assert.deepEqual(pushed, ['cand-1']);
  });

  it('ya no está «Por revisar» o no existe ⇒ nada', async () => {
    for (const row of [candidate({ status: 'approved' }), null]) {
      const { deps, writes, pushed } = candidateDeps(row);
      assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'not_found');
      assert.equal(writes.length + pushed.length, 0);
    }
  });

  it('otro proceso cambió el LinkedIn ⇒ conflict, sin envío a HubSpot', async () => {
    const { deps, pushed } = candidateDeps(candidate(), { writeCandidateLinkedin: async () => false });
    assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'conflict');
    assert.equal(pushed.length, 0);
  });

  it('nunca lanza', async () => {
    const { deps } = candidateDeps(candidate(), {
      loadCandidate: async () => {
        throw new Error('db');
      },
    });
    assert.equal(await attachSearchedLinkedinToCandidate({ candidateId: 'cand-1', linkedinUrl: SEARCHED }, deps), 'failed');
  });
});

function contact(overrides: Partial<LinkedinAttachContact> = {}): LinkedinAttachContact {
  return { id: 'ct-1', linkedinUrl: null, hubspotContactId: 'hs-77', ...overrides };
}

function contactDeps(row: LinkedinAttachContact | null, overrides: Partial<ContactLinkedinAttachDeps> = {}) {
  const writes: Parameters<ContactLinkedinAttachDeps['writeContactLinkedin']>[] = [];
  const fills: [string | null, string][] = [];
  const deps: ContactLinkedinAttachDeps = {
    loadContact: async () => row,
    writeContactLinkedin: async (...args) => {
      writes.push(args);
      return true;
    },
    fillHubSpotLinkedin: async (id, url) => {
      fills.push([id, url]);
      return 'filled';
    },
    ...overrides,
  };
  return { deps, writes, fills };
}

describe('attachSearchedLinkedinToContact (contacto aprobado, decisión 3)', () => {
  it('contacto sin LinkedIn ⇒ se guarda y se completa en HubSpot', async () => {
    const { deps, writes, fills } = contactDeps(contact());
    const report = await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps);
    assert.deepEqual(report, { outcome: 'set', hubspot: 'filled' });
    assert.deepEqual(writes, [['ct-1', { linkedinUrl: SEARCHED, expectedCurrent: null }]]);
    assert.deepEqual(fills, [['hs-77', SEARCHED]]);
  });

  it('contacto con otro LinkedIn ⇒ se reemplaza', async () => {
    const { deps, writes } = contactDeps(contact({ linkedinUrl: OTHER }));
    const report = await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps);
    assert.equal(report.outcome, 'replaced');
    assert.equal(writes[0][1].expectedCurrent, OTHER);
  });

  it('mismo LinkedIn ⇒ no escribe, pero verifica HubSpot', async () => {
    const { deps, writes, fills } = contactDeps(contact({ linkedinUrl: SEARCHED }));
    const report = await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps);
    assert.equal(report.outcome, 'unchanged');
    assert.equal(writes.length, 0);
    assert.equal(fills.length, 1);
  });

  it('contacto sin HubSpot ⇒ se guarda igual; HubSpot lo recibe al sincronizar', async () => {
    const { deps } = contactDeps(contact({ hubspotContactId: null }), {
      fillHubSpotLinkedin: async (id) => (id ? 'filled' : 'not_in_hubspot'),
    });
    const report = await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps);
    assert.deepEqual(report, { outcome: 'set', hubspot: 'not_in_hubspot' });
  });

  it('conflicto o no se pudo guardar ⇒ no va a HubSpot', async () => {
    const { deps, fills } = contactDeps(contact(), { writeContactLinkedin: async () => false });
    const report = await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps);
    assert.deepEqual(report, { outcome: 'conflict', hubspot: null });
    assert.equal(fills.length, 0);
  });

  it('contacto archivado o inexistente ⇒ not_found; nunca lanza', async () => {
    const { deps } = contactDeps(null);
    assert.deepEqual(await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, deps), {
      outcome: 'not_found',
      hubspot: null,
    });
    const { deps: failing } = contactDeps(contact(), {
      fillHubSpotLinkedin: async () => {
        throw new Error('hs');
      },
    });
    assert.deepEqual(await attachSearchedLinkedinToContact({ contactId: 'ct-1', linkedinUrl: SEARCHED }, failing), {
      outcome: 'set',
      hubspot: 'failed',
    });
  });
});
