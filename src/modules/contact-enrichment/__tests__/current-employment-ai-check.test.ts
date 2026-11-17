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
  linkedinProfileSlug,
  textMentionsCompany,
  textMentionsPerson,
  titleRoughlyInText,
  titlesEquivalent,
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
import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  evidenceAgeDays,
  isStaleEvidence,
  parseEvidenceDate,
  type CurrentEmploymentCheck,
} from '../current-employment-check';
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
    assert.equal(textMentionsCompany('Gerente en Caja de Compensación Los Andes', 'Caja Los Andes'), true);
    assert.equal(textMentionsCompany('Gerente en Cajalosandes', 'Otra', 'cajalosandes.cl'), true);
    assert.equal(textMentionsCompany('Gerente en Caja Los Héroes', 'Caja Los Andes'), false);
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
    assert.equal(outcome.check.evidence_date, '2025-06-03');
  });

  it('confirma cuando el resultado dice el mismo cargo y la empresa', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Human Resources Manager - Cygnus | LinkedIn'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Human Resources Manager - Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.title_confirmed, true);
  });

  it('caso real 17-11: «Caja Los Andes» en SellUp es «Caja de Compensación Los Andes» en LinkedIn', () => {
    const url = 'https://cl.linkedin.com/in/pamela-silva-andrades-2aa09b58';
    const outcome = assess(
      [
        searchResult(url, 'Pamela Silva Andrades - Gerente de Personas - Caja de Compensación Los Andes | LinkedIn'),
        submission({ verdict: 'confirmed', evidence_url: url, quote: 'Pamela Silva, Gerente de Personas en Caja Los Andes' }),
      ],
      { ...TARGET, fullName: 'Pamela Silva Andrades', title: 'Gerente Recursos Humanos', companyName: 'Caja Los Andes', companyDomain: 'cajalosandes.cl' },
    );
    assert.equal(outcome.check.status, 'confirmed');
    // Sigue en la empresa; «Gerente de Personas» no es «Gerente Recursos Humanos» y Claude no dio otro cargo.
    assert.equal(outcome.check.title_confirmed, false);
  });

  it('el cargo con «&» y otras palabras de relleno igual se reconoce', () => {
    const url = 'https://cl.linkedin.com/in/tamara-matus-69743b17';
    const outcome = assess(
      [
        searchResult(url, 'Tamara Matus - Head of Training & Development - Caja Los Andes | LinkedIn'),
        submission({ verdict: 'confirmed', evidence_url: url, quote: 'Tamara Matus, Head of Training and Development' }),
      ],
      { ...TARGET, fullName: 'Tamara Matus', title: 'Head of Training and Development', companyName: 'Caja Los Andes', companyDomain: 'cajalosandes.cl' },
    );
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.title_confirmed, true);
  });

  it('su perfil de LinkedIn guardado prueba la identidad aunque Claude diga not_found', () => {
    const url = 'https://cl.linkedin.com/in/alejandra-sep%C3%BAlveda-4383b278';
    const outcome = assess(
      [
        searchResult(url, 'Alejandra S. - Jefa de Ventas - EGLO Chile | LinkedIn'),
        submission({ verdict: 'not_found', evidence_url: null, quote: null }),
      ],
      {
        ...TARGET,
        fullName: 'Alejandra Sepúlveda',
        title: 'General Manager',
        companyName: 'EGLO ILUMINACION CHILE',
        companyDomain: 'eglo.cl',
        linkedinUrl: 'https://www.linkedin.com/in/alejandra-sep%C3%BAlveda-4383b278',
      },
    );
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.title_confirmed, false);
  });

  it('acepta lo citado de la página (no sólo el título del resultado)', () => {
    const url = 'https://www.cygnus.cl/equipo';
    const outcome = assess([
      searchResult(url, 'Nuestro equipo'),
      {
        type: 'text',
        text: 'Aparece en el equipo.',
        citations: [{ type: 'web_search_result_location', url, cited_text: 'Paola Contreras, Human Resources Manager de Cygnus desde 2021.' }],
      },
      submission({ verdict: 'confirmed', evidence_url: url, quote: 'Paola Contreras, HR Manager de Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.evidence_quote, 'Paola Contreras, Human Resources Manager de Cygnus desde 2021.');
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
    assert.equal(outcome.check.current_title, 'HR Business Partner');
  });

  it('Claude inventa la empresa (no está en los resultados) ⇒ sin verificar, sin mostrar sólo el nombre', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista | LinkedIn'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Analista - Cygnus' }),
    ]);
    assert.equal(outcome.check.status, 'unknown');
    assert.equal(outcome.rejection, 'company_not_in_results');
    assert.equal(outcome.check.evidence_quote, null);
    assert.equal(outcome.check.evidence_url, null);
  });

  it('dueña 17-11: «PAOLA CONTRERAS - Google Scholar» o «Doctora Marisel Figueroa» no se muestran como hallazgo', () => {
    const scholar = assess(
      [searchResult('https://scholar.google.com/citations?user=x', 'PAOLA CONTRERAS - Google Scholar'), submission({ verdict: 'not_found' })],
      { ...TARGET, linkedinUrl: 'http://www.linkedin.com/in/paola-contreras-montenegro-07b31a40' },
    );
    assert.equal(scholar.check.evidence_quote, null);
    const doctora = assess(
      [searchResult('https://clinica.example/equipo', 'Doctora Marisel Figueroa'), submission({ verdict: 'not_found' })],
      { ...TARGET, fullName: 'Marisel Figueroa Lòpez', title: 'Jefe Capacitación', companyName: 'Caja Los Andes', companyDomain: 'cajalosandes.cl' },
    );
    assert.equal(doctora.check.status, 'unknown');
    assert.equal(doctora.check.evidence_url, null);
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: doctora.check } });
    assert.match(p.caption, /la IA no encontró información pública confiable/);
  });

  it('homónimo (otra persona) ⇒ sin verificar', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Rojas - Analista - Cygnus | LinkedIn'),
      submission({ verdict: 'title_changed', current_title: 'Analista', evidence_url: LINKEDIN, quote: 'Paola Rojas - Analista - Cygnus' }),
    ]);
    assert.equal(outcome.rejection, 'person_not_in_results');
  });

  it('«otra empresa» que en realidad es la misma ⇒ no se marca como ida', () => {
    const outcome = assess([
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Analista - Cygnus Chile | LinkedIn'),
      submission({ verdict: 'other_company', current_company: 'Cygnus Chile', evidence_url: LINKEDIN, quote: 'Paola Contreras Montenegro - Analista - Cygnus Chile' }),
    ]);
    assert.notEqual(outcome.check.status, 'other_company');
  });

  it('not_found sin resultados o sin entrega ⇒ sin verificar con su motivo', () => {
    assert.equal(assess([submission({ verdict: 'not_found', evidence_url: null, quote: null })]).rejection, 'not_found');
    assert.equal(assess([{ type: 'text', text: 'nada' }]).rejection, 'no_submission');
  });
});

