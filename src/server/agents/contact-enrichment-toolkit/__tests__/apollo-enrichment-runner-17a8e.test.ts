/**
 * Tests — Apollo Enrichment Runner (Hito 17A.8E)
 *
 * Verifica que enrichment_metadata.completion.had_actionable_channel y
 * post_completion reflejan el estado real DESPUÉS de people/match, no antes.
 *
 * Caso central del hito: candidato insufficient_data que completion convierte
 * en accionable (agrega linkedin_url o email) debe quedar con:
 *   completion.had_actionable_channel = true
 *   post_completion.is_actionable = true
 *   post_completion.actionable_channels = ['linkedin_url' | 'email']
 *   post_completion.became_reviewable_after_completion = true
 *   post_completion.pre_completion_status = 'insufficient_data'
 *
 * También verifica que candidatos reviewable normales tienen
 *   post_completion.became_reviewable_after_completion = false
 * y que contacts.metadata hereda post_completion al aprobar.
 *
 * NUNCA ejecuta Apollo real. Todas las dependencias se inyectan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentApolloRun } from '../apollo-enrichment-runner';
import type {
  ContactEnrichmentRunRow,
  ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import type { CompleteContactResult } from '../contact-completion-adapter';
import type { DeduplicatedContact } from '../contact-deduplicator';
import type { WriteCandidatesResult } from '../contact-candidate-writer';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

import {
  buildContactTraceMetadata,
  buildContactInsertPayload,
  type CandidateRecord,
} from '@/modules/contact-enrichment/candidate-review-core';

// ── Builders ──────────────────────────────────────────────────────

function makeRun(overrides: Partial<ContactEnrichmentRunRow> = {}): ContactEnrichmentRunRow {
  return {
    id: 'run-1',
    agent_run_id: null,
    company_name: 'Siesa',
    company_domain: 'siesa.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: {
      existing_contacts_snapshot: {
        combined: {
          existing_emails: [],
          existing_linkedin_urls: [],
          existing_contact_names: [],
        },
      },
    },
    ...overrides,
  };
}

const NOOP_DEPS: Partial<ApolloEnrichmentRunnerDeps> = {
  loadRun: async () => makeRun(),
  updateRun: async () => {},
  loadApolloUnitCost: async () => 0,
  logUsage: async () => true,
  createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
  finishStep: async () => true,
  evaluateBudget: async () => ({
    mode: 'alert_only' as const,
    provider_key: 'apollo',
    allowed: true,
    would_block_in_enforcement: false,
    scope_applied: 'unknown' as const,
    matched_rule_id: null,
    on_exceed: null,
    reason: null,
    consumed_credits: 0,
    projected_credits: 5,
    remaining_credits: null,
    technical_error: undefined,
  }),
};

/** Apollo devuelve un perfil con los campos dados. */
function apolloWith(overrides: {
  id?: string;
  firstName?: string;
  lastName?: string | null;
  title?: string;
  seniority?: string;
  linkedinUrl?: string | null;
  email?: string | null;
  phone?: string | null;
}): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people: [
      {
        id: overrides.id ?? 'apollo-id-1',
        first_name: overrides.firstName ?? 'Alba',
        last_name: overrides.lastName !== undefined ? overrides.lastName : 'Valencia',
        title: overrides.title ?? 'Gerente de Recursos Humanos',
        seniority: overrides.seniority ?? 'manager',
        departments: ['human_resources'],
        city: null,
        state: null,
        country: 'Colombia',
        linkedin_url: overrides.linkedinUrl ?? null,
        email: overrides.email ?? null,
        phone_numbers: overrides.phone ? [{ sanitized_number: overrides.phone, type: 'work_hq' }] : [],
        email_status: null,
        organization: { id: 'org-siesa', name: 'Siesa', website_url: 'https://siesa.com' },
        headline: null,
      },
    ],
    providerUsage: { provider: 'apollo' as const, operation: 'people_search' as const, rawResultsCount: 1, creditsUsed: 1 },
    attempts: [{ attempt: 'domain_hr_seniority', filters: 'domain+HR', rawResultsCount: 1 }],
    chosenAttempt: 'domain_hr_seniority',
    organizationResolution: undefined,
    searchGuardrail: undefined,
  };
}

