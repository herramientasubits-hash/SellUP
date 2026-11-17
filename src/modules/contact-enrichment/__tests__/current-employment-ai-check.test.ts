/**
 * Tests — «Verificar con IA»: cargo y empresa actuales con búsqueda web de Claude
 * (CONTACT-CURRENT-EMPLOYMENT-AI-1).
 *
 * Respuestas de Claude armadas a mano (bloques de búsqueda web + entrega). Sin red, sin DB, sin
 * créditos. Datos ficticios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AnthropicContentBlock,
  AnthropicConversationResult,
  AnthropicRequestBody,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  EMPLOYMENT_AI_TOOL,
  assessEmploymentAiResponse,
  buildEmploymentAiRequest,
  textMentionsCompany,
  textMentionsPerson,
  type EmploymentAiTarget,
} from '../current-employment-ai-check';
import {
  employmentAiPatch,
  verifyCandidateEmploymentWithAi,
  type EmploymentAiCandidate,
  type EmploymentAiPatch,
  type EmploymentAiUsageEntry,
  type VerifyEmploymentWithAiDeps,
} from '../current-employment-ai-runner';
import { CURRENT_EMPLOYMENT_METADATA_KEY, type CurrentEmploymentCheck } from '../current-employment-check';
import { resolveTitleProvenance } from '@/components/contact-enrichment/contact-candidate-title-provenance';
import {
  addToEmploymentAiTally,
  EMPTY_EMPLOYMENT_AI_TALLY,
  employmentAiBulkSummary,
  employmentAiStopsBulk,
} from '@/components/contact-enrichment/candidate-employment-ai-copy';

const NOW = '2026-11-17T12:00:00.000Z';
const LINKEDIN = 'https://cl.linkedin.com/in/paola-contreras-ficticia';

const TARGET: EmploymentAiTarget = {
  fullName: 'Paola Contreras Montenegro',
  title: 'Human Resources Manager',
  companyName: 'Cygnus S.A.',
  companyDomain: 'cygnus.cl',
  linkedinUrl: null,
  countryName: 'Chile',
};

function searchResult(url: string, title: string, pageAge: string | null = 'June 3, 2025'): AnthropicContentBlock {
  return {
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [{ type: 'web_search_result', url, title, encrypted_content: 'x', page_age: pageAge }],
  };
}

function submission(input: Record<string, unknown>): AnthropicContentBlock {
  return { type: 'tool_use', id: 'tu_1', name: EMPLOYMENT_AI_TOOL, input };
}

function assess(content: AnthropicContentBlock[], target: EmploymentAiTarget = TARGET) {
  return assessEmploymentAiResponse({ content, target, checkedAt: NOW });
}

describe('textMentionsPerson / textMentionsCompany', () => {
  it('reconoce a la persona por su apellido, sin tildes', () => {
    assert.equal(textMentionsPerson('Paola Contréras - Analista', 'Paola Contreras Montenegro'), true);
    assert.equal(textMentionsPerson('Paola Rojas - Analista', 'Paola Contreras Montenegro'), false);
  });

  it('reconoce a la empresa sin sufijo societario o por la marca del dominio', () => {
    assert.equal(textMentionsCompany('Analista en Cygnus | LinkedIn', 'Cygnus S.A.'), true);
    assert.equal(textMentionsCompany('Analista en Cygnus | LinkedIn', 'Grupo Cygnus Holding', 'cygnus.cl'), true);
    assert.equal(textMentionsCompany('Analista en Falabella', 'Cygnus S.A.', 'cygnus.cl'), false);
  });
});

describe('buildEmploymentAiRequest', () => {
  it('pide búsqueda web con tope y bloquea directorios de datos personales', () => {
    const body = buildEmploymentAiRequest(TARGET, 'claude-haiku-4-5');
    const search = body.tools[0] as { type: string; max_uses: number; blocked_domains: string[] };
    assert.equal(search.type, 'web_search_20250305');
    assert.equal(search.max_uses, 2);
    assert.ok(search.blocked_domains.includes('lusha.com'));
    assert.match(String(body.messages[0].content), /Paola Contreras Montenegro/);
  });
});

describe('assessEmploymentAiResponse', () => {
  it('caso real: «Manager» que en LinkedIn es analista ⇒ title_changed con la fuente', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista de Recursos Humanos - Cygnus | LinkedIn'),
      submission({
        verdict: 'title_changed',
        current_title: 'Analista de Recursos Humanos',
        current_company: 'Cygnus',
        evidence_url: LINKEDIN,
        quote: 'Paola Contreras Montenegro - Analista de Recursos Humanos - Cygnus',
      }),
    ]);
    assert.equal(outcome.rejection, null);
    assert.equal(outcome.check.status, 'title_changed');
    assert.equal(outcome.check.source, 'ai_web');
    assert.equal(outcome.check.current_title, 'Analista de Recursos Humanos');
    assert.equal(outcome.check.previous_title, 'Human Resources Manager');
    assert.equal(outcome.check.evidence_url, LINKEDIN);
    assert.equal(outcome.check.evidence_date, 'June 3, 2025');
  });

  it('confirma cuando la frase dice el mismo cargo y la empresa', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Human Resources Manager - Cygnus | LinkedIn'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Human Resources Manager - Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.current_title, 'Human Resources Manager');
  });

  it('otra empresa ⇒ other_company con la empresa nueva', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - HR Business Partner - Falabella | LinkedIn'),
      submission({
        verdict: 'other_company',
        current_title: 'HR Business Partner',
        current_company: 'Falabella',
        evidence_url: LINKEDIN,
        quote: 'Paola Contreras Montenegro - HR Business Partner - Falabella',
      }),
    ]);
    assert.equal(outcome.check.status, 'other_company');
    assert.equal(outcome.check.current_company, 'Falabella');
  });

  it('acepta la frase si está en lo citado de la página (no sólo en el título)', () => {
    const url = 'https://www.cygnus.cl/equipo';
    const outcome = assess([
      searchResult(url, 'Nuestro equipo'),
      {
        type: 'text',
        text: 'Aparece en el equipo.',
        citations: [{ type: 'web_search_result_location', url, cited_text: 'Paola Contreras, Human Resources Manager de Cygnus desde 2021.' }],
      },
      submission({ verdict: 'confirmed', evidence_url: url, quote: 'Paola Contreras, Human Resources Manager de Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'confirmed');
  });

  it('frase inventada (no está en la fuente) ⇒ sin verificar', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Cygnus | LinkedIn'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Human Resources Manager - Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'unknown');
    assert.equal(outcome.rejection, 'quote_not_in_source');
  });

  it('URL que no salió en la búsqueda ⇒ sin verificar', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista - Cygnus | LinkedIn'),
      submission({ verdict: 'title_changed', current_title: 'Analista', evidence_url: 'https://otra.com/x', quote: 'Paola Contreras Montenegro - Analista - Cygnus' }),
    ]);
    assert.equal(outcome.rejection, 'source_not_in_results');
  });

  it('homónimo (otra persona) ⇒ sin verificar', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Rojas - Analista - Cygnus | LinkedIn'),
      submission({ verdict: 'title_changed', current_title: 'Analista', evidence_url: LINKEDIN, quote: 'Paola Rojas - Analista - Cygnus' }),
    ]);
    assert.equal(outcome.rejection, 'quote_without_person');
  });

  it('confirmar sin que la frase diga el cargo ⇒ sin verificar (no se adivina)', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Cygnus | LinkedIn'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Cygnus' }),
    ]);
    assert.equal(outcome.rejection, 'title_not_in_quote');
  });

  it('«otra empresa» que en realidad es la misma ⇒ sin verificar', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista - Cygnus Chile | LinkedIn'),
      submission({ verdict: 'other_company', current_company: 'Cygnus Chile', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Analista - Cygnus Chile' }),
    ]);
    assert.equal(outcome.check.status, 'unknown');
  });

  it('not_found o sin entrega ⇒ sin verificar con su motivo', () => {
    assert.equal(assess([submission({ verdict: 'not_found', evidence_url: null, quote: null })]).rejection, 'not_found');
    assert.equal(assess([{ type: 'text', text: 'nada' }]).rejection, 'no_submission');
  });
});

// ── Orquestación ─────────────────────────────────────────────────

const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1, webFetchRequests: 0 };

function conversation(content: AnthropicContentBlock[]): AnthropicConversationResult {
  return { content, stopReason: 'end_turn', usage: USAGE, requests: 1 };
}

function candidate(overrides: Partial<EmploymentAiCandidate> = {}): EmploymentAiCandidate {
  return {
    id: 'cand-1',
    fullName: TARGET.fullName,
    title: TARGET.title,
    linkedinUrl: null,
    companyName: TARGET.companyName,
    companyDomain: TARGET.companyDomain,
    countryName: null,
    enrichmentMetadata: { other: 1 },
    ...overrides,
  };
}

function deps(overrides: Partial<VerifyEmploymentWithAiDeps> & { responses?: AnthropicContentBlock[][] } = {}) {
  const persisted: Array<{ id: string; patch: EmploymentAiPatch }> = [];
  const logged: EmploymentAiUsageEntry[] = [];
  const bodies: AnthropicRequestBody[] = [];
  const responses = [...(overrides.responses ?? [])];
  const d: VerifyEmploymentWithAiDeps = {
    nowIso: () => NOW,
    loadCandidate: async () => candidate(),
    resolveModel: async () => ({ model: 'claude-haiku-4-5' }),
    checkQuota: async () => ({ allowed: true }),
    runConversation: async (body) => {
      bodies.push(body);
      return conversation(responses.shift() ?? []);
    },
    persist: async (id, patch) => {
      persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      logged.push(entry);
    },
    ...overrides,
  };
  return { d, persisted, logged, bodies };
}

const CHANGED_RESPONSE: AnthropicContentBlock[] = [
  searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista de Recursos Humanos - Cygnus | LinkedIn'),
  submission({
    verdict: 'title_changed',
    current_title: 'Analista de Recursos Humanos',
    current_company: 'Cygnus',
    evidence_url: LINKEDIN,
    quote: 'Paola Contreras Montenegro - Analista de Recursos Humanos - Cygnus',
  }),
];

describe('verifyCandidateEmploymentWithAi', () => {
  it('guarda la comprobación, cambia el cargo y registra el gasto', async () => {
    const { d, persisted, logged } = deps({ responses: [CHANGED_RESPONSE] });
    const result = await verifyCandidateEmploymentWithAi('cand-1', d);
    assert.equal(result.status, 'title_changed');
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].patch.title, 'Analista de Recursos Humanos');
    assert.equal(persisted[0].patch.enrichment_metadata.other, 1);
    assert.equal((persisted[0].patch.enrichment_metadata[CURRENT_EMPLOYMENT_METADATA_KEY] as CurrentEmploymentCheck).source, 'ai_web');
    assert.equal(logged.length, 1);
    assert.equal(logged[0].verdict, 'title_changed');
    assert.equal(logged[0].usage?.webSearchRequests, 1);
  });

  it('si Claude no entrega en el primer turno, se le pide una vez más (y se suma el gasto)', async () => {
    const { d, bodies, logged } = deps({ responses: [[{ type: 'text', text: 'Encontré su perfil.' }], CHANGED_RESPONSE] });
    const result = await verifyCandidateEmploymentWithAi('cand-1', d);
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1].tool_choice, { type: 'tool', name: EMPLOYMENT_AI_TOOL });
    assert.equal(result.status, 'title_changed');
    assert.equal(logged[0].usage?.inputTokens, 2000);
  });

  it('sin modelo o sin cuota no gasta nada', async () => {
    const noModel = deps({ resolveModel: async () => ({ error: 'x' }) });
    assert.equal((await verifyCandidateEmploymentWithAi('cand-1', noModel.d)).status, 'claude_not_configured');
    const noQuota = deps({ checkQuota: async () => ({ allowed: false }) });
    assert.equal((await verifyCandidateEmploymentWithAi('cand-1', noQuota.d)).status, 'claude_quota_exhausted');
    assert.equal(noModel.bodies.length + noQuota.bodies.length, 0);
    assert.equal(noModel.logged.length + noQuota.logged.length, 0);
  });

  it('sin nombre o sin empresa no busca', async () => {
    const { d, bodies } = deps({ loadCandidate: async () => candidate({ companyName: null }) });
    assert.equal((await verifyCandidateEmploymentWithAi('cand-1', d)).status, 'missing_name_or_company');
    assert.equal(bodies.length, 0);
  });

  it('error de Claude: registra el gasto parcial y no guarda', async () => {
    const { d, persisted, logged } = deps({
      runConversation: async () => {
        throw Object.assign(new Error('boom'), { code: 'http_529', partialUsage: USAGE });
      },
    });
    const result = await verifyCandidateEmploymentWithAi('cand-1', d);
    assert.equal(result.status, 'provider_error');
    assert.equal(persisted.length, 0);
    assert.equal(logged[0].status, 'error');
    assert.equal(logged[0].errorCode, 'http_529');
  });
});

describe('employmentAiPatch', () => {
  const unknown: CurrentEmploymentCheck = {
    status: 'unknown',
    source: 'ai_web',
    checked_at: NOW,
    previous_title: 'Manager',
    current_title: null,
    current_company: null,
    current_since: null,
  };

  it('un «sin verificar» de la IA no tapa una comprobación anterior de Apollo', () => {
    const apollo = { ...unknown, status: 'confirmed', source: 'apollo' };
    assert.equal(employmentAiPatch(candidate({ enrichmentMetadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: apollo } }), unknown), null);
  });

  it('sin comprobación anterior, el «sin verificar» sí se anota (para no repetir sin saber)', () => {
    const patch = employmentAiPatch(candidate(), unknown);
    assert.ok(patch);
    assert.equal(patch?.title, undefined);
  });
});

describe('leyenda y textos', () => {
  it('la ficha dice que lo confirmó la IA y enlaza la fuente', () => {
    const check: CurrentEmploymentCheck = {
      status: 'confirmed',
      source: 'ai_web',
      checked_at: NOW,
      previous_title: 'Manager',
      current_title: 'Manager',
      current_company: 'Cygnus',
      current_since: null,
      evidence_url: LINKEDIN,
    };
    const p = resolveTitleProvenance({ source: 'lusha', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.equal(p.tone, 'verified');
    assert.match(p.caption, /Confirmado con la IA en la web/);
    assert.equal(p.evidenceUrl, LINKEDIN);
    assert.equal(p.checkedWithAi, true);
  });

  it('otra empresa según la web ⇒ aviso con «Según la web»', () => {
    const check = { status: 'other_company', source: 'ai_web', checked_at: NOW, current_company: 'Falabella', current_title: 'HRBP' };
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.equal(p.tone, 'left');
    assert.match(p.leftNotice?.description ?? '', /Según la web, hoy trabaja en Falabella como HRBP/);
  });

  it('la IA no encontró nada ⇒ sigue «sin verificar» pero lo dice', () => {
    const check = { status: 'unknown', source: 'ai_web', checked_at: NOW };
    const p = resolveTitleProvenance({ source: 'lusha', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.equal(p.tone, 'unverified');
    assert.match(p.caption, /la IA no encontró información pública confiable/);
  });

  it('resumen de la tanda y cuándo se detiene', () => {
    let tally = EMPTY_EMPLOYMENT_AI_TALLY;
    for (const s of ['confirmed', 'confirmed', 'title_changed', 'other_company', 'unknown'] as const) tally = addToEmploymentAiTally(tally, s);
    assert.equal(employmentAiBulkSummary(tally), '5 verificados con IA: 2 confirmados, 1 con otro cargo, 1 ya no está, 1 sin información.');
    assert.equal(employmentAiStopsBulk('claude_quota_exhausted'), true);
    assert.equal(employmentAiStopsBulk('unknown'), false);
  });
});