describe('fuentes viejas', () => {
  it('caso real 17-11 (Tamara): una copia de su perfil de hace 8 años no confirma nada', () => {
    const url = 'https://www.linkedin.com/in/tamara-ficticia-69743b17/';
    const outcome = assess(
      [
        searchResult(url, 'Tamara Matus - Jefe de Formación y Aprendizaje - Caja Los Andes', '2924 days ago'),
        submission({ verdict: 'title_changed', current_title: 'Jefe de Formación y Aprendizaje', current_company: 'Caja Los Andes', evidence_url: url }),
      ],
      { ...TARGET, fullName: 'Tamara Matus', title: 'Head of Training and Development', companyName: 'Caja Los Andes', companyDomain: 'cajalosandes.cl', linkedinUrl: url },
    );
    assert.equal(outcome.check.status, 'unknown');
    assert.equal(outcome.rejection, 'stale_source');
    assert.equal(outcome.check.evidence_url, url);
    assert.equal(outcome.check.evidence_date, '2018-11-15');
  });

  it('si además hay un resultado reciente, ese sí cuenta', () => {
    const outcome = assess([
      searchResult('https://old.example/p', 'Paola Contreras Montenegro - Gerente - Otra SA', '9 years ago'),
      searchResult(LINKEDIN, 'Paola Contreras Montenegro - Human Resources Manager - Cygnus | LinkedIn', '3 weeks ago'),
      submission({ verdict: 'confirmed', evidence_url: LINKEDIN }),
    ]);
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.evidence_url, LINKEDIN);
  });

  it('entiende «N days ago», semanas, años y fechas escritas', () => {
    assert.equal(evidenceAgeDays('2924 days ago', NOW), 2924);
    assert.equal(evidenceAgeDays('3 weeks ago', NOW), 21);
    assert.equal(evidenceAgeDays('1 year ago', NOW), 365);
    assert.equal(evidenceAgeDays('June 3, 2025', NOW), 532);
    assert.equal(parseEvidenceDate('lo que sea', NOW), null);
  });

  it('más de 2 años es viejo; sin fecha no se descarta', () => {
    assert.equal(isStaleEvidence('2924 days ago', NOW), true);
    assert.equal(isStaleEvidence('700 days ago', NOW), false);
    assert.equal(isStaleEvidence(null, NOW), false);
  });
});

