/**
 * AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE (Bryan 17-11).
 *
 * «Traer» un contacto de HubSpot desde la ficha de la empresa se comporta como un contacto
 * revisado y aprobado:
 *  - se crea el candidato de HubSpot y se aprueba al instante con la aprobación de siempre;
 *  - si ya esperaba en «Por revisar» (misma empresa, mismo ID de HubSpot), se aprueba ÉSE;
 *  - la corrida interna no sale en el historial de búsquedas;
 *  - desde la ficha del contacto se ofrece «Revelar correo» / «Revelar LinkedIn» y lo revelado
 *    llega al contacto (sólo vacíos);
 *  - «Primero HubSpot» no vuelve a ofrecer a revisión a quien ya está en SellUp con ese ID;
 *  - un LinkedIn recién encontrado reemplaza en HubSpot uno distinto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CONTACT_NOT_CREATED,
  HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE,
  buildHubSpotLookupImportCandidateRow,
  buildHubSpotLookupImportRunRow,
  isHubSpotLookupImportRunSummary,
  missingChannelsLabel,
  runHubSpotContactImport,
  withoutHubSpotLookupImportRuns,
  type ApproveOutcome,
  type HubSpotContactImportDeps,
  type HubSpotContactToImport,
} from '../hubspot-contact-import-core';
import {
  classifyOfficialContactChannelOffer,
  planOfficialContactChannelFill,
  type OfficialContactForChannelReveal,
  type SourceCandidateForChannelReveal,
} from '../official-contact-identity-completion-core';
import {
  buildCandidateRevealFill,
  linkedinProfileKey,
  runCandidateRevealHubSpotPush,
  type CandidateRevealPushDeps,
} from '../candidate-reveal-hubspot-push-core';
import { runCandidateIdentityCompletion, type IdentityCompletionDeps } from '../candidate-identity-completion-core';
import { selectHubSpotFirstCandidates } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-core';
import { importedContactToastDescription } from '@/modules/hubspot-lookup/import-copy';
import type { ExistingContactSnapshot } from '../types';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// ── «Traer» ───────────────────────────────────────────────────────────

const CONTACT: HubSpotContactToImport = {
  hubspotContactId: '501',
  firstName: 'Ana',
  lastName: 'Pérez',
  fullName: 'Ana Pérez',
  email: 'Ana@Empresa.com',
  linkedinUrl: null,
  jobTitle: 'Gerente de Talento',
};

interface Calls {
  approved: string[];
  runs: unknown[];
  candidates: unknown[];
  discarded: Array<{ runId: string | null; candidateId: string | null }>;
  legacy: number;
}

function deps(
  calls: Calls,
  opts: {
    pending?: string[];
    existing?: Array<{ id: string; email: string | null; linkedin_url: string | null; full_name: string }>;
    approve?: (id: string) => ApproveOutcome;
    runId?: string | null;
    candidateId?: string | null;
    legacyFails?: boolean;
  } = {},
): HubSpotContactImportDeps {
  return {
    findPendingCandidateIds: async () => opts.pending ?? [],
    loadAccountContacts: async () => opts.existing ?? [],
    loadAccount: async (id) => ({ id, name: 'Empresa SA', domain: 'empresa.com', countryCode: 'CO', hubspotCompanyId: '900' }),
    createRun: async (row) => {
      calls.runs.push(row);
      return opts.runId === undefined ? 'run-1' : opts.runId;
    },
    insertCandidate: async (row) => {
      calls.candidates.push(row);
      return opts.candidateId === undefined ? 'cand-new' : opts.candidateId;
    },
    approveCandidate: async (id) => {
      calls.approved.push(id);
      return opts.approve ? opts.approve(id) : { ok: true, contactId: `contact-of-${id}` };
    },
    discardHalfDone: async (input) => {
      calls.discarded.push(input);
    },
    legacyCreateOrLink: async () => {
      calls.legacy += 1;
      return opts.legacyFails ? { success: false, error: 'db down' } : { success: true, id: 'legacy-contact', created: true };
    },
  };
}

const fresh = (): Calls => ({ approved: [], runs: [], candidates: [], discarded: [], legacy: 0 });
const INPUT = { accountId: 'acc-1', triggeredBy: 'user-1', contact: CONTACT };

describe('«Traer» = candidato de HubSpot aprobado al instante', () => {
  it('crea corrida interna + candidato y lo aprueba con la aprobación de siempre', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(INPUT, deps(calls));
    assert.deepEqual(result, {
      ok: true,
      contactId: 'contact-of-cand-new',
      created: true,
      via: 'new_candidate_approved',
      candidateId: 'cand-new',
    });
    assert.deepEqual(calls.approved, ['cand-new']);
    assert.equal(calls.legacy, 0);
    assert.equal(calls.discarded.length, 0);
  });

  it('el candidato tiene la forma de «Primero HubSpot», sin teléfono', () => {
    const row = buildHubSpotLookupImportCandidateRow(CONTACT, 'run-1');
    assert.equal(row.source, 'hubspot');
    assert.equal(row.source_contact_id, '501');
    assert.equal(row.matched_hubspot_contact_id, '501');
    assert.equal(row.status, 'pending_review');
    assert.equal(row.phone, null);
    assert.equal(row.email, 'ana@empresa.com');
    assert.equal(row.enrichment_run_id, 'run-1');
  });

  it('la corrida interna es una fila «legacy» (sin request) marcada «Traído de HubSpot»', () => {
    const run = buildHubSpotLookupImportRunRow({
      account: { id: 'acc-1', name: 'Empresa SA', domain: 'empresa.com', countryCode: 'CO', hubspotCompanyId: '900' },
      triggeredBy: 'user-1',
      hubspotContactId: '501',
    });
    assert.equal(run.account_id, 'acc-1');
    assert.equal(run.triggered_by, 'user-1');
    assert.equal(run.status, 'completed');
    assert.equal(run.summary.entry_mode, HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE);
    assert.ok(!('request_id' in run));
  });

  it('si ya esperaba en «Por revisar», aprueba ése y no crea otro', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(INPUT, deps(calls, { pending: ['cand-pending'] }));
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.via, 'pending_candidate_approved');
    assert.deepEqual(calls.approved, ['cand-pending']);
    assert.equal(calls.runs.length, 0);
    assert.equal(calls.candidates.length, 0);
  });

  it('un pendiente con la identidad en duda no se aprueba solo: se pide revisarlo', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(
      INPUT,
      deps(calls, {
        pending: ['cand-pending'],
        approve: () => ({ ok: false, error: 'x', code: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' }),
      }),
    );
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /Por revisar/);
    assert.equal(calls.legacy, 0);
  });

  it('un pendiente que choca con un contacto existente usa el camino de antes (vincular)', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(
      INPUT,
      deps(calls, { pending: ['cand-pending'], approve: () => ({ ok: false, duplicate: true, error: 'dup' }) }),
    );
    assert.equal(result.ok && result.via, 'existing_contact_linked');
    assert.equal(calls.legacy, 1);
  });

  it('si la empresa ya tiene a esa persona (correo), no crea candidato: vincula el contacto', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(
      INPUT,
      deps(calls, { existing: [{ id: 'c-9', email: 'ana@empresa.com', linkedin_url: null, full_name: 'Ana P.' }] }),
    );
    assert.equal(result.ok && result.via, 'existing_contact_linked');
    assert.equal(calls.runs.length, 0);
    assert.equal(calls.approved.length, 0);
  });

  it('si la aprobación falla, borra lo creado a medias y usa el camino de antes', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(INPUT, deps(calls, { approve: () => ({ ok: false, error: 'rpc' }) }));
    assert.equal(result.ok && result.via, 'legacy_direct');
    assert.deepEqual(calls.discarded, [{ runId: 'run-1', candidateId: 'cand-new' }]);
    assert.equal(calls.legacy, 1);
  });

  it('si no se pudo crear la corrida, borra y usa el camino de antes', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(INPUT, deps(calls, { runId: null }));
    assert.equal(result.ok && result.via, 'legacy_direct');
    assert.equal(calls.candidates.length, 0);
    assert.equal(calls.legacy, 1);
  });

  it('el error del camino de antes no se filtra crudo', async () => {
    const calls = fresh();
    const result = await runHubSpotContactImport(INPUT, deps(calls, { runId: null, legacyFails: true }));
    assert.deepEqual(result, { ok: false, error: CONTACT_NOT_CREATED });
  });

  it('el aviso dice lo que falta y si salió de «Por revisar»', () => {
    assert.equal(missingChannelsLabel({ email: 'a@b.co', linkedinUrl: null, hasPhone: false }), 'LinkedIn · teléfono');
    assert.equal(missingChannelsLabel({ email: 'a@b.co', linkedinUrl: 'x', hasPhone: true }), null);
    assert.equal(
      importedContactToastDescription({
        success: true,
        accountId: 'a',
        contactId: 'c',
        created: true,
        missing: 'correo · teléfono',
        approvedFromReview: true,
      }),
      'Estaba en «Por revisar»: quedó aprobado. Le faltan: correo · teléfono. Ábrelo para revelarlos.',
    );
  });
});

describe('la corrida interna de «Traer» no es una búsqueda', () => {
  it('se reconoce por su summary y se quita de las listas', () => {
    assert.equal(isHubSpotLookupImportRunSummary({ entry_mode: HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE }), true);
    assert.equal(isHubSpotLookupImportRunSummary({ entry_mode: 'linkedin_single' }), false);
    assert.equal(isHubSpotLookupImportRunSummary(null), false);
    const rows = [
      { id: 'a', summary: { entry_mode: HUBSPOT_LOOKUP_IMPORT_ENTRY_MODE } },
      { id: 'b', summary: {} },
      { id: 'c', summary: null },
    ];
    assert.deepEqual(
      withoutHubSpotLookupImportRuns(rows).map((r) => r.id),
      ['b', 'c'],
    );
  });

  it('historial, «Última búsqueda», siguiente paso y recorrido la filtran', () => {
    for (const file of [
      'src/modules/contact-enrichment/account-run-history-actions.ts',
      'src/modules/accounts/list-signals.server.ts',
      'src/modules/accounts/next-step.server.ts',
      'src/modules/pipeline/actions.ts',
    ]) {
      assert.match(read(file), /withoutHubSpotLookupImportRuns\(/, file);
    }
  });

  it('«Traer» pasa por el candidato aprobado (no inserta en contacts directo)', () => {
    const actions = read('src/modules/hubspot-lookup/actions.ts');
    assert.match(actions, /importHubSpotContactAsApprovedCandidate\(/);
    assert.doesNotMatch(actions, /createOrLinkContactFromHubSpot\(/);
    const server = read('src/modules/contact-enrichment/hubspot-contact-import.server.ts');
    assert.match(server, /approveContactCandidate\(candidateId\)/);
    // Nunca se borra un candidato aprobado.
    assert.match(server, /\.neq\('status', 'approved'\)/);
  });
});

// ── «Primero HubSpot» ────────────────────────────────────────────────────

function snapshot(overrides: Partial<ExistingContactSnapshot>): ExistingContactSnapshot {
  return {
    source: 'hubspot',
    fullName: 'Ana Pérez',
    title: 'Gerente de Recursos Humanos',
    completeness: { hasEmail: false, hasPhone: false, hasLinkedin: false },
    ...overrides,
  } as ExistingContactSnapshot;
}

describe('«Primero HubSpot» no ofrece otra vez a quien ya está en SellUp con ese ID', () => {
  it('sin correo ni LinkedIn, el ID de HubSpot basta para saltarlo', () => {
    const selection = selectHubSpotFirstCandidates({
      hubspotContacts: [snapshot({ id: '501' })],
      sellupContacts: [snapshot({ id: 'c-1', source: 'sellup', hubspotContactId: '501' })],
      alreadyInRunHubspotIds: new Set(),
    });
    assert.equal(selection.rows.length, 0);
    assert.equal(selection.skippedKnownInSellUp, 1);
  });

  it('otro ID de HubSpot sí entra', () => {
    const selection = selectHubSpotFirstCandidates({
      hubspotContacts: [snapshot({ id: '502' })],
      sellupContacts: [snapshot({ id: 'c-1', source: 'sellup', hubspotContactId: '501' })],
      alreadyInRunHubspotIds: new Set(),
    });
    assert.equal(selection.rows.length, 1);
  });

  it('el lector de SellUp trae el vínculo con HubSpot', () => {
    const reader = read('src/server/agents/contact-enrichment-toolkit/existing-contacts-reader.ts');
    assert.match(reader, /hubspot_contact_id'/);
    assert.match(reader, /hubspotContactId:/);
  });
});

// ── Ficha del contacto: «Revelar correo» / «Revelar LinkedIn» ─────────────

function officialContact(overrides: Partial<OfficialContactForChannelReveal> = {}): OfficialContactForChannelReveal {
  return {
    id: 'contact-1',
    archivedAt: null,
    email: 'ana@empresa.com',
    linkedinUrl: null,
    metadata: { source_candidate_id: '11111111-1111-4111-8111-111111111111' },
    ...overrides,
  };
}

function sourceCandidate(overrides: Partial<SourceCandidateForChannelReveal> = {}): SourceCandidateForChannelReveal {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'approved',
    source: 'hubspot',
    sourceContactId: '501',
    matchedContactsId: 'contact-1',
    apolloPersonId: null,
    email: 'ana@empresa.com',
    linkedinUrl: null,
    enrichmentMetadata: {},
    ...overrides,
  };
}

describe('ficha del contacto: qué se ofrece', () => {
  it('con correo y sin LinkedIn ofrece «Revelar LinkedIn»', () => {
    const offer = classifyOfficialContactChannelOffer({
      contact: officialContact(),
      candidate: sourceCandidate(),
      roleAuthorized: true,
    });
    assert.deepEqual({ email: offer.email, linkedin: offer.linkedin, reason: offer.reason }, {
      email: false,
      linkedin: true,
      reason: 'ok',
    });
  });

  it('con LinkedIn y sin correo ofrece «Revelar correo»', () => {
    const offer = classifyOfficialContactChannelOffer({
      contact: officialContact({ email: null, linkedinUrl: 'https://www.linkedin.com/in/ana' }),
      candidate: sourceCandidate({ email: null, linkedinUrl: 'https://www.linkedin.com/in/ana' }),
      roleAuthorized: true,
    });
    assert.equal(offer.email, true);
    assert.equal(offer.linkedin, false);
  });

  it('sin vínculo durable, con otro contacto, no aprobado o sin rol: nada', () => {
    const cases: Array<[Partial<OfficialContactForChannelReveal>, Partial<SourceCandidateForChannelReveal>, boolean, string]> = [
      [{ metadata: {} }, {}, true, 'missing_source_candidate'],
      [{}, { matchedContactsId: 'otro' }, true, 'not_linked'],
      [{}, { status: 'pending_review' }, true, 'not_linked'],
      [{}, { source: 'apollo' }, true, 'not_hubspot_candidate'],
      [{}, {}, false, 'unauthorized_role'],
      [{ archivedAt: '2026-11-01' }, {}, true, 'contact_unavailable'],
    ];
    for (const [c, cand, role, reason] of cases) {
      const offer = classifyOfficialContactChannelOffer({
        contact: officialContact(c),
        candidate: sourceCandidate(cand),
        roleAuthorized: role,
      });
      assert.equal(offer.reason, reason);
      assert.equal(offer.email || offer.linkedin, false);
    }
  });

  it('un intento anterior sin fruto no se vuelve a ofrecer', () => {
    const offer = classifyOfficialContactChannelOffer({
      contact: officialContact(),
      candidate: sourceCandidate({ enrichmentMetadata: { identity_completion: { outcome: 'not_found' } } }),
      roleAuthorized: true,
    });
    assert.equal(offer.linkedin, false);
  });

  it('al contacto sólo llegan campos VACÍOS', () => {
    assert.deepEqual(
      planOfficialContactChannelFill({
        contact: { email: null, linkedinUrl: 'https://linkedin.com/in/propio' },
        candidate: { email: 'nuevo@empresa.com', linkedinUrl: 'https://linkedin.com/in/otro' },
      }),
      { email: 'nuevo@empresa.com' },
    );
  });
});

describe('identity completion acepta un candidato aprobado sólo cuando el servidor lo pide', () => {
  function completionDeps(status: string): IdentityCompletionDeps {
    return {
      actor: { internalUserId: 'u', roleKey: 'admin' },
      nowIso: '2026-11-17T00:00:00.000Z',
      loadCandidate: async (id) => ({
        id,
        status,
        source: 'hubspot',
        sourceContactId: '501',
        apolloPersonId: null,
        email: 'ana@empresa.com',
        linkedinUrl: 'https://www.linkedin.com/in/ana',
        firstName: 'Ana',
        lastName: 'Pérez',
        fullName: 'Ana Pérez',
        companyName: 'Empresa',
        companyDomain: 'empresa.com',
        title: null,
        enrichmentMetadata: {},
      }),
      lookupApollo: async () => {
        throw new Error('no debería llamarse');
      },
      persist: async () => {},
      logUsage: async () => {},
    };
  }

  it('aprobado sin `allowApproved` ⇒ not_pending_review (sin gastar)', async () => {
    const result = await runCandidateIdentityCompletion({ candidateId: 'c', purpose: 'linkedin' }, completionDeps('approved'));
    assert.equal(result.status, 'not_pending_review');
  });

  it('aprobado con `allowApproved` pasa la puerta del estado', async () => {
    const result = await runCandidateIdentityCompletion(
      { candidateId: 'c', purpose: 'linkedin', allowApproved: true },
      completionDeps('approved'),
    );
    // Ya tiene LinkedIn: nada que completar, pero ya no es «no está en revisión».
    assert.equal(result.status, 'nothing_to_complete');
  });

  it('rechazado sigue fuera aunque se pida', async () => {
    const result = await runCandidateIdentityCompletion(
      { candidateId: 'c', purpose: 'linkedin', allowApproved: true },
      completionDeps('discarded'),
    );
    assert.equal(result.status, 'not_pending_review');
  });

  it('`allowApproved` vive fuera del archivo «use server» (no lo manda el navegador)', () => {
    const actions = read('src/modules/contact-enrichment/candidate-identity-completion-actions.ts');
    assert.doesNotMatch(actions, /allowApproved/);
    const official = read('src/modules/contact-enrichment/official-contact-identity-completion-actions.ts');
    assert.match(official, /canSeeOfficialContact\(/);
    assert.match(official, /allowApproved: true/);
    const reveal = read('src/modules/contact-enrichment/post-approval-reveal-actions.ts');
    assert.match(reveal, /revealCandidatePhoneWithIdentity\(/);
  });
});

// ── LinkedIn encontrado: reemplaza en HubSpot uno distinto ─────────────────

describe('un LinkedIn recién encontrado reemplaza en HubSpot uno distinto', () => {
  const existing = (url: string | null) => ({ id: 'hs-1', properties: { hs_linkedin_url: url } });
  const cand = { id: 'c', phone: null, linkedinUrl: 'https://www.linkedin.com/in/ana-nueva' };

  it('sin la opción, sólo se completa si está vacío (como siempre)', () => {
    assert.deepEqual(buildCandidateRevealFill(cand, existing('https://linkedin.com/in/ana-vieja')), {});
    assert.deepEqual(buildCandidateRevealFill(cand, existing(null)), {
      hs_linkedin_url: 'https://www.linkedin.com/in/ana-nueva',
    });
  });

  it('con la opción, uno distinto se reemplaza', () => {
    assert.deepEqual(
      buildCandidateRevealFill(cand, existing('https://linkedin.com/in/ana-vieja'), undefined, { replaceDifferentLinkedin: true }),
      { hs_linkedin_url: 'https://www.linkedin.com/in/ana-nueva' },
    );
  });

  it('el mismo perfil escrito de otra forma no se reescribe', () => {
    assert.deepEqual(
      buildCandidateRevealFill(cand, existing('http://LinkedIn.com/in/ana-nueva/?trk=x'), undefined, {
        replaceDifferentLinkedin: true,
      }),
      {},
    );
    assert.equal(linkedinProfileKey('https://es.linkedin.com/in/ana/'), linkedinProfileKey('linkedin.com/in/ana'));
  });

  async function pushWith(trigger: Parameters<typeof runCandidateRevealHubSpotPush>[1]) {
    const filled: Array<Record<string, string>> = [];
    const pushDeps: CandidateRevealPushDeps = {
      nowIso: '2026-11-17T00:00:00.000Z',
      loadCandidate: async () => ({
        id: 'c',
        status: 'approved',
        source: 'hubspot',
        sourceContactId: 'hs-1',
        matchedHubSpotContactId: 'hs-1',
        matchedContactsId: 'contact-1',
        phone: null,
        linkedinUrl: 'https://www.linkedin.com/in/ana-nueva',
        email: null,
        enrichmentMetadata: {},
      }),
      checkConnection: async () => ({ connected: true, canWriteContacts: true }),
      findHubSpotContactById: async () => ({ id: 'hs-1', properties: { hs_linkedin_url: 'https://linkedin.com/in/ana-vieja' }, email: 'x@y.co' }),
      fillEmptyHubSpotContactProperties: async (_id, properties) => {
        filled.push(properties as Record<string, string>);
        return { ok: true, written: Object.keys(properties) as never };
      },
      fillEmptyHubSpotContactEmail: async () => ({ ok: true }),
      persistTrace: async () => {},
    };
    await runCandidateRevealHubSpotPush('c', trigger, pushDeps);
    return filled;
  }

  it('«Revelar LinkedIn» y la búsqueda por LinkedIn reemplazan; un reveal de teléfono no', async () => {
    assert.deepEqual(await pushWith('reveal_linkedin'), [{ hs_linkedin_url: 'https://www.linkedin.com/in/ana-nueva' }]);
    assert.deepEqual(await pushWith('quick_search_linkedin'), [{ hs_linkedin_url: 'https://www.linkedin.com/in/ana-nueva' }]);
    assert.deepEqual(await pushWith('reveal_phone_apollo_webhook'), []);
  });
});