/** Completion devuelve linkedin_url al candidato dado. */
function completionAddsLinkedin(linkedinUrl: string): (input: { candidate: { sourceContactId: string | null } }) => Promise<CompleteContactResult> {
  return async (input) => {
    const c = input.candidate as Record<string, unknown>;
    return {
      status: 'completed',
      contact: {
        ...(c as object),
        linkedinUrl,
        email: null,
        phone: null,
      } as CompleteContactResult['contact'],
      completedFields: ['linkedin_url'],
      wasActionableBefore: false,
      isActionableAfter: true,
      providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
    };
  };
}

/** Completion devuelve email al candidato dado. */
function completionAddsEmail(email: string): (input: unknown) => Promise<CompleteContactResult> {
  return async (input) => {
    const c = (input as { candidate: Record<string, unknown> }).candidate;
    return {
      status: 'completed',
      contact: {
        ...c,
        email,
        linkedinUrl: null,
        phone: null,
      } as CompleteContactResult['contact'],
      completedFields: ['email'],
      wasActionableBefore: false,
      isActionableAfter: true,
      providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
    };
  };
}

/** Recolecta los candidatos escritos en la inserción. */
function captureWriter(): {
  written: DeduplicatedContact[];
  dep: ApolloEnrichmentRunnerDeps['writeCandidates'];
} {
  const written: DeduplicatedContact[] = [];
  return {
    written,
    dep: async (_runId, candidates) => {
      written.push(...candidates);
      return { inserted: candidates.length, skippedNoName: 0 } satisfies WriteCandidatesResult;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────

// 1. insufficient_data + completion agrega linkedin_url
//    → had_actionable_channel = true, post_completion.is_actionable = true
describe('17A.8E — insufficient_data + completion agrega linkedin_url', () => {
  it('had_actionable_channel = true y post_completion.is_actionable = true', async () => {
    const { written, dep } = captureWriter();

    // Perfil sin linkedin/email/phone → insufficient_data. Con señal HR y Apollo ID.
    await executeContactEnrichmentApolloRun('run-1', null, {
      ...NOOP_DEPS,
      loadRun: async () => makeRun(),
      runApollo: async () =>
        apolloWith({
          title: 'Gerente de Recursos Humanos',
          seniority: 'manager',
          lastName: null,    // nombre incompleto → insufficient_data → selectedInsufficients path
          linkedinUrl: null,
          email: null,
          phone: null,
        }),
      completeContact: completionAddsLinkedin('https://linkedin.com/in/alba-valencia') as ApolloEnrichmentRunnerDeps['completeContact'],
      writeCandidates: dep,
    });

    assert.ok(written.length > 0, 'debe haber al menos un candidato insertado');
    const meta = written[0].enrichmentMetadata as Record<string, unknown>;

    // Completion
    const completion = meta.completion as Record<string, unknown>;
    assert.ok(completion, 'enrichment_metadata.completion debe existir');
    assert.equal(completion.had_actionable_channel, true, 'had_actionable_channel debe ser true');
    assert.equal(completion.status, 'completed');
    assert.ok(
      (completion.completed_fields as string[]).includes('linkedin_url'),
      'completed_fields debe incluir linkedin_url',
    );

    // post_completion
    const post = meta.post_completion as Record<string, unknown>;
    assert.ok(post, 'enrichment_metadata.post_completion debe existir');
    assert.equal(post.is_actionable, true);
    assert.ok(
      (post.actionable_channels as string[]).includes('linkedin_url'),
      'actionable_channels debe incluir linkedin_url',
    );
    assert.equal(post.became_reviewable_after_completion, true);
  });
});

// 2. insufficient_data + completion agrega email
//    → had_actionable_channel = true
describe('17A.8E — insufficient_data + completion agrega email', () => {
  it('had_actionable_channel = true y actionable_channels incluye email', async () => {
    const { written, dep } = captureWriter();

    await executeContactEnrichmentApolloRun('run-1', null, {
      ...NOOP_DEPS,
      loadRun: async () => makeRun(),
      runApollo: async () =>
        apolloWith({
          title: 'People Operations Manager',
          seniority: 'manager',
          lastName: null,    // nombre incompleto → insufficient_data → selectedInsufficients path
          linkedinUrl: null,
          email: null,
          phone: null,
        }),
      completeContact: completionAddsEmail('alba@siesa.com') as ApolloEnrichmentRunnerDeps['completeContact'],
      writeCandidates: dep,
    });

    assert.ok(written.length > 0, 'debe haber al menos un candidato insertado');
    const meta = written[0].enrichmentMetadata as Record<string, unknown>;
    const completion = meta.completion as Record<string, unknown>;
    assert.equal(completion.had_actionable_channel, true);
    const post = meta.post_completion as Record<string, unknown>;
    assert.ok((post.actionable_channels as string[]).includes('email'));
    assert.equal(post.became_reviewable_after_completion, true);
  });
});

// 3. pre_completion_status = 'insufficient_data' se preserva en post_completion
describe('17A.8E — pre_completion_status preservado', () => {
  it('post_completion.pre_completion_status = insufficient_data para perfiles insuficientes', async () => {
    const { written, dep } = captureWriter();

    await executeContactEnrichmentApolloRun('run-1', null, {
      ...NOOP_DEPS,
      loadRun: async () => makeRun(),
      runApollo: async () =>
        apolloWith({
          title: 'Gerente de Recursos Humanos',  // 'RR.HH.' no matchea keyword 'rrhh'; usar título con match garantizado
          seniority: 'manager',
          lastName: null,    // nombre incompleto → insufficient_data → selectedInsufficients path
          linkedinUrl: null,
          email: null,
          phone: null,
        }),
      completeContact: completionAddsLinkedin('https://linkedin.com/in/alba') as ApolloEnrichmentRunnerDeps['completeContact'],
      writeCandidates: dep,
    });

    assert.ok(written.length > 0);
    const meta = written[0].enrichmentMetadata as Record<string, unknown>;
    const post = meta.post_completion as Record<string, unknown>;
    assert.equal(
      post.pre_completion_status,
      'insufficient_data',
      'pre_completion_status debe conservar el veredicto original',
    );
  });
});

// 4. Perfil reviewable (high/medium) → became_reviewable_after_completion = false
describe('17A.8E — perfil reviewable normal tiene became_reviewable_after_completion = false', () => {
  it('post_completion.became_reviewable_after_completion = false para perfiles ya revisables', async () => {
    const { written, dep } = captureWriter();

    // Perfil con linkedin ya presente → high_relevance, ya revisable
    await executeContactEnrichmentApolloRun('run-1', null, {
      ...NOOP_DEPS,
      loadRun: async () => makeRun(),
      runApollo: async () =>
        apolloWith({
          title: 'HR Manager',
          seniority: 'manager',
          linkedinUrl: 'https://linkedin.com/in/alba-valencia',
          email: null,
          phone: null,
        }),
      // completion skipped (candidato ya accionable)
      completeContact: async (input) => ({
        status: 'skipped',
        contact: input.candidate,
        completedFields: [],
        wasActionableBefore: true,
        isActionableAfter: true,
        reason: 'candidate_already_actionable',
      }),
      writeCandidates: dep,
    });

    assert.ok(written.length > 0, 'debe haber al menos un candidato insertado');
    const meta = written[0].enrichmentMetadata as Record<string, unknown>;
    const post = meta.post_completion as Record<string, unknown>;
    assert.ok(post, 'post_completion debe existir para candidatos reviewable normales');
    assert.equal(post.became_reviewable_after_completion, false);
    assert.equal(post.is_actionable, true);
  });
});

// 5. buildContactTraceMetadata hereda post_completion al aprobar candidato
describe('17A.8E — candidate-review-core hereda post_completion al construir contacto', () => {
  it('contacts.metadata.post_completion refleja el estado post-completion del candidato', () => {
    const candidate: CandidateRecord = {
      id: 'cand-1',
      status: 'approved',
      full_name: 'Alba Valencia',
      first_name: 'Alba',
      last_name: 'Valencia',
      title: 'Gerente de RR.HH.',
      seniority: 'manager',
      department: 'human_resources',
      email: null,
      phone: null,
      linkedin_url: 'https://linkedin.com/in/alba-valencia',
      source: 'apollo',
      enrichment_run_id: 'run-1',
      account_id: 'acc-1',
      enrichment_metadata: {
        relevance: {
          status: 'insufficient_data',
          rejection_reasons: ['Nombre incompleto sin canal de contacto'],
        },
        completion: {
          status: 'completed',
          provider: 'apollo',
          operation: 'person_match',
          completed_fields: ['linkedin_url', 'full_name'],
          had_actionable_channel: true,
        },
        post_completion: {
          is_actionable: true,
          actionable_channels: ['linkedin_url'],
          became_reviewable_after_completion: true,
          pre_completion_status: 'insufficient_data',
        },
      },
    };

    const trace = buildContactTraceMetadata(candidate);

    // completion presente y correcto
    const completion = trace.completion as Record<string, unknown>;
    assert.ok(completion, 'trace.completion debe existir');
    assert.equal(completion.had_actionable_channel, true);

    // post_completion heredado correctamente
    const post = trace.post_completion as Record<string, unknown>;
    assert.ok(post, 'trace.post_completion debe existir');
    assert.equal(post.is_actionable, true);
    assert.ok((post.actionable_channels as string[]).includes('linkedin_url'));
    assert.equal(post.became_reviewable_after_completion, true);
    assert.equal(post.pre_completion_status, 'insufficient_data');
  });

  it('contacts.metadata.post_completion = null cuando candidato no tiene post_completion (retrocompatibilidad)', () => {
    const candidate: CandidateRecord = {
      id: 'cand-old',
      status: 'approved',
      full_name: 'Luis García',
      first_name: 'Luis',
      last_name: 'García',
      title: 'HR Director',
      seniority: 'director',
      department: null,
      email: 'luis@corp.com',
      phone: null,
      linkedin_url: null,
      source: 'apollo',
      enrichment_run_id: 'run-old',
      account_id: 'acc-1',
      enrichment_metadata: {
        // Sin post_completion (candidato insertado antes del hito 17A.8E)
        completion: {
          status: 'completed',
          provider: 'apollo',
          operation: 'person_match',
          completed_fields: ['email'],
          had_actionable_channel: true,
        },
      },
    };

    const trace = buildContactTraceMetadata(candidate);
    assert.equal(trace.post_completion, null, 'post_completion debe ser null para candidatos legacy');
  });
});

// 6. buildContactInsertPayload incluye post_completion en contacts.metadata
describe('17A.8E — buildContactInsertPayload incluye post_completion en metadata del contacto', () => {
  it('metadata del contacto creado tiene completion.had_actionable_channel = true y post_completion correcto', () => {
    const candidate: CandidateRecord = {
      id: 'cand-2',
      status: 'approved',
      full_name: 'Alba Lucia Valencia Romero',
      first_name: 'Alba',
      last_name: 'Lucia Valencia Romero',
      title: 'Gerente de RR.HH.',
      seniority: 'manager',
      department: 'human_resources',
      email: null,
      phone: null,
      linkedin_url: 'http://www.linkedin.com/in/alba-lucia-valencia-romero-32a31435',
      source: 'apollo',
      enrichment_run_id: 'run-siesa',
      account_id: 'acc-siesa',
      enrichment_metadata: {
        relevance: { status: 'insufficient_data' },
        completion: {
          status: 'completed',
          provider: 'apollo',
          operation: 'person_match',
          completed_fields: ['linkedin_url', 'full_name'],
          had_actionable_channel: true,
        },
        post_completion: {
          is_actionable: true,
          actionable_channels: ['linkedin_url'],
          became_reviewable_after_completion: true,
          pre_completion_status: 'insufficient_data',
        },
      },
    };

    const payload = buildContactInsertPayload({
      candidate,
      accountId: 'acc-siesa',
      internalUserId: 'user-1',
    });

    const meta = payload.metadata as Record<string, unknown>;
    assert.equal(meta.source, 'contact_enrichment_candidate');

    const completion = meta.completion as Record<string, unknown>;
    assert.ok(completion, 'metadata.completion debe existir en el contacto creado');
    assert.equal(completion.had_actionable_channel, true, 'had_actionable_channel no debe ser false');

    const post = meta.post_completion as Record<string, unknown>;
    assert.ok(post, 'metadata.post_completion debe existir en el contacto creado');
    assert.equal(post.is_actionable, true);
    assert.equal(post.became_reviewable_after_completion, true);
    assert.equal(post.pre_completion_status, 'insufficient_data');
  });
});