describe('pruebas de la dueña 17-11 (tarde)', () => {
  it('Alejandra: «General Manager» y «Gerente General» son el mismo cargo ⇒ confirmado, no cambiado', () => {
    const url = 'https://cl.linkedin.com/company/eglo-ficticia';
    const outcome = assess(
      [
        searchResult(url, 'Eglo Chile | LinkedIn', null),
        submission({ verdict: 'title_changed', current_title: 'Gerente General', current_company: 'EGLO ILUMINACION CHILE', evidence_url: url }),
        { type: 'text', text: 'nuestra Gerente General, Alejandra Sepúlveda, en Eglo Chile', citations: [{ type: 'web_search_result_location', url, title: 'Eglo Chile', cited_text: 'representantes de Eglo Chile, nuestra Gerente General, Alejandra Sepúlveda, y Carlos', encrypted_index: 'x' }] } as unknown as AnthropicContentBlock,
      ],
      { ...TARGET, fullName: 'Alejandra Sepúlveda', title: 'General Manager', companyName: 'EGLO ILUMINACION CHILE', companyDomain: 'eglo.cl', linkedinUrl: 'https://www.linkedin.com/in/alejandra-ficticia-4383b278' },
    );
    assert.equal(outcome.check.status, 'confirmed');
    assert.equal(outcome.check.title_confirmed, true);
    assert.equal(outcome.check.current_title, 'General Manager');
  });

  it('Paola: con su LinkedIn guardado, otro perfil «Paola Contreras» es un homónimo y no cuenta', () => {
    const other = 'https://www.linkedin.com/in/paola-contreras-113408a3/';
    const outcome = assess(
      [searchResult(other, 'Paola Contreras - Trans American Power Products'), submission({ verdict: 'not_found' })],
      { ...TARGET, linkedinUrl: 'http://www.linkedin.com/in/paola-contreras-montenegro-07b31a40' },
    );
    assert.equal(outcome.check.status, 'unknown');
    assert.equal(outcome.check.evidence_url, null);
    assert.equal(outcome.rejection, 'not_found');
  });

  it('Pamela: su perfil aparece pero sin empresa ⇒ la ficha dice que encontró su perfil', () => {
    const own = 'https://cl.linkedin.com/in/pamela-ficticia-2aa09b58';
    const outcome = assess(
      [searchResult(own, 'Pamela Silva Andrades'), submission({ verdict: 'not_found' })],
      { ...TARGET, fullName: 'Pamela Silva Andrades', title: 'Gerente Recursos Humanos', companyName: 'Caja Los Andes', companyDomain: 'cajalosandes.cl', linkedinUrl: 'https://linkedin.com/in/pamela-ficticia-2aa09b58' },
    );
    assert.equal(outcome.check.status, 'unknown');
    assert.equal(outcome.check.evidence_own_profile, true);
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: outcome.check } });
    assert.match(p.caption, /encontró su perfil de LinkedIn, pero el resultado no muestra en qué empresa trabaja hoy/);
  });

  it('un apellido solo no es la persona (hace falta el nombre también)', () => {
    assert.equal(textMentionsPerson('Carolina Silva - Gerente - Caja Los Andes', 'Pamela Silva Andrades'), false);
    assert.equal(textMentionsPerson('Pamela Silva - Gerente - Caja Los Andes', 'Pamela Silva Andrades'), true);
    assert.equal(textMentionsPerson('nuestra Gerente General, Alejandra Sepúlveda', 'Alejandra Sepúlveda'), true);
  });

  it('cargos equivalentes en inglés y español', () => {
    assert.equal(titlesEquivalent('General Manager', 'Gerente General'), true);
    assert.equal(titlesEquivalent('Human Resources Manager', 'Gerente de Recursos Humanos'), true);
    assert.equal(titlesEquivalent('Head of Training and Development', 'Jefe de Formación y Aprendizaje'), false);
    assert.equal(titlesEquivalent('Human Resources Manager', 'Analista de Recursos Humanos'), false);
  });
});

