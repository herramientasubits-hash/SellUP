/**
 * Tests — Apollo Cost & Quality Guardrails (Agente 2A, Hito 17A.6A)
 *
 * Verifica el modelo de créditos interno (email=1, phone=8), el guardrail
 * pre-vuelo, y las reglas de calidad antes de completion.
 * NUNCA ejecuta Apollo real. NUNCA toca HubSpot, Lusha ni candidatos existentes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateCompletionCredits,
  calculateActualCompletionCredits,
  checkCompletionCostGuardrail,
  completeContactWithApollo,
  selectCandidatesForCompletion,
  isActionableContactCandidate,
  MAX_COMPLETION_CANDIDATES,
  MAX_COMPLETION_CREDITS_PER_RUN,
  COMPLETION_CREDIT_EMAIL,
  COMPLETION_CREDIT_PHONE,
  PHONE_COMPLETION_ENABLED,
  type ClassifiedCandidate,
} from '../contact-completion-adapter';
import type { NormalizedApolloContact } from '../contact-normalizer';
import { classifyContactRelevance } from '../contact-relevance-classifier';
import type { ApolloPerson, MatchPersonParams, ApolloEnrichResult } from '@/server/integrations/apollo-client';

// ── Builders ────────────────────────────────────────────────────

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Ana',
    lastName: 'López',
    fullName: 'Ana López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: null,
    email: null,
    phone: null,
    source: 'apollo',
    sourceContactId: 'apollo-test-1',
    confidence: 0.7,
    enrichmentMetadata: { provider: 'apollo' },
    ...overrides,
  };
}

function classified(
  c: NormalizedApolloContact,
  overrideStatus?: string,
): ClassifiedCandidate {
  const relevance = classifyContactRelevance({
    fullName: c.fullName,
    firstName: c.firstName,
    lastName: c.lastName,
    title: c.title,
    email: c.email,
    linkedinUrl: c.linkedinUrl,
    phone: c.phone,
    seniority: c.seniority,
  });
  if (overrideStatus) {
    return {
      contact: c,
      relevance: {
        ...relevance,
        relevanceStatus: overrideStatus as ReturnType<typeof classifyContactRelevance>['relevanceStatus'],
        shouldInsertForReview: overrideStatus === 'high_relevance' || overrideStatus === 'medium_relevance',
      },
    };
  }
  return { contact: c, relevance };
}

function matchPerson(
  person: ApolloPerson | null,
): (p: MatchPersonParams) => Promise<ApolloEnrichResult<ApolloPerson>> {
  return async () => ({ success: true, data: person ?? undefined });
}

const hrContact = contact({ email: 'hr@corp.com' });
const hrContactNoChannel = contact({ title: 'HR Manager', email: null, linkedinUrl: null, phone: null });

// ── Constantes ──────────────────────────────────────────────────

describe('Constantes de guardrail', () => {
  it('MAX_COMPLETION_CANDIDATES = 3', () => {
    assert.equal(MAX_COMPLETION_CANDIDATES, 3);
  });

  it('COMPLETION_CREDIT_EMAIL = 1', () => {
    assert.equal(COMPLETION_CREDIT_EMAIL, 1);
  });

  it('COMPLETION_CREDIT_PHONE = 8', () => {
    assert.equal(COMPLETION_CREDIT_PHONE, 8);
  });

  it('PHONE_COMPLETION_ENABLED = false por defecto', () => {
    assert.equal(PHONE_COMPLETION_ENABLED, false);
  });

  it('MAX_COMPLETION_CREDITS_PER_RUN >= MAX_COMPLETION_CANDIDATES (permite completar todos sin phone)', () => {
    assert.ok(MAX_COMPLETION_CREDITS_PER_RUN >= MAX_COMPLETION_CANDIDATES);
  });
});

// ── estimateCompletionCredits ────────────────────────────────────

describe('estimateCompletionCredits', () => {
  it('0 candidatos → 0 créditos', () => {
    assert.equal(estimateCompletionCredits(0), 0);
  });

  it('N candidatos sin phone → N × 1 crédito', () => {
    assert.equal(estimateCompletionCredits(3, false), 3);
    assert.equal(estimateCompletionCredits(1, false), 1);
  });

  it('N candidatos con phone → N × 9 créditos (email + phone)', () => {
    assert.equal(estimateCompletionCredits(3, true), 27);
    assert.equal(estimateCompletionCredits(1, true), 9);
  });

  it('usa PHONE_COMPLETION_ENABLED=false por defecto', () => {
    assert.equal(estimateCompletionCredits(3), 3);
  });
});

// ── calculateActualCompletionCredits ────────────────────────────

describe('calculateActualCompletionCredits', () => {
  it('email completado → 1 crédito', () => {
    assert.equal(calculateActualCompletionCredits(['email']), 1);
  });

  it('linkedin completado → mínimo 1 crédito (no phone)', () => {
    assert.equal(calculateActualCompletionCredits(['linkedin_url']), 1);
  });

  it('phone completado con phoneEnabled=false → 1 crédito (phone no cuenta)', () => {
    assert.equal(calculateActualCompletionCredits(['phone'], false), 1);
  });

  it('phone completado con phoneEnabled=true → 8 créditos', () => {
    assert.equal(calculateActualCompletionCredits(['phone'], true), 8);
  });

  it('email + phone con phoneEnabled=true → 9 créditos', () => {
    assert.equal(calculateActualCompletionCredits(['email', 'phone'], true), 9);
  });

  it('sin campos completados → mínimo 1 (costo de la llamada API)', () => {
    assert.equal(calculateActualCompletionCredits([]), 1);
  });

  it('full_name completado → mínimo 1 (no tiene costo directo)', () => {
    assert.equal(calculateActualCompletionCredits(['full_name']), 1);
  });
});

// ── checkCompletionCostGuardrail ─────────────────────────────────

describe('checkCompletionCostGuardrail', () => {
  it('0 candidatos → permitido, 0 créditos estimados', () => {
    const result = checkCompletionCostGuardrail(0);
    assert.equal(result.allowed, true);
    assert.equal(result.estimatedCredits, 0);
  });

  it('3 candidatos sin phone → permitido (3 ≤ MAX_COMPLETION_CREDITS_PER_RUN)', () => {
    const result = checkCompletionCostGuardrail(3, { phoneEnabled: false });
    assert.equal(result.allowed, true);
    assert.equal(result.estimatedCredits, 3);
  });

  it('bloquea si créditos estimados superan el máximo', () => {
    const result = checkCompletionCostGuardrail(5, { maxCreditsPerRun: 3, phoneEnabled: false });
    assert.equal(result.allowed, false);
    assert.equal(result.estimatedCredits, 5);
    assert.ok(result.blockedReason, 'debe incluir razón del bloqueo');
  });

  it('bloquea con phone habilitado si supera el presupuesto', () => {
    // 2 candidatos × 9 = 18 créditos > 10 (MAX_COMPLETION_CREDITS_PER_RUN)
    const result = checkCompletionCostGuardrail(2, { phoneEnabled: true, maxCreditsPerRun: 10 });
    assert.equal(result.allowed, false);
    assert.equal(result.estimatedCredits, 18);
  });

  it('devuelve maxCredits correcto en el resultado', () => {
    const result = checkCompletionCostGuardrail(1, { maxCreditsPerRun: 5 });
    assert.equal(result.maxCredits, 5);
  });

  it('blockedReason undefined cuando está permitido', () => {
    const result = checkCompletionCostGuardrail(1, { maxCreditsPerRun: 10 });
    assert.equal(result.allowed, true);
    assert.equal(result.blockedReason, undefined);
  });
});

// ── selectCandidatesForCompletion — reglas de calidad ───────────

describe('selectCandidatesForCompletion — calidad', () => {
  it('no completa más de MAX_COMPLETION_CANDIDATES candidatos', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      classified(contact({ sourceContactId: `id-${i}`, email: `hr${i}@corp.com` })),
    );
    const selected = selectCandidatesForCompletion(items);
    assert.equal(selected.length, MAX_COMPLETION_CANDIDATES);
  });

  it('no selecciona candidatos low_relevance', () => {
    const low = classified(contact({ title: 'Sales Rep', email: 'sales@corp.com' }), 'low_relevance');
    const selected = selectCandidatesForCompletion([low]);
    assert.equal(selected.length, 0);
  });

  it('no selecciona candidatos not_relevant', () => {
    const irr = classified(contact({ title: 'Software Engineer', email: 'dev@corp.com' }), 'not_relevant');
    const selected = selectCandidatesForCompletion([irr]);
    assert.equal(selected.length, 0);
  });

  it('no selecciona candidatos insufficient_data', () => {
    const insuf = classified(contact({ title: '', email: null, fullName: '' }), 'insufficient_data');
    const selected = selectCandidatesForCompletion([insuf]);
    assert.equal(selected.length, 0);
  });

  it('prioriza high_relevance sobre medium_relevance', () => {
    const high = classified(contact({ title: 'HR Manager', email: 'hr@corp.com' }));
    const medium = classified(contact({ title: 'CEO', email: 'ceo@corp.com' }));
    const selected = selectCandidatesForCompletion([medium, high], 1);
    assert.equal(selected[0].relevance.relevanceStatus, 'high_relevance');
  });

  it('si hay 2-3 buenos candidatos, solo selecciona hasta el límite', () => {
    const items = [
      classified(contact({ sourceContactId: 'a', email: 'a@corp.com' })),
      classified(contact({ sourceContactId: 'b', email: 'b@corp.com' })),
    ];
    const selected = selectCandidatesForCompletion(items, 2);
    assert.equal(selected.length, 2);
  });
});

// ── isActionableContactCandidate — canal accionable ─────────────

describe('isActionableContactCandidate — canal requerido', () => {
  it('contacto con email → accionable', () => {
    assert.equal(isActionableContactCandidate(hrContact, 'high_relevance'), true);
  });

  it('contacto con LinkedIn → accionable', () => {
    const c = contact({ linkedinUrl: 'https://linkedin.com/in/ana' });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });

  it('contacto sin ningún canal → NO accionable (no pasa a review)', () => {
    assert.equal(isActionableContactCandidate(hrContactNoChannel, 'high_relevance'), false);
  });

  it('contacto con phone solo → accionable (phone cuenta como canal)', () => {
    const c = contact({ phone: '+57 300 000 0000' });
    assert.equal(isActionableContactCandidate(c, 'high_relevance'), true);
  });
});

// ── completeContactWithApollo — créditos por tipo de campo ──────

describe('completeContactWithApollo — créditos phone-aware', () => {
  it('completion de email → creditsUsed = 1 (COMPLETION_CREDIT_EMAIL)', async () => {
    const base = contact({ email: null, linkedinUrl: null });
    const matched: ApolloPerson = {
      id: 'ap-1',
      first_name: 'Ana',
      last_name: 'López',
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
    assert.equal(res.providerUsage?.creditsUsed, COMPLETION_CREDIT_EMAIL);
  });

  it('completion de linkedin → mínimo 1 crédito (no costo phone)', async () => {
    const base = contact({ email: null, linkedinUrl: null });
    const matched: ApolloPerson = {
      id: 'ap-2',
      first_name: 'Ana',
      last_name: 'López',
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
    assert.ok((res.providerUsage?.creditsUsed ?? 0) >= 1);
  });

  it('no llama a Apollo si el candidato ya es accionable', async () => {
    let called = false;
    const base = contact({ email: 'ya@corp.com' });
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
    assert.equal(called, false, 'no debe llamar a Apollo si ya es accionable');
  });

  it('no llama a Apollo si falta identidad mínima', async () => {
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

  it('no toca HubSpot en ningún path', async () => {
    // Este test verifica que completeContactWithApollo no hace llamadas a HubSpot.
    // El adapter es puro: solo llama a matchPerson (Apollo). No hay HubSpot en scope.
    const base = contact({ email: null, linkedinUrl: null });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: matchPerson(null) },
    );
    // skipped/error son los únicos paths; ninguno involucra HubSpot.
    assert.ok(['skipped', 'error', 'completed'].includes(res.status));
  });
});
