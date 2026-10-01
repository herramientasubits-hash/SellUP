/**
 * Tests — Agente 1 · Claude busca el sitio oficial (AGENT1-CLAUDE-FIND-DOMAIN-1).
 *
 * Sin red ni base de datos: Claude, la descarga de la página, SellUp/HubSpot y
 * Supabase son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findOfficialWebsite, FIND_WEBSITE_TOOL_NAME, type DomainFinderDeps } from '../../domain-finder';
import type { AnthropicConversationResult, AnthropicRequestBody } from '../../anthropic-messages-client';
import type { SafePageFetchResult } from '../../../website-verifier';
import {
  buildDomainSearchUsageLog,
  CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
  dispositionDisplayName,
  dispositionLinkedInUrl,
} from '../domain-search';
import { needsDispositionRescue, type RescuableDispositionRow } from '../rescue-dispositions';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import type { CompanyClassificationResult } from '../../types';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const AT = '2026-09-30T12:00:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const TEC = 'Tecnología';
const FILLER = ' Ofrecemos consultoría de ingeniería y servicios de tecnología a empresas de la región.'.repeat(5);

const USAGE = {
  inputTokens: 3000,
  outputTokens: 120,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 1,
  webFetchRequests: 0,
};

function conversation(url: string | null, searchUrls: string[]): AnthropicConversationResult {
  return {
    content: [
      {
        type: 'web_search_tool_result',
        content: searchUrls.map((u) => ({ type: 'web_search_result', url: u, title: 'x' })),
      },
      { type: 'tool_use', name: FIND_WEBSITE_TOOL_NAME, input: { official_website_url: url, confidence: 0.9 } },
    ],
    stopReason: 'tool_use',
    usage: USAGE,
    requests: 1,
  };
}

function page(html: string, finalUrl = 'https://sii-group.com/es-CO'): SafePageFetchResult {
  return { requestedUrl: finalUrl, finalUrl, httpStatus: 200, redirected: false, html, error: null };
}

function finderDeps(conv: AnthropicConversationResult, html: SafePageFetchResult): DomainFinderDeps & { bodies: AnthropicRequestBody[] } {
  const bodies: AnthropicRequestBody[] = [];
  return {
    bodies,
    runConversation: async (body) => (bodies.push(body), conv),
    fetchPage: async () => html,
  };
}

const INPUT = {
  name: 'SII Group Colombia',
  countryName: 'Colombia',
  countryCode: 'CO',
  linkedinUrl: 'https://www.linkedin.com/company/sii-group-colombia',
};

const LINKED_HTML = `<html><head><title>Inicio</title></head><body><p>${FILLER}</p>
  <a href="https://www.linkedin.com/company/sii-group-colombia/">LinkedIn</a></body></html>`;

describe('A. findOfficialWebsite', () => {
  it('acepta el sitio cuando enlaza al MISMO LinkedIn de la empresa', async () => {
    const deps = finderDeps(conversation('https://sii-group.com/es-CO', ['https://sii-group.com/es-CO']), page(LINKED_HTML));
    const out = await findOfficialWebsite(INPUT, MODEL, deps);
    assert.equal(out.found, true);
    if (!out.found) return;
    assert.equal(out.domain, 'sii-group.com');
    assert.equal(out.website, 'https://sii-group.com');
    assert.equal(out.verification, 'linkedin_cross_link');
    assert.ok((out.usage?.estimatedCostUsd ?? 0) > 0);
    // Sin user_location (Perú no está soportado) y con el LinkedIn en el mensaje.
    const tools = deps.bodies[0].tools as Array<{ type?: string; user_location?: unknown }>;
    assert.equal(tools.some((t) => t.user_location !== undefined), false);
    assert.match(JSON.stringify(deps.bodies[0].messages), /sii-group-colombia/);
  });

  it('acepta por nombre cuando el título de la página coincide', async () => {
    const html = `<html><head><title>SII Group Colombia | Ingeniería</title></head><body><p>${FILLER}</p></body></html>`;
    const out = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation('https://sii-group.com', ['https://sii-group.com/']), page(html, 'https://sii-group.com/')),
    );
    assert.equal(out.found, true);
    if (out.found) assert.equal(out.verification, 'name_match');
  });

  it('rechaza una URL que NO salió de la búsqueda (inventada)', async () => {
    const out = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation('https://sii-group.com', ['https://otra.com/']), page(LINKED_HTML)),
    );
    assert.deepEqual(out.found ? null : out.reason, 'not_in_search_results');
  });

  it('rechaza LinkedIn, redes y directorios como «sitio oficial»', async () => {
    const url = 'https://www.facebook.com/siigroup';
    const out = await findOfficialWebsite(INPUT, MODEL, finderDeps(conversation(url, [url]), page(LINKED_HTML)));
    assert.deepEqual(out.found ? null : out.reason, 'platform_domain');
  });

  it('rechaza un sitio que no responde o casi sin texto', async () => {
    const url = 'https://sii-group.com';
    const empty = { ...page('<html></html>'), httpStatus: 200 };
    const out = await findOfficialWebsite(INPUT, MODEL, finderDeps(conversation(url, [url]), empty));
    assert.deepEqual(out.found ? null : out.reason, 'page_unreachable');
  });

  it('rechaza un sitio de OTRA empresa (ni LinkedIn ni nombre coinciden)', async () => {
    const html = `<html><head><title>Panadería La Espiga</title></head><body><p>${FILLER}</p>
      <a href="https://www.linkedin.com/company/panaderia-la-espiga">in</a></body></html>`;
    const url = 'https://laespiga.co';
    const out = await findOfficialWebsite(INPUT, MODEL, finderDeps(conversation(url, [url]), page(html, url)));
    assert.deepEqual(out.found ? null : out.reason, 'identity_not_confirmed');
  });

  it('null de Claude = no encontrado; si no entrega, se le obliga una vez', async () => {
    const none = await findOfficialWebsite(INPUT, MODEL, finderDeps(conversation(null, []), page(LINKED_HTML)));
    assert.deepEqual(none.found ? null : none.reason, 'no_candidate');

    const bodies: AnthropicRequestBody[] = [];
    const silent: AnthropicConversationResult = { content: [], stopReason: 'end_turn', usage: USAGE, requests: 1 };
    const out = await findOfficialWebsite(INPUT, MODEL, {
      runConversation: async (body) => (bodies.push(body), bodies.length === 1 ? silent : conversation(null, [])),
      fetchPage: async () => page(LINKED_HTML),
    });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1].tool_choice, { type: 'tool', name: FIND_WEBSITE_TOOL_NAME });
    assert.equal(out.usage?.webSearchRequests, 2);
  });

  it('rechaza un sitio que redirige a OTRO dominio (no comprobado)', async () => {
    const url = 'https://sii-group.com';
    const out = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation(url, [url]), page(LINKED_HTML, 'https://parked-domains.example/landing')),
    );
    assert.deepEqual(out.found ? null : out.reason, 'redirected_offsite');
  });

  it('si la descarga lanza, no se pierde el uso pagado', async () => {
    const url = 'https://sii-group.com';
    const out = await findOfficialWebsite(INPUT, MODEL, {
      runConversation: async () => conversation(url, [url]),
      fetchPage: async () => {
        throw new Error('socket hang up');
      },
    });
    assert.deepEqual(out.found ? null : out.reason, 'page_unreachable');
    assert.ok((out.usage?.estimatedCostUsd ?? 0) > 0);
  });

  it('un error del modelo no lanza', async () => {
    const out = await findOfficialWebsite(INPUT, MODEL, {
      runConversation: async () => {
        throw new Error('boom');
      },
      fetchPage: async () => page(LINKED_HTML),
    });
    assert.deepEqual(out.found ? null : out.reason, 'model_error');
  });
});

function disposition(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'colombia sii',
    domain: null,
    country_code: 'CO',
    industry: TEC,
    reason_code: 'missing_domain_final',
    evidence: { provider_raw_name: 'SII Group Colombia', linkedin_url: 'linkedin.com/company/sii-group-colombia' },
    ...overrides,
  };
}

describe('B. qué filas entran', () => {
  it('sin dominio sólo con el buscador encendido y motivo missing_domain_final', () => {
    assert.equal(needsDispositionRescue(disposition(), NOW), false);
    assert.equal(needsDispositionRescue(disposition(), NOW, true), true);
    assert.equal(needsDispositionRescue(disposition({ reason_code: 'existing_in_hubspot' }), NOW, true), false);
    // Las de siempre (con dominio) no cambian.
    assert.equal(
      needsDispositionRescue(disposition({ domain: 'x.co', reason_code: 'sub_industry_branch_parent_only' }), NOW),
      true,
    );
  });

  it('usa el nombre original del proveedor y normaliza el LinkedIn', () => {
    assert.equal(dispositionDisplayName(disposition()), 'SII Group Colombia');
    assert.equal(dispositionDisplayName(disposition({ evidence: {} })), 'colombia sii');
    assert.equal(dispositionLinkedInUrl(disposition()), 'https://www.linkedin.com/company/sii-group-colombia');
  });

  it('registra el uso como company_domain_search', () => {
    const log = buildDomainSearchUsageLog(
      { found: false, reason: 'no_candidate', usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.013, pricingSource: 'table' } },
      { batchId: 'b1', dispositionId: 'd1', triggeredBy: 'u1', searchedAt: AT, durationMs: 900 },
    );
    assert.equal(log?.operation_key, 'company_domain_search');
    assert.equal(log?.provider_key, 'anthropic');
    assert.equal(log?.status, 'success');
  });
});

function classified(company: { candidateId: string }): CompanyClassificationResult {
  return {
    candidateId: company.candidateId,
    outcome: 'classified',
    sector: {
      industryId: 'tec',
      industryName: TEC,
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: true,
      quote: 'Empresa de consultoría en ingeniería y tecnología',
      sourceUrl: 'https://sii-group.com/',
      confidence: 0.9,
      verification: 'quote_verified',
    },
    employeeRange: null,
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://sii-group.com/',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
    errorCode: null,
    durationMs: 1000,
  };
}

const FOUND = {
  found: true as const,
  website: 'https://sii-group.com',
  domain: 'sii-group.com',
  verification: 'linkedin_cross_link' as const,
  usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.013, pricingSource: 'table' as const },
};

function fakeDeps(overrides: Partial<RescueBatchDeps> = {}) {
  const evidence = new Map<string, Record<string, unknown>>();
  const origins: SendToReviewOrigin[] = [];
  const classifiedCompanies: Array<{ name: string; websiteOrDomain: string | null }> = [];
  const searches: unknown[] = [];
  const logs: Array<{ operation_key: string }> = [];
  const claimed: string[][] = [];
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'tec', industryName: TEC, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [disposition()],
    loadBatchIndustryId: async () => 'tec',
    classify: async (company) => (classifiedCompanies.push(company), classified(company)),
    logUsage: async (input) => (logs.push(input as { operation_key: string }), true),
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? disposition().evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    claimIdentities: async (_b, ids) => void claimed.push([...ids]),
    domainSearch: {
      findWebsite: async (input) => (searches.push(input), FOUND),
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
    ...overrides,
  };
  return { deps, evidence, origins, classifiedCompanies, searches, logs, claimed };
}

describe('C. rescate de descartadas sin dominio', () => {
  it('con el buscador apagado no se toca ninguna fila sin dominio', async () => {
    const f = fakeDeps({ domainSearch: undefined });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted + s.dispositionsKept, 0);
    assert.equal(f.evidence.size, 0);
    assert.equal(f.logs.length, 0);
  });

  it('sitio comprobado + nueva + sector del lote ⇒ vuelve a revisión con sitio, nombre y LinkedIn', async () => {
    const f = fakeDeps();
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.deepEqual(f.classifiedCompanies[0], {
      ...f.classifiedCompanies[0],
      name: 'SII Group Colombia',
      websiteOrDomain: 'https://sii-group.com',
    });
    const columns = f.origins[0].columns ?? {};
    assert.equal(columns.name, 'SII Group Colombia');
    assert.equal(columns.domain, 'sii-group.com');
    assert.equal(columns.linkedin_url, 'https://www.linkedin.com/company/sii-group-colombia');
    assert.equal(
      (f.origins[0].metadata[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { verification: string }).verification,
      'linkedin_cross_link',
    );
    assert.deepEqual(f.claimed, [['new-d1']]);
    assert.deepEqual(f.logs.map((l) => l.operation_key), ['company_domain_search', 'company_classification']);
    assert.ok(s.ok && Math.abs(s.estimatedCostUsd - 0.033) < 1e-9);
  });

  it('ya existe en SellUp/HubSpot ⇒ se queda en Descartadas y no se clasifica', async () => {
    const f = fakeDeps({
      domainSearch: {
        findWebsite: async () => FOUND,
        checkDuplicate: async () => ({ status: 'existing_in_hubspot', summary: 'Ya está en HubSpot' }),
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.origins.length, 0);
    assert.equal(f.classifiedCompanies.length, 0);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { duplicate_status: string }).duplicate_status, 'existing_in_hubspot');
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'duplicate');
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: ev }, NOW + 3_600_000, true), false);
  });

  it('si no se puede revisar HubSpot NO se admite; el sitio se guarda y se reintenta sin volver a pagarlo', async () => {
    const f = fakeDeps({
      domainSearch: {
        findWebsite: async () => FOUND,
        checkDuplicate: async () => {
          throw new Error('duplicate_check_incomplete:sellup');
        },
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.failed, 1);
    assert.equal(f.origins.length, 0);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'retryable');

    // Segunda corrida: reutiliza el sitio comprobado, no busca de nuevo.
    const again = fakeDeps({ loadDispositions: async () => [disposition({ evidence: ev })] });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, again.deps);
    assert.equal(again.searches.length, 0);
    assert.equal(again.origins.length, 1);
  });

  it('sitio no encontrado ⇒ se queda con el motivo; es final', async () => {
    const f = fakeDeps({
      domainSearch: {
        findWebsite: async () => ({ found: false, reason: 'identity_not_confirmed', usage: FOUND.usage }),
        checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { reason: string }).reason, 'identity_not_confirmed');
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'website_not_found');
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: ev }, NOW + 3_600_000, true), false);
  });

  it('error del modelo al buscar ⇒ reintentable', async () => {
    const f = fakeDeps({
      domainSearch: {
        findWebsite: async () => {
          throw new Error('boom');
        },
        checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
      },
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'retryable');
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: ev }, NOW, true), true);
  });

  it('sitio caído: se reintenta, pero como máximo 3 búsquedas en total', async () => {
    let ev: Record<string, unknown> | null = disposition().evidence;
    const decisions: string[] = [];
    for (let run = 0; run < 3; run++) {
      const f = fakeDeps({
        loadDispositions: async () => [disposition({ evidence: ev })],
        patchDispositionEvidence: async (_id, build) => ((ev = build(ev)), true),
        domainSearch: {
          findWebsite: async () => ({ found: false, reason: 'page_unreachable', usage: FOUND.usage }),
          checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
        },
      });
      await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
      decisions.push((ev!.claude_rescue as { decision: string }).decision);
    }
    assert.deepEqual(decisions, ['retryable', 'retryable', 'website_not_found']);
    assert.equal((ev![CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { attempts: number }).attempts, 3);
  });

  it('sitio nuevo pero de OTRO sector ⇒ se queda, con el sitio guardado', async () => {
    const f = fakeDeps({
      classify: async (company) => ({
        ...classified(company),
        sector: { ...classified(company).sector!, industryId: 'salud', industryName: 'Salud', matchesCurrentIndustry: false, confidence: 0.97 },
      }),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { domain: string }).domain, 'sii-group.com');
  });
});