describe('titleRoughlyInText / linkedinProfileSlug', () => {
  it('tolera «&», relleno y una palabra distinta', () => {
    assert.equal(titleRoughlyInText('Head of Training and Development', 'Head of Training & Development'), true);
    assert.equal(titleRoughlyInText('Gerente Recursos Humanos', 'Gerente de Recursos Humanos'), true);
    assert.equal(titleRoughlyInText('Gerente Recursos Humanos', 'Analista de Marketing'), false);
  });

  it('el mismo perfil con o sin subdominio de país, https o barra final', () => {
    assert.equal(linkedinProfileSlug('http://www.linkedin.com/in/Ana-Perez-12/'), linkedinProfileSlug('https://cl.linkedin.com/in/ana-perez-12'));
    assert.equal(linkedinProfileSlug('https://example.com/ana'), null);
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

  it('caso Marisel: Apollo dijo «otra empresa» y la web no aporta nada ⇒ se mantiene Apollo y se avisa', async () => {
    const apollo = { ...unknown, status: 'other_company', source: 'apollo', current_company: 'Chocolatería Ficticia' };
    const { d, persisted } = deps({
      loadCandidate: async () => candidate({ enrichmentMetadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: apollo } }),
      responses: [[submission({ verdict: 'not_found' })]],
    });
    const result = await verifyCandidateEmploymentWithAi('cand-1', d);
    assert.equal(result.keptPrevious, true);
    assert.equal(persisted.length, 0);
  });

  it('sin comprobación anterior, el «sin verificar» sí se anota (para no repetir sin saber)', () => {
    const patch = employmentAiPatch(candidate(), unknown);
    assert.ok(patch);
    assert.equal(patch?.title, undefined);
  });

  it('«Verificar de nuevo» reemplaza a la IA anterior y devuelve el cargo original', () => {
    const changedByAi = { ...unknown, status: 'title_changed', previous_title: 'Head of Training', current_title: 'Jefe de Formación' };
    const c = candidate({ title: 'Jefe de Formación', enrichmentMetadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: changedByAi } });
    const patch = employmentAiPatch(c, { ...unknown, previous_title: 'Head of Training' });
    assert.ok(patch);
    assert.equal(patch?.title, 'Head of Training');
    assert.equal((patch?.enrichment_metadata[CURRENT_EMPLOYMENT_METADATA_KEY] as CurrentEmploymentCheck).status, 'unknown');
  });

  it('al volver a verificar, a Claude se le pregunta por el cargo original', async () => {
    const changedByAi = { ...unknown, status: 'title_changed', previous_title: 'Head of Training', current_title: 'Jefe de Formación' };
    const { d, bodies } = deps({
      loadCandidate: async () => candidate({ title: 'Jefe de Formación', enrichmentMetadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: changedByAi } }),
      responses: [[submission({ verdict: 'not_found' })]],
    });
    await verifyCandidateEmploymentWithAi('cand-1', d);
    assert.match(JSON.stringify(bodies[0].messages), /Cargo que tenemos: Head of Training/);
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

  it('sigue en la empresa sin cargo confirmado ⇒ lo dice así', () => {
    const check = { status: 'confirmed', source: 'ai_web', checked_at: NOW, current_company: 'Caja Los Andes', title_confirmed: false };
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.equal(p.tone, 'verified');
    assert.match(p.caption, /Sigue en Caja Los Andes según la IA en la web .* el cargo no se pudo confirmar/);
  });

  it('sin verificar pero con algo encontrado ⇒ lo muestra con su enlace', () => {
    const check = { status: 'unknown', source: 'ai_web', checked_at: NOW, evidence_url: LINKEDIN, evidence_quote: 'Paola Contreras - Analista' };
    const p = resolveTitleProvenance({ source: 'apollo', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.match(p.caption, /la IA encontró «Paola Contreras - Analista»/);
    assert.equal(p.evidenceUrl, LINKEDIN);
  });

  it('sólo encontró una fuente vieja ⇒ dice de hace cuántos años y que confirme en LinkedIn', () => {
    const check = { status: 'unknown', source: 'ai_web', checked_at: NOW, evidence_url: LINKEDIN, evidence_quote: 'Tamara - Jefe', evidence_date: '2018-11-15' };
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: { [CURRENT_EMPLOYMENT_METADATA_KEY]: check } });
    assert.match(p.caption, /una fuente de hace 8 años/);
    assert.match(p.caption, /confírmalo en LinkedIn/);
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
