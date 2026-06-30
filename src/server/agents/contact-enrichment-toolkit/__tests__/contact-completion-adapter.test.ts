/**
 * Tests — Contact Completion Adapter (Agente 2A, Hito 17A.3C)
 *
 * Funciones puras + adapter con inyección de matchPerson (sin red, sin DB).
 * Verifica: filtro accionable, merge seguro, selección con tope y completado
 * vía people/match mockeado. NUNCA ejecuta Apollo real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  completeContactWithApollo,
  isActionableContactCandidate,
  mergeCompletedContactData,
  selectCandidatesForCompletion,
  MAX_COMPLETION_CANDIDATES,
  type ClassifiedCandidate,
} from '../contact-completion-adapter';
import type { NormalizedApolloContact } from '../contact-normalizer';
import { classifyContactRelevance } from '../contact-relevance-classifier';
import type { ApolloPerson, MatchPersonParams, ApolloEnrichResult } from '@/server/integrations/apollo-client';

// ── Builders ────────────────────────────────────────────────────

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    fullName: 'Ana Pérez',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: null,
    email: null,
    phone: null,
    source: 'apollo',
    sourceContactId: 'apollo-1',
    confidence: 0.6,
    enrichmentMetadata: { provider: 'apollo' },
    ...overrides,
  };
}

function classified(c: NormalizedApolloContact): ClassifiedCandidate {
  return {
    contact: c,
    relevance: classifyContactRelevance({
      fullName: c.fullName,
      firstName: c.firstName,
      lastName: c.lastName,
      title: c.title,
      email: c.email,
      linkedinUrl: c.linkedinUrl,
      phone: c.phone,
      seniority: c.seniority,
    }),
  };
}

function matchPerson(person: ApolloPerson | null): (p: MatchPersonParams) => Promise<ApolloEnrichResult<ApolloPerson>> {
  return async () => ({ success: true, data: person ?? undefined });
}

// ── isActionableContactCandidate ────────────────────────────────

describe('isActionableContactCandidate', () => {
  it('nombre completo + title + LinkedIn → accionable', () => {
    const c = contact({ linkedinUrl: 'https://linkedin.com/in/ana' });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });

  it('nombre completo + title + email → accionable', () => {
    const c = contact({ email: 'ana@corp.com' });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });

  it('nombre completo + title sin canal → NO accionable', () => {
    const c = contact({ email: null, linkedinUrl: null, phone: null });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), false);
  });

  it('nombre de un solo token sin canal → NO accionable', () => {
    const c = contact({ fullName: 'Mauricio', firstName: 'Mauricio', lastName: null, email: null, linkedinUrl: null });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), false);
  });

  it('primer nombre (un token) + title + email + relevancia alta → accionable', () => {
    const c = contact({ fullName: 'Mauricio', firstName: 'Mauricio', lastName: null, email: 'm@corp.com' });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });

  it('primer nombre + title + email + relevancia baja → NO accionable', () => {
    const c = contact({ fullName: 'Mauricio', firstName: 'Mauricio', lastName: null, email: 'm@corp.com' });
    assert.equal(isActionableContactCandidate(c, 'low_relevance'), false);
  });

  it('sin title → NO accionable', () => {
    const c = contact({ title: null, email: 'ana@corp.com', enrichmentMetadata: {} });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), false);
  });

  // Regla 17A.6C: teléfono es canal accionable válido aunque reveal automático esté desactivado
  it('nombre completo + title + phone (sin email/linkedin) → accionable (phone es canal válido)', () => {
    const c = contact({ phone: '+57 300 000 0000', email: null, linkedinUrl: null });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });

  it('nombre completo + title sin email, sin phone, sin linkedin → NO pasa a revisión', () => {
    const c = contact({ email: null, phone: null, linkedinUrl: null });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), false);
  });
});

// ── mergeCompletedContactData ───────────────────────────────────

describe('mergeCompletedContactData', () => {
  it('no pisa datos base buenos con null del completado', () => {
    const base = contact({ email: 'base@corp.com', title: 'HR Director' });
    const completed = contact({ email: null, title: null, linkedinUrl: 'https://linkedin.com/in/ana' });
    const merged = mergeCompletedContactData(base, completed);
    assert.equal(merged.email, 'base@corp.com');
    assert.equal(merged.title, 'HR Director');
    assert.equal(merged.linkedinUrl, 'https://linkedin.com/in/ana');
  });

  it('rellena huecos del base desde el completado', () => {
    const base = contact({ email: null, linkedinUrl: null });
    const completed = contact({ email: 'new@corp.com', linkedinUrl: 'https://linkedin.com/in/ana' });
    const merged = mergeCompletedContactData(base, completed);
    assert.equal(merged.email, 'new@corp.com');
    assert.equal(merged.linkedinUrl, 'https://linkedin.com/in/ana');
  });

  it('adopta full_name completo del match sobre un primer nombre', () => {
    const base = contact({ fullName: 'Mauricio', firstName: 'Mauricio', lastName: null });
    const completed = contact({ fullName: 'Mauricio Gómez', firstName: 'Mauricio', lastName: 'Gómez' });
    const merged = mergeCompletedContactData(base, completed);
    assert.equal(merged.fullName, 'Mauricio Gómez');
    assert.equal(merged.lastName, 'Gómez');
  });

  it('conserva sourceContactId del base', () => {
    const base = contact({ sourceContactId: 'base-id' });
    const completed = contact({ sourceContactId: 'other-id' });
    assert.equal(mergeCompletedContactData(base, completed).sourceContactId, 'base-id');
  });
});

// ── selectCandidatesForCompletion ───────────────────────────────

describe('selectCandidatesForCompletion', () => {
  it('solo candidatos revisables (high/medium) son elegibles', () => {
    const hr = classified(contact({ email: 'hr@corp.com' })); // high
    const noise = classified(contact({ title: 'Software Engineer', email: 'dev@corp.com' })); // not_relevant
    const selected = selectCandidatesForCompletion([hr, noise]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].relevance.relevanceStatus, 'high_relevance');
  });

  it('limita a MAX_COMPLETION_CANDIDATES candidatos', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      classified(contact({ sourceContactId: `id-${i}`, email: `hr${i}@corp.com` })),
    );
    const selected = selectCandidatesForCompletion(items);
    assert.equal(selected.length, MAX_COMPLETION_CANDIDATES);
  });

  it('prioriza high_relevance sobre medium_relevance', () => {
    const high = classified(contact({ title: 'HR Manager', email: 'hr@corp.com' }));
    const medium = classified(contact({ title: 'CEO', email: 'ceo@corp.com' }));
    const selected = selectCandidatesForCompletion([medium, high], 1);
    assert.equal(selected[0].relevance.relevanceStatus, 'high_relevance');
  });
});

// ── completeContactWithApollo ───────────────────────────────────

describe('completeContactWithApollo', () => {
  it('candidato ya accionable → skipped sin llamar a Apollo', async () => {
    let called = false;
    const base = contact({ email: 'ana@corp.com' }); // accionable
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => {
          called = true;
          return { success: true };
        },
      },
    );
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'candidate_already_actionable');
    assert.equal(called, false, 'no debe consumir crédito si ya es accionable');
  });

  it('completa email vía match → status completed e insertable', async () => {
    const base = contact({ email: null, linkedinUrl: null }); // sin canal
    const matched: ApolloPerson = {
      id: 'apollo-1',
      first_name: 'Ana',
      last_name: 'Pérez',
      title: 'HR Manager',
      email: 'ana@corp.com',
      linkedin_url: null,
      phone_numbers: [],
      organization: null,
    };
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: matchPerson(matched) },
    );
    assert.equal(res.status, 'completed');
    assert.equal(res.contact.email, 'ana@corp.com');
    assert.ok(res.completedFields.includes('email'));
    assert.equal(res.isActionableAfter, true);
    assert.equal(res.providerUsage?.creditsUsed, 1);
  });

  it('completa LinkedIn vía match → insertable', async () => {
    const base = contact({ email: null, linkedinUrl: null });
    const matched: ApolloPerson = {
      id: 'apollo-1',
      first_name: 'Ana',
      last_name: 'Pérez',
      title: 'HR Manager',
      email: null,
      linkedin_url: 'https://linkedin.com/in/ana',
      phone_numbers: [],
      organization: null,
    };
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: matchPerson(matched) },
    );
    assert.equal(res.status, 'completed');
    assert.ok(res.completedFields.includes('linkedin_url'));
    assert.equal(res.isActionableAfter, true);
  });

  it('match falla → status error, no rompe (no lanza)', async () => {
    const base = contact({ email: null, linkedinUrl: null });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => ({
          success: false,
          error: { error: 'HTTP_500', message: 'boom' },
        }),
      },
    );
    assert.equal(res.status, 'error');
    assert.equal(res.isActionableAfter, false);
  });

  it('match sin datos → skipped (no_match_data)', async () => {
    const base = contact({ email: null, linkedinUrl: null });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: matchPerson(null) },
    );
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'no_match_data');
  });

  it('sin identidad mínima → skipped sin llamar a Apollo', async () => {
    let called = false;
    const base = contact({ firstName: null, lastName: null, email: null, linkedinUrl: null });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: '', companyDomain: null, relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => {
          called = true;
          return { success: true };
        },
      },
    );
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'insufficient_input_for_match');
    assert.equal(called, false);
  });
});
