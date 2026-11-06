/**
 * AGENT2A-APPROVED-REVEAL-CONTACT-SYNC — el teléfono revelado de un candidato APROBADO llega solo
 * a su contacto oficial (proyección 128/131) y, si eso dejó un pendiente nuevo, a HubSpot por la
 * segunda fase de siempre. Nunca lanza; sin candidato aprobado, contacto oficial o actor, no hace
 * nada.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApprovedCandidateRevealContactSync,
  type ApprovedRevealContactSyncCandidate,
  type ApprovedRevealContactSyncDeps,
} from '../approved-candidate-reveal-contact-sync-core';
import type { ProjectApprovedCandidatePhonesOutcome } from '../post-approval-reveal-core';
import type { ContactAutoPhoneUpdateReport } from '@/modules/contacts/contact-hubspot-auto-phone-update-core';

function candidate(overrides: Partial<ApprovedRevealContactSyncCandidate> = {}): ApprovedRevealContactSyncCandidate {
  return { id: 'cand-1', status: 'approved', matchedContactsId: 'contact-9', revealedBy: 'user-1', ...overrides };
}

function projected(overrides: Partial<ProjectApprovedCandidatePhonesOutcome> = {}): ProjectApprovedCandidatePhonesOutcome {
  return {
    status: 'projected',
    detail: null,
    candidateId: 'cand-1',
    contactId: 'contact-9',
    phonesSeen: 1,
    phonesInserted: 1,
    phonesReused: 0,
    phonesSkippedSuppressed: 0,
    sourcesInserted: 1,
    sourcesReused: 0,
    primaryDedupeKey: null,
    primaryElectedNow: true,
    scalarSynced: true,
    scalarFallback: 'not_requested' as never,
    hubspotSyncTransition: 'marked',
    ...overrides,
  } as ProjectApprovedCandidatePhonesOutcome;
}

const FOLLOW_UP = { outcome: 'attempted_updated', attempted: true } as unknown as ContactAutoPhoneUpdateReport;

function makeDeps(opts: {
  candidate?: ApprovedRevealContactSyncCandidate | null;
  capable?: boolean;
  projection?: ProjectApprovedCandidatePhonesOutcome | null | 'throw';
} = {}) {
  const calls = { project: [] as unknown[], followUp: [] as unknown[] };
  const deps: ApprovedRevealContactSyncDeps = {
    loadCandidate: async () => (opts.candidate === undefined ? candidate() : opts.candidate),
    checkProjectionCapability: async () => opts.capable ?? true,
    project: async (args) => {
      calls.project.push(args);
      if (opts.projection === 'throw') throw new Error('rpc down');
      return opts.projection === undefined ? projected() : opts.projection;
    },
    runHubSpotPhoneSyncFollowUp: async (contactId, actorId) => {
      calls.followUp.push({ contactId, actorId });
      return FOLLOW_UP;
    },
  };
  return { deps, calls };
}

describe('candidato aprobado con contacto oficial', () => {
  it('proyecta al contacto y corre la segunda fase hacia HubSpot', async () => {
    const { deps, calls } = makeDeps();
    const report = await runApprovedCandidateRevealContactSync('cand-1', deps);
    assert.equal(report.outcome, 'projected_and_synced');
    assert.deepEqual(calls.project, [{ candidateId: 'cand-1', contactId: 'contact-9', actorId: 'user-1' }]);
    assert.deepEqual(calls.followUp, [{ contactId: 'contact-9', actorId: 'user-1' }]);
    assert.equal(report.hubspotAutoUpdate, FOLLOW_UP);
  });

  it('la proyección no dejó un pendiente NUEVO ⇒ sin segunda fase', async () => {
    const { deps, calls } = makeDeps({ projection: projected({ hubspotSyncTransition: 'no_outbound_change' as never }) });
    const report = await runApprovedCandidateRevealContactSync('cand-1', deps);
    assert.equal(report.outcome, 'projected');
    assert.deepEqual(calls.followUp, []);
  });

  it('la proyección falla o lanza ⇒ `projection_failed`, sin segunda fase, nunca lanza', async () => {
    for (const projection of [null, 'throw' as const]) {
      const { deps, calls } = makeDeps({ projection });
      const report = await runApprovedCandidateRevealContactSync('cand-1', deps);
      assert.equal(report.outcome, 'projection_failed');
      assert.deepEqual(calls.followUp, []);
    }
  });

  it('RPC no desplegada ⇒ ni proyección ni HubSpot', async () => {
    const { deps, calls } = makeDeps({ capable: false });
    const report = await runApprovedCandidateRevealContactSync('cand-1', deps);
    assert.equal(report.outcome, 'projection_unavailable');
    assert.deepEqual(calls.project, []);
  });
});

describe('fuera de alcance: no toca nada', () => {
  for (const status of ['pending_review', 'rejected', null]) {
    it(`candidato ${status} ⇒ not_approved`, async () => {
      const { deps, calls } = makeDeps({ candidate: candidate({ status }) });
      const report = await runApprovedCandidateRevealContactSync('cand-1', deps);
      assert.equal(report.outcome, 'not_approved');
      assert.deepEqual(calls.project, []);
    });
  }

  it('aprobado sin contacto oficial ⇒ no_official_contact', async () => {
    const { deps, calls } = makeDeps({ candidate: candidate({ matchedContactsId: null }) });
    assert.equal((await runApprovedCandidateRevealContactSync('cand-1', deps)).outcome, 'no_official_contact');
    assert.deepEqual(calls.project, []);
  });

  it('sin quien pidió el reveal ⇒ no_actor', async () => {
    const { deps, calls } = makeDeps({ candidate: candidate({ revealedBy: null }) });
    assert.equal((await runApprovedCandidateRevealContactSync('cand-1', deps)).outcome, 'no_actor');
    assert.deepEqual(calls.project, []);
  });

  it('candidato ilegible ⇒ candidate_unavailable', async () => {
    const { deps } = makeDeps({ candidate: null });
    assert.equal((await runApprovedCandidateRevealContactSync('cand-1', deps)).outcome, 'candidate_unavailable');
  });
});
