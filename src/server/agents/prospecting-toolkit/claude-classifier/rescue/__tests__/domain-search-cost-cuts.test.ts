/**
 * 21-10 — gasto de la búsqueda del sitio oficial (`company_domain_search`). Prod oct-2026:
 * US$77 de US$178 del Agente 1, 2.191 llamadas, ~18k tokens de entrada por llamada,
 * 110 fallos http_400.
 *
 *   · el turno forzado ya no reenvía la conversación con los resultados completos;
 *   · 2 búsquedas web por empresa (antes 3);
 *   · un 400 tras un primer turno cobrado no es la cuenta: no se reintenta ni frena;
 *   · lo ya buscado para la MISMA empresa en otra fila (otro lote) se reutiliza;
 *   · tope de búsquedas pagadas por lote (RESCUE_BATCH_MAX_DOMAIN_SEARCHES).
 *
 * Dobles en memoria; cero E/S.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDomainFinderRequestBody,
  buildForcedSubmissionBody,
  findOfficialWebsite,
  FIND_WEBSITE_TOOL_NAME,
  FINDER_FORCED_TURN_MAX_RESULTS,
  FINDER_MAX_WEB_SEARCHES,
} from '../../domain-finder';
import type { AnthropicConversationResult, AnthropicRequestBody } from '../../anthropic-messages-client';
import { AnthropicApiError } from '../../anthropic-messages-client';
import type { SafePageFetchResult } from '../../../website-verifier';
import {
  buildDomainSearchStaysEvidence,
  CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
  DOMAIN_SEARCH_REUSE_MAX_AGE_DAYS,
  DOMAIN_SEARCH_VERSION,
  isAccountLevelModelError,
  isRequestRejectedModelError,
  reusablePriorDomainSearch,
  websiteNotFoundByAccountError,
} from '../domain-search';
import { RESCUE_BATCH_MAX_DOMAIN_SEARCHES, rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import { findPriorDomainSearches, readBatchDomainSearchCount } from '../rescue-batch.server';
import type { RescuableDispositionRow } from '../rescue-dispositions';
import type { CompanyClassificationResult } from '../../types';

const AT = '2026-10-21T12:00:00.000Z';
const NOW = Date.parse(AT);
const MODEL = 'claude-haiku-4-5-20251001';
const TEC = 'Tecnología';
const USAGE = {
  inputTokens: 9000,
  outputTokens: 100,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 2,
  webFetchRequests: 0,
};
const FILLER = ' Ofrecemos consultoría de ingeniería y servicios de tecnología a empresas de la región.'.repeat(5);
const LINKED_HTML = `<html><head><title>Inicio</title></head><body><p>${FILLER}</p>
  <a href="https://www.linkedin.com/company/sii-group-colombia/">LinkedIn</a></body></html>`;
const INPUT = {
  name: 'SII Group Colombia',
  countryName: 'Colombia',
  countryCode: 'CO',
  linkedinUrl: 'https://www.linkedin.com/company/sii-group-colombia',
};

function page(html: string, finalUrl = 'https://sii-group.com/'): SafePageFetchResult {
  return { requestedUrl: finalUrl, finalUrl, httpStatus: 200, redirected: false, html, error: null };
}

function searchOnly(urls: string[]): AnthropicConversationResult {
  return {
    content: [
      { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'SII Group Colombia' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srv1',
        content: urls.map((u, i) => ({ type: 'web_search_result', url: u, title: `Título ${i}`, encrypted_content: 'x'.repeat(5000) })),
      },
      { type: 'text', text: 'Creo que es sii-group.com' },
    ],
    stopReason: 'end_turn',
    usage: USAGE,
    requests: 1,
  };
}

const submit = (url: string | null): AnthropicConversationResult => ({
  content: [{ type: 'tool_use', name: FIND_WEBSITE_TOOL_NAME, input: { official_website_url: url, confidence: 0.9 } }],
  stopReason: 'tool_use',
  usage: { ...USAGE, inputTokens: 400, webSearchRequests: 0 },
  requests: 1,
});

describe('A. turno forzado barato y 2 búsquedas', () => {
  it('la búsqueda pide como mucho 2 búsquedas web', () => {
    const body = buildDomainFinderRequestBody(INPUT, MODEL);
    assert.equal(FINDER_MAX_WEB_SEARCHES, 2);
    assert.equal((body.tools[0] as { max_uses: number }).max_uses, 2);
  });

  it('el turno forzado lleva sólo dominio + título (sin resultados completos ni herramienta de búsqueda)', () => {
    const results = Array.from({ length: 14 }, (_, i) => ({ domain: `d${i % 12}.com`, title: `T${i}` }));
    const body = buildForcedSubmissionBody(INPUT, MODEL, results);
    assert.deepEqual(body.tool_choice, { type: 'tool', name: FIND_WEBSITE_TOOL_NAME });
    assert.deepEqual((body.tools as Array<{ name: string }>).map((t) => t.name), [FIND_WEBSITE_TOOL_NAME]);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    const text = body.messages[0].content as string;
    assert.ok(text.includes('Empresa: SII Group Colombia'));
    assert.equal((text.match(/^- d\d+\.com/gm) ?? []).length, FINDER_FORCED_TURN_MAX_RESULTS);
  });

  it('findOfficialWebsite: si no entrega, el 2.º turno NO reenvía la conversación; el uso se suma y la URL se comprueba con la 1.ª búsqueda', async () => {
    const bodies: AnthropicRequestBody[] = [];
    const out = await findOfficialWebsite(INPUT, MODEL, {
      runConversation: async (body) => (bodies.push(body), bodies.length === 1 ? searchOnly(['https://sii-group.com/']) : submit('https://sii-group.com')),
      fetchPage: async () => page(LINKED_HTML),
    });
    assert.equal(bodies.length, 2);
    assert.ok(!JSON.stringify(bodies[1]).includes('encrypted_content'));
    assert.ok(!bodies[1].messages.some((m) => m.role === 'assistant'));
    assert.ok((bodies[1].messages[0].content as string).includes('sii-group.com — Título 0'));
    assert.equal(out.found, true);
    assert.equal(out.usage?.inputTokens, 9400);
    assert.equal(out.usage?.webSearchRequests, 2);
  });

  it('un 400 del turno forzado conserva el uso del 1.er turno', async () => {
    let calls = 0;
    const out = await findOfficialWebsite(INPUT, MODEL, {
      runConversation: async () => {
        calls++;
        if (calls === 1) return searchOnly(['https://sii-group.com/']);
        throw new AnthropicApiError(400, 'http_400', 'invalid_request_error', { ...USAGE, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 });
      },
      fetchPage: async () => page(LINKED_HTML),
    });
    assert.equal(out.found, false);
    assert.equal(out.found ? null : out.errorCode, 'http_400');
    assert.equal(out.usage?.inputTokens, 9000);
    assert.equal(isRequestRejectedModelError(out), true);
    assert.equal(isAccountLevelModelError(out), false);
  });
});

describe('B. 400 de la petición ≠ cuenta caída', () => {
  const billed400 = {
    found: false as const,
    reason: 'model_error' as const,
    errorCode: 'http_400',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.03, pricingSource: 'table' as const },
  };
  const account400 = { ...billed400, usage: { ...billed400.usage, inputTokens: 0, estimatedCostUsd: 0 } };

  it('un 400 sin nada cobrado sigue siendo la cuenta; con el 1.er turno cobrado, no', () => {
    assert.equal(isAccountLevelModelError(account400), true);
    assert.equal(isAccountLevelModelError({ ...account400, usage: null }), true);
    assert.equal(isAccountLevelModelError(billed400), false);
    assert.equal(isRequestRejectedModelError(billed400), true);
  });

  it('el 400 de la petición es final: no se reintenta ni vuelve como «cuenta caída»', () => {
    const evidence = buildDomainSearchStaysEvidence({}, { kind: 'not_found', outcome: billed400 }, AT);
    assert.equal((evidence.claude_rescue as { decision: string }).decision, 'website_not_found');
    assert.equal((evidence[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { request_rejected?: boolean }).request_rejected, true);
    assert.equal(websiteNotFoundByAccountError(evidence), false);
    // La cuenta caída sigue como antes.
    const down = buildDomainSearchStaysEvidence({}, { kind: 'not_found', outcome: account400 }, AT);
    assert.equal((down.claude_rescue as { decision: string }).decision, 'retryable');
  });
});

const searched = (search: Record<string, unknown>, id = 'p1') => ({
  id,
  evidence: {
    [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { search_version: DOMAIN_SEARCH_VERSION, searched_at: AT, ...search },
  },
});
const FOUND_SEARCH = { found: true, website: 'https://sii-group.com', domain: 'sii-group.com', verification: 'name_match' };
const NOT_FOUND_SEARCH = { found: false, reason: 'identity_not_confirmed', claimed_url: 'https://otra.com', attempts: 1 };

describe('C. reutilizar lo ya buscado (misma empresa en otra fila)', () => {
  it('reutiliza el sitio comprobado, y lo prefiere a un «no encontrado»', () => {
    const out = reusablePriorDomainSearch([searched(NOT_FOUND_SEARCH, 'p0'), searched(FOUND_SEARCH)], NOW);
    assert.equal(out?.fromId, 'p1');
    assert.equal(out?.outcome.found, true);
    assert.equal(out?.outcome.found && out.outcome.domain, 'sii-group.com');
    assert.equal(out?.outcome.usage, null);
  });

  it('reutiliza un «no encontrado» final con la web propuesta (para pista / marca oficial)', () => {
    const out = reusablePriorDomainSearch([searched(NOT_FOUND_SEARCH)], NOW);
    assert.deepEqual(out?.outcome, {
      found: false,
      reason: 'identity_not_confirmed',
      claimedUrl: 'https://otra.com',
      errorCode: null,
      usage: null,
    });
  });

  it('una PISTA guardada vuelve como «página que no abre» con su web, para derivarla otra vez', () => {
    const out = reusablePriorDomainSearch([searched({ ...FOUND_SEARCH, verification: 'unverified_hint' })], NOW);
    assert.equal(out?.outcome.found, false);
    assert.equal(!out?.outcome.found && out?.outcome.reason, 'page_unreachable');
    assert.equal(!out?.outcome.found && out?.outcome.claimedUrl, 'https://sii-group.com');
  });

  it('no reutiliza: otra versión, demasiado vieja, error del modelo, saltada, o sin nombres oficiales cuando hacen falta', () => {
    const old = new Date(NOW - (DOMAIN_SEARCH_REUSE_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    assert.equal(reusablePriorDomainSearch([searched({ ...FOUND_SEARCH, search_version: 'd8' })], NOW), null);
    assert.equal(reusablePriorDomainSearch([searched({ ...FOUND_SEARCH, searched_at: old })], NOW), null);
    assert.equal(reusablePriorDomainSearch([searched({ found: false, reason: 'model_error', error_code: 'http_529' })], NOW), null);
    assert.equal(reusablePriorDomainSearch([searched({ found: false, skipped: 'known_tax_id' })], NOW), null);
    assert.equal(reusablePriorDomainSearch([searched(NOT_FOUND_SEARCH)], NOW, { officialNamesNeeded: true }), null);
    assert.ok(reusablePriorDomainSearch([searched({ ...NOT_FOUND_SEARCH, official_names_checked: true })], NOW, { officialNamesNeeded: true }));
    assert.equal(reusablePriorDomainSearch([{ id: 'x', evidence: null }], NOW), null);
  });
});

function disposition(id: string, overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id,
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

const PAID_NOT_FOUND = {
  found: false as const,
  reason: 'identity_not_confirmed' as const,
  claimedUrl: null,
  usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.03, pricingSource: 'table' as const },
};

function fakeDeps(rows: RescuableDispositionRow[], overrides: Partial<RescueBatchDeps> = {}, domainSearch: Partial<NonNullable<RescueBatchDeps['domainSearch']>> = {}) {
  const evidence = new Map<string, Record<string, unknown> | null>(rows.map((r) => [r.id, r.evidence]));
  const searches: string[] = [];
  const logs: Array<{ operation_key: string }> = [];
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'tec', industryName: TEC, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => rows,
    loadBatchIndustryId: async () => 'tec',
    classify: async (company) => classified(company),
    logUsage: async (input) => (logs.push(input as { operation_key: string }), true),
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? null);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id) => `new-${id}`,
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async (input) => (searches.push(input.name), PAID_NOT_FOUND),
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
      ...domainSearch,
    },
    nowIso: () => AT,
    nowMs: () => NOW,
    ...overrides,
  };
  return { deps, evidence, searches, logs };
}

describe('D. rescate: reutiliza sin pagar', () => {
  it('sitio ya comprobado en otra fila de la misma empresa ⇒ sin búsqueda ni gasto; sigue a revisión', async () => {
    const seen: unknown[] = [];
    const f = fakeDeps([disposition('d1', { provider_identifier: 'tax:900123' })], {}, {
      findPriorSearches: async (input) => (seen.push(input), [searched(FOUND_SEARCH)]),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 0);
    assert.equal(f.logs.filter((l) => l.operation_key === 'company_domain_search').length, 0);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.deepEqual(seen[0], { dispositionId: 'd1', taxId: '900123', name: 'colombia sii', countryCode: 'CO' });
  });

  it('«no encontrado» reciente en otra fila ⇒ se queda en Descartadas con `reused_from`, sin pagar', async () => {
    const f = fakeDeps([disposition('d1')], {}, { findPriorSearches: async () => [searched(NOT_FOUND_SEARCH)] });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
    const search = f.evidence.get('d1')![CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as Record<string, unknown>;
    assert.equal(search.reused_from, 'p1');
    assert.equal((f.evidence.get('d1')!.claude_rescue as { decision: string }).decision, 'website_not_found');
  });

  it('si la lectura de lo ya buscado falla, se busca como antes', async () => {
    const f = fakeDeps([disposition('d1')], {}, {
      findPriorSearches: async () => {
        throw new Error('db down');
      },
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 1);
  });
});

describe('E. tope de búsquedas pagadas por lote', () => {
  const rows = Array.from({ length: 4 }, (_, i) => disposition(`d${i}`));

  it(`con ${RESCUE_BATCH_MAX_DOMAIN_SEARCHES} ya pagadas no se busca ninguna ni se marca «en proceso»`, async () => {
    const f = fakeDeps(rows, { loadBatchDomainSearchCount: async () => RESCUE_BATCH_MAX_DOMAIN_SEARCHES });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 0);
    assert.equal(s.ok && s.dispositionsSearchCapped, 4);
    assert.equal(s.ok && s.remaining, 0);
    for (const r of rows) assert.equal(f.evidence.get(r.id)?.claude_rescue, undefined);
  });

  it('con una búsqueda libre se paga exactamente una (aunque corran en paralelo); las demás vuelven a como estaban', async () => {
    const f = fakeDeps(rows, { loadBatchDomainSearchCount: async () => RESCUE_BATCH_MAX_DOMAIN_SEARCHES - 1 });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 1);
    assert.equal(s.ok && s.dispositionsSearchCapped, 3);
    const untouched = rows.filter((r) => f.evidence.get(r.id)?.claude_rescue === undefined);
    assert.equal(untouched.length, 3);
  });

  it('sin lectura del conteo (null) cuentan las de esta corrida', async () => {
    const many = Array.from({ length: RESCUE_BATCH_MAX_DOMAIN_SEARCHES + 3 }, (_, i) => disposition(`d${i}`));
    const f = fakeDeps(many, { loadBatchDomainSearchCount: async () => null });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, RESCUE_BATCH_MAX_DOMAIN_SEARCHES);
  });

  it('un sitio ya guardado se sigue usando después del tope (no cuesta búsqueda)', async () => {
    const stored = disposition('d9', {
      evidence: { ...disposition('d9').evidence, [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { ...FOUND_SEARCH, search_version: DOMAIN_SEARCH_VERSION } },
    });
    const f = fakeDeps([stored], { loadBatchDomainSearchCount: async () => RESCUE_BATCH_MAX_DOMAIN_SEARCHES });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches.length, 0);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });
});

describe('F. lecturas reales (sólo SELECT)', () => {
  function fakeClient(result: unknown) {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'not', 'order']) {
      builder[m] = (...args: unknown[]) => (calls.push([m, args]), builder);
    }
    builder.limit = (...args: unknown[]) => (calls.push(['limit', args]), Promise.resolve(result));
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    const client = { from: (table: string) => (calls.push(['from', [table]]), builder) };
    return { client, calls };
  }

  it('readBatchDomainSearchCount cuenta las filas de company_domain_search del lote', async () => {
    const { client, calls } = fakeClient({ count: 7, error: null });
    assert.equal(await readBatchDomainSearchCount(client as never, 'b1'), 7);
    assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'operation_key' && a[1] === 'company_domain_search'));
    assert.deepEqual(calls[0], ['from', ['provider_usage_logs']]);
    const failed = fakeClient({ count: null, error: { message: 'x' } });
    assert.equal(await readBatchDomainSearchCount(failed.client as never, 'b1'), null);
  });

  it('findPriorDomainSearches busca por número fiscal y por nombre + país, sin repetir filas', async () => {
    const { client, calls } = fakeClient({ data: [searched(FOUND_SEARCH)], error: null });
    const rows = await findPriorDomainSearches(client as never, { dispositionId: 'd1', taxId: '900123', name: 'colombia sii', countryCode: 'CO' });
    assert.equal(rows.length, 1);
    assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'provider_identifier' && a[1] === 'tax:900123'));
    assert.ok(calls.some(([m, a]) => m === 'eq' && a[0] === 'name' && a[1] === 'colombia sii'));
    assert.ok(calls.some(([m, a]) => m === 'neq' && a[0] === 'id' && a[1] === 'd1'));
    assert.ok(calls.every(([m]) => ['from', 'select', 'eq', 'neq', 'not', 'order', 'limit'].includes(m)));
  });
});
