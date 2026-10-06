/**
 * Tests — Agente 1 · Claude busca el sitio oficial (AGENT1-CLAUDE-FIND-DOMAIN-1).
 *
 * Sin red ni base de datos: Claude, la descarga de la página, SellUp/HubSpot y
 * Supabase son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDomainFinderRequestBody,
  domainCarriesName,
  findOfficialWebsite,
  FIND_WEBSITE_TOOL_NAME,
  type DomainFinderDeps,
} from '../../domain-finder';
import type { AnthropicConversationResult, AnthropicRequestBody } from '../../anthropic-messages-client';
import type { SafePageFetchResult } from '../../../website-verifier';
import {
  buildDomainSearchUsageLog,
  CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
  dispositionDisplayName,
  dispositionLinkedInUrl,
  nameFromLinkedInSlug,
  DOMAIN_SEARCH_VERSION,
  buildDomainFinderInput,
  buildUnverifiedHintWebsiteVerification,
  countryNameFromCode,
  isAccountLevelModelError,
  registryNameCore,
  unverifiedWebsiteHint,
  UNVERIFIED_HINT_VERIFICATION,
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

function conversation(url: string | null, searchUrls: string[], titles: string[] = []): AnthropicConversationResult {
  return {
    content: [
      {
        type: 'web_search_tool_result',
        content: searchUrls.map((u, i) => ({ type: 'web_search_result', url: u, title: titles[i] ?? 'x' })),
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

  it('URL fuera de la búsqueda: sólo vale si el sitio enlaza al MISMO LinkedIn', async () => {
    const linked = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation('https://sii-group.com', ['https://otra.com/']), page(LINKED_HTML)),
    );
    assert.equal(linked.found, true);
    if (linked.found) assert.equal(linked.inSearchResults, false);

    const html = `<html><head><title>SII Group Colombia</title></head><body><p>${FILLER}</p></body></html>`;
    const byName = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation('https://sii-group.com', ['https://otra.com/']), page(html, 'https://sii-group.com/')),
    );
    assert.deepEqual(byName.found ? null : [byName.reason, byName.claimedUrl], ['not_in_search_results', 'https://sii-group.com']);
  });

  it('un subdominio de un resultado cuenta como «salió de la búsqueda»', async () => {
    const html = `<html><head><title>SII Group Colombia</title></head><body><p>${FILLER}</p></body></html>`;
    const out = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation('https://sii-group.com', ['https://careers.sii-group.com/jobs']), page(html, 'https://sii-group.com/')),
    );
    assert.equal(out.found && out.inSearchResults, true);
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

  it('sitio que bloquea nuestra descarga: vale el título del resultado de búsqueda de ese dominio', async () => {
    const url = 'https://www.unam.mx';
    const blocked = { ...page('', url), html: null, httpStatus: 403 };
    const input = { ...INPUT, name: 'Unam', alternateNames: ['unam'] };
    const ok = await findOfficialWebsite(
      input,
      MODEL,
      finderDeps(conversation(url, ['https://www.unam.mx/'], ['UNAM | Universidad Nacional Autónoma de México']), blocked),
    );
    assert.equal(ok.found && ok.verification, 'search_result_match');
    if (ok.found) assert.equal(ok.domain, 'unam.mx');

    // Mismo bloqueo, pero el título del resultado es de otra cosa ⇒ no.
    const no = await findOfficialWebsite(
      input,
      MODEL,
      finderDeps(conversation(url, ['https://www.unam.mx/'], ['Portal de trámites']), blocked),
    );
    assert.deepEqual(no.found ? null : [no.reason, no.errorCode], ['page_unreachable', 'http_403']);

    // Bloqueada y fuera de la búsqueda ⇒ no (no hay nada que no haya escrito Claude).
    const outside = await findOfficialWebsite(
      input,
      MODEL,
      finderDeps(conversation(url, ['https://otra.mx/'], ['UNAM']), blocked),
    );
    assert.equal(outside.found, false);
  });

  it('redirección a otro dominio vale si el destino también salió de la búsqueda', async () => {
    const claimed = 'https://siigroup.co';
    const ok = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation(claimed, [claimed, 'https://sii-group.com/es-CO']), page(LINKED_HTML, 'https://sii-group.com/es-CO')),
    );
    assert.equal(ok.found && ok.domain, 'sii-group.com');
    // El destino no salió de la búsqueda ⇒ no (parqueado, marketplace…).
    const no = await findOfficialWebsite(
      INPUT,
      MODEL,
      finderDeps(conversation(claimed, [claimed]), page(LINKED_HTML, 'https://sii-group.com/es-CO')),
    );
    assert.deepEqual(no.found ? null : no.reason, 'redirected_offsite');
  });

  it('las palabras de país no bajan el puntaje del nombre', async () => {
    const html = `<html><head><title>Pirelli | Neumáticos</title></head><body><p>${FILLER}</p></body></html>`;
    const url = 'https://www.pirelli.com';
    const out = await findOfficialWebsite({ ...INPUT, name: 'Pirelli México' }, MODEL, finderDeps(conversation(url, [url]), page(html, url)));
    assert.equal(out.found && out.verification, 'name_match');
  });

  it('el nombre se compara en todas sus formas (gana la mejor)', async () => {
    const html = `<html><head><title>Universidad Tecmilenio</title></head><body><p>${FILLER}</p></body></html>`;
    const url = 'https://tecmilenio.mx';
    const conv = conversation(url, [url]);
    const single = await findOfficialWebsite({ ...INPUT, name: 'Tecmilenio Monterrey' }, MODEL, finderDeps(conv, page(html, url)));
    const multi = await findOfficialWebsite(
      { ...INPUT, name: 'Tecmilenio Monterrey', alternateNames: ['tecmilenio'] },
      MODEL,
      finderDeps(conv, page(html, url)),
    );
    assert.equal(single.found, false);
    assert.equal(multi.found && multi.verification, 'name_match');
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
    // Sin nombre original (lote MX×Tec): el slug de LinkedIn conserva el orden de las palabras.
    assert.equal(
      dispositionDisplayName(
        disposition({
          name: 'america bbva en technology',
          evidence: { provider_raw_name: null, linkedin_url: 'linkedin.com/company/bbva-technology-en-america' },
        }),
      ),
      'Bbva Technology En America',
    );
    assert.equal(nameFromLinkedInSlug('linkedin.com/company/unam_3'), 'Unam');
    assert.equal(nameFromLinkedInSlug('linkedin.com/company/prepa-en-línea-sep-286'), 'Prepa En Línea Sep');
    assert.equal(nameFromLinkedInSlug(null), null);
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
  inSearchResults: true,
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

  it('un «no encontrado» de la versión anterior del buscador se reintenta una vez', () => {
    const old = {
      ...disposition().evidence,
      claude_rescue: { decision: 'website_not_found' },
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: false, reason: 'not_in_search_results' },
    };
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: old }, NOW, true), true);
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: old }, NOW, false), false);
    const current = {
      ...old,
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: false, reason: 'not_in_search_results', search_version: DOMAIN_SEARCH_VERSION },
    };
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: current }, NOW, true), false);
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

describe('d4 — razones sociales de registros oficiales (1.ª corrida de Chile, lote bd751c34)', () => {
  it('el nombre sin forma societaria ni palabras genéricas', () => {
    assert.equal(registryNameCore('ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA'), 'accenture');
    assert.equal(registryNameCore('SERVICIOS EQUIFAX CHILE LIMITADA'), 'equifax');
    assert.equal(registryNameCore('IBM CHILE SPA'), 'ibm');
    assert.equal(registryNameCore('SONDA S A'), 'sonda');
    assert.equal(registryNameCore('INDRA SISTEMAS CHILE S.A.'), 'indra');
    assert.equal(registryNameCore('Compañía Minera Doña Inés'), 'minera dona ines');
    // Nada cambia, o sólo quedan palabras genéricas o muy cortas ⇒ sin variante.
    assert.equal(registryNameCore('Sonda'), null);
    assert.equal(registryNameCore('SERVICIOS INTEGRALES SPA'), 'integrales');
    assert.equal(registryNameCore('EMPRESA DE SERVICIOS SPA'), null);
    assert.equal(registryNameCore('GE CHILE SPA'), null);
    assert.equal(registryNameCore(null), null);
    // Formas societarias con puntos y espacios (AR 17da92cf) y «COMPANY».
    assert.equal(registryNameCore('HEXACTA S. R. L.'), 'hexacta');
    assert.equal(registryNameCore('YEL INFORMATICA S.R.L'), 'yel informatica');
    assert.equal(registryNameCore('LEAFNOISE COMPANY S. A.'), 'leafnoise');
  });

  it('el país viaja por su nombre', () => {
    assert.equal(countryNameFromCode('cl'), 'Chile');
    assert.equal(countryNameFromCode('MX'), 'México');
    assert.equal(countryNameFromCode('ZZ'), null);
    assert.equal(countryNameFromCode(null), null);
  });

  it('la entrada del buscador lleva el país por su nombre y la variante sin forma societaria', () => {
    const input = buildDomainFinderInput(
      {
        id: 'd1',
        name: 'ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA',
        domain: null,
        country_code: 'CL',
        reason_code: 'missing_domain_final',
        evidence: { provider_raw_name: 'ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA' },
      },
      null,
    );
    assert.equal(input.name, 'ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA');
    assert.equal(input.countryName, 'Chile');
    assert.ok(input.alternateNames?.includes('accenture'));
    // Un país explícito manda sobre el del código.
    assert.equal(
      buildDomainFinderInput(
        { id: 'd2', name: 'x', domain: null, country_code: 'CL', reason_code: null, evidence: null },
        'República de Chile',
      ).countryName,
      'República de Chile',
    );
  });

  it('Accenture: la página dice «Accenture Chile» y ahora se confirma (antes identity_not_confirmed)', async () => {
    const html = `<html><head><title>Accenture Chile | Consultoría y tecnología</title></head><body><p>${FILLER}</p></body></html>`;
    const url = 'https://www.accenture.com/cl-es';
    const legal = 'ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA';
    const base = { name: legal, countryName: 'Chile', countryCode: 'CL', linkedinUrl: null };
    const before = await findOfficialWebsite(base, MODEL, finderDeps(conversation(url, [url]), page(html, url)));
    assert.deepEqual(before.found ? null : before.reason, 'identity_not_confirmed');
    const after = await findOfficialWebsite(
      { ...base, alternateNames: [registryNameCore(legal) as string] },
      MODEL,
      finderDeps(conversation(url, [url]), page(html, url)),
    );
    assert.equal(after.found && after.verification, 'name_match');
    assert.equal(after.found && after.domain, 'accenture.com');
  });

  it('la variante no basta si el sitio no salió de la búsqueda ni lleva el nombre en el dominio', async () => {
    const html = `<html><head><title>Accenture</title></head><body><p>${FILLER}</p></body></html>`;
    const url = 'https://www.consultora-global.com';
    const out = await findOfficialWebsite(
      { name: 'ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA', countryName: 'Chile', countryCode: 'CL', linkedinUrl: null, alternateNames: ['accenture'] },
      MODEL,
      finderDeps(conversation(url, ['https://otra.cl']), page(html, url)),
    );
    assert.deepEqual(out.found ? null : out.reason, 'not_in_search_results');
  });

  it('versión vigente: un «no encontrado» de una versión anterior se reintenta una vez', () => {
    assert.equal(DOMAIN_SEARCH_VERSION, 'd7');
  });
});

describe('d5 — nombre corto para buscar y dominio que lleva el nombre (Chile bd751c34, Argentina 17da92cf)', () => {
  const page200 = (title: string, url: string) =>
    page(`<html><head><title>${title}</title></head><body><p>${FILLER}</p></body></html>`, url);

  it('el dominio lleva el nombre: contenido (5+ letras) o al inicio (más corto); nunca un alojamiento compartido', () => {
    assert.equal(domainCarriesName('www.clarochile.cl', ['claro']), true);
    assert.equal(domainCarriesName('vtr.com', ['vtr']), true);
    assert.equal(domainCarriesName('ibm.com', ['ibm']), true);
    assert.equal(domainCarriesName('www.telecom.com.ar', ['telecom']), true);
    assert.equal(domainCarriesName('indragroup.com', ['indra']), true);
    assert.equal(domainCarriesName('stefanini.com', ['stefanini']), true);
    // Corto y no al inicio ⇒ no («NOW SPA» propuso hynow.cl).
    assert.equal(domainCarriesName('www.hynow.cl', ['now']), false);
    assert.equal(domainCarriesName('maconline.com', ['innovacion tecnologia']), false);
    assert.equal(domainCarriesName('claro.blogspot.com', ['claro']), false);
    assert.equal(domainCarriesName('clarochile.cl', []), false);
  });

  it('la entrada lleva el nombre corto para buscar y el prompt lo usa', () => {
    const input = buildDomainFinderInput(
      { id: 'd', name: 'VTR COMUNICACIONES SPA', domain: null, country_code: 'CL', reason_code: 'missing_domain_final', evidence: null },
      null,
    );
    assert.equal(input.searchHint, 'vtr');
    const body = buildDomainFinderRequestBody(input, MODEL);
    const text = JSON.stringify(body.messages);
    assert.match(text, /Nombre corto \(sin forma societaria\), úsalo para buscar: vtr/);
    assert.match(text, /País: Chile/);
    // Sin variante, el prompt no cambia.
    const plain = buildDomainFinderRequestBody({ ...INPUT }, MODEL);
    assert.doesNotMatch(JSON.stringify(plain.messages), /Nombre corto/);
  });

  it('fuera de la búsqueda vale si el dominio lleva el nombre Y la página lo confirma (vtr.com)', async () => {
    const url = 'https://www.vtr.com';
    const base = { name: 'VTR COMUNICACIONES SPA', countryName: 'Chile', countryCode: 'CL', linkedinUrl: null };
    const before = await findOfficialWebsite(base, MODEL, finderDeps(conversation(url, ['https://otra.cl']), page200('VTR | Internet, TV y telefonía', url)));
    assert.deepEqual(before.found ? null : before.reason, 'not_in_search_results');
    const after = await findOfficialWebsite(
      { ...base, alternateNames: ['vtr'] },
      MODEL,
      finderDeps(conversation(url, ['https://otra.cl']), page200('VTR | Internet, TV y telefonía', url)),
    );
    assert.equal(after.found && after.verification, 'name_match');
    assert.equal(after.found && after.inSearchResults, false);
  });

  it('fuera de la búsqueda, con el nombre en el dominio pero la página dice otra cosa ⇒ no', async () => {
    const url = 'https://www.vtr.com';
    const out = await findOfficialWebsite(
      { name: 'VTR COMUNICACIONES SPA', countryName: 'Chile', countryCode: 'CL', linkedinUrl: null, alternateNames: ['vtr'] },
      MODEL,
      finderDeps(conversation(url, ['https://otra.cl']), page200('Dominio en venta', url)),
    );
    assert.equal(out.found, false);
  });

  it('fuera de la búsqueda y sin el nombre en el dominio ⇒ sigue sin valer', async () => {
    const url = 'https://www.maconline.com';
    const out = await findOfficialWebsite(
      { name: 'INNOVACION Y TECNOLOGIA EMPRESARIAL ITEM LIMITADA', countryName: 'Chile', countryCode: 'CL', linkedinUrl: null, alternateNames: ['item'] },
      MODEL,
      finderDeps(conversation(url, ['https://otra.cl']), page200('Mac Online | ITEM', url)),
    );
    assert.deepEqual(out.found ? null : out.reason, 'not_in_search_results');
  });

  it('redirección a otro dominio que lleva el nombre: vale si la página lo confirma (indracompany.com → indragroup.com)', async () => {
    const claimed = 'https://www.indracompany.com';
    const final = 'https://www.indragroup.com/es';
    const input = { name: 'INDRA SISTEMAS CHILE S.A.', countryName: 'Chile', countryCode: 'CL', linkedinUrl: null, alternateNames: ['indra'] };
    const ok = await findOfficialWebsite(input, MODEL, finderDeps(conversation(claimed, [claimed]), page200('Indra Group | Tecnología', final)));
    assert.equal(ok.found && ok.domain, 'indragroup.com');
    // Redirección a un dominio sin el nombre ⇒ no.
    const no = await findOfficialWebsite(input, MODEL, finderDeps(conversation(claimed, [claimed]), page200('Indra', 'https://parked.example')));
    assert.deepEqual(no.found ? null : no.reason, 'redirected_offsite');
  });

  it('página que responde casi sin texto (JavaScript): vale su título si el dominio lleva el nombre', async () => {
    const url = 'https://www.sinergit.com.do';
    const thin = page('<html><head><title>Sinergit | Soluciones TI</title></head><body><div id="app"></div></body></html>', url);
    const input = { name: 'SINERGIT SRL', countryName: 'República Dominicana', countryCode: 'DO', linkedinUrl: null, alternateNames: ['sinergit'] };
    const ok = await findOfficialWebsite(input, MODEL, finderDeps(conversation(url, ['https://otra.do']), thin));
    assert.equal(ok.found && ok.verification, 'name_match');
    // Mismo caso, pero el título es de otra cosa ⇒ no.
    const other = page('<html><head><title>Cargando…</title></head><body></body></html>', url);
    const no = await findOfficialWebsite(input, MODEL, finderDeps(conversation(url, ['https://otra.do']), other));
    assert.deepEqual(no.found ? null : no.reason, 'page_unreachable');
    // Casi sin texto, sin el nombre en el dominio y fuera de la búsqueda ⇒ no.
    const far = await findOfficialWebsite(
      { ...input, alternateNames: [] },
      MODEL,
      finderDeps(conversation('https://www.tiendas-x.do', ['https://otra.do']), page('<html><head><title>Sinergit</title></head><body></body></html>', 'https://www.tiendas-x.do')),
    );
    assert.equal(far.found, false);
  });
});

describe('d6 — PISTA sin confirmar (dueña 06-10: «si pista»)', () => {
  const official = (overrides: Partial<RescuableDispositionRow> = {}) =>
    disposition({
      name: 'COASIN CHILE S.A',
      country_code: 'CL',
      evidence: { provider_raw_name: 'COASIN CHILE S.A', tax_identifier_present: true, tax_identifier_type: 'RUT' },
      ...overrides,
    });
  const unreachable = (url: string | null) =>
    ({ found: false, reason: 'page_unreachable', errorCode: 'fetch_error', claimedUrl: url, usage: FOUND.usage }) as const;

  it('sólo con página que no abre, número fiscal oficial, sin plataforma y dominio con el nombre', () => {
    const hint = unverifiedWebsiteHint(official(), unreachable('https://www.coasin.cl'));
    assert.deepEqual(hint, { website: 'https://coasin.cl', domain: 'coasin.cl', verification: UNVERIFIED_HINT_VERIFICATION });
    // Otro motivo ⇒ no.
    assert.equal(unverifiedWebsiteHint(official(), { found: false, reason: 'identity_not_confirmed', claimedUrl: 'https://coasin.cl', usage: null }), null);
    // Sin URL propuesta ⇒ no.
    assert.equal(unverifiedWebsiteHint(official(), unreachable(null)), null);
    // Sin número fiscal oficial (p. ej. Apollo) ⇒ no.
    assert.equal(unverifiedWebsiteHint(official({ evidence: { provider_raw_name: 'COASIN CHILE S.A' } }), unreachable('https://coasin.cl')), null);
    // Dominio sin el nombre ⇒ no.
    assert.equal(unverifiedWebsiteHint(official(), unreachable('https://www.redes-industriales.cl')), null);
    // Plataforma ⇒ no.
    assert.equal(unverifiedWebsiteHint(official(), unreachable('https://www.linkedin.com/company/coasin')), null);
    // Encontrado ⇒ no es pista.
    assert.equal(unverifiedWebsiteHint(official(), FOUND), null);
  });

  it('el vendedor ve «Inferido» con el motivo, nunca «Verificado»', () => {
    const wv = buildUnverifiedHintWebsiteVerification({ website: 'https://coasin.cl', domain: 'coasin.cl', verification: UNVERIFIED_HINT_VERIFICATION });
    assert.equal(wv?.status, 'inferred');
    assert.equal(wv?.domain, 'coasin.cl');
    assert.match(String(wv?.reason), /Pista sin confirmar/);
    assert.equal(buildUnverifiedHintWebsiteVerification({ website: 'https://x.cl', domain: 'x.cl', verification: 'name_match' }), null);
  });

  it('rescate completo: la pista pasa por duplicados y clasificación y llega a revisión marcada', async () => {
    const f = fakeDeps({
      loadDispositions: async () => [official()],
      domainSearch: {
        findWebsite: async () => unreachable('https://www.coasin.cl'),
        checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.equal(f.classifiedCompanies[0].websiteOrDomain, 'https://coasin.cl');
    const origin = f.origins[0];
    assert.equal(origin.columns?.domain, 'coasin.cl');
    assert.equal((origin.metadata[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { verification: string }).verification, 'unverified_hint');
    assert.equal((origin.metadata.website_verification as { status: string }).status, 'inferred');
  });

  it('la pista que ya está en HubSpot se queda en Descartadas', async () => {
    const f = fakeDeps({
      loadDispositions: async () => [official()],
      domainSearch: {
        findWebsite: async () => unreachable('https://www.coasin.cl'),
        checkDuplicate: async () => ({ status: 'existing_in_hubspot', summary: 'Ya está' }),
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.origins.length, 0);
  });

  it('sin número fiscal oficial, una página que no abre sigue siendo reintentable (como antes)', async () => {
    const f = fakeDeps({
      domainSearch: {
        findWebsite: async () => unreachable('https://sii-group.com'),
        checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
      },
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.origins.length, 0);
    assert.equal((f.evidence.get('d1')!.claude_rescue as { decision: string }).decision, 'retryable');
  });
});

describe('pista con formas societarias con puntos (AR 17da92cf)', () => {
  it('HEXACTA S. R. L. con hexacta.com que no abre ⇒ pista', () => {
    const row = disposition({
      name: 'HEXACTA S. R. L.',
      country_code: 'AR',
      evidence: { provider_raw_name: 'HEXACTA S. R. L.', tax_identifier_present: true, tax_identifier_type: 'CUIT' },
    });
    const hint = unverifiedWebsiteHint(row, {
      found: false,
      reason: 'page_unreachable',
      errorCode: 'fetch_error',
      claimedUrl: 'https://www.hexacta.com',
      usage: null,
    });
    assert.equal(hint?.domain, 'hexacta.com');
  });
});

describe('cuenta de Anthropic caída (Prod 06-10 13:07Z, 194 × http_400)', () => {
  const accountDown = { found: false, reason: 'model_error', errorCode: 'http_400', usage: null } as const;

  it('un error de la cuenta se reconoce; uno pasajero o de página no', () => {
    assert.equal(isAccountLevelModelError(accountDown), true);
    for (const code of ['http_401', 'http_402', 'http_403']) {
      assert.equal(isAccountLevelModelError({ ...accountDown, errorCode: code }), true, code);
    }
    assert.equal(isAccountLevelModelError({ ...accountDown, errorCode: 'http_529' }), false);
    assert.equal(isAccountLevelModelError({ ...accountDown, errorCode: 'unexpected_error' }), false);
    assert.equal(isAccountLevelModelError({ found: false, reason: 'page_unreachable', errorCode: 'http_403', usage: null }), false);
    assert.equal(isAccountLevelModelError(FOUND), false);
  });

  it('no gasta intentos: tras muchos errores de la cuenta la fila sigue siendo reintentable', async () => {
    let ev: Record<string, unknown> | null = disposition().evidence;
    for (let run = 0; run < 5; run++) {
      const f = fakeDeps({
        loadDispositions: async () => [disposition({ evidence: ev })],
        patchDispositionEvidence: async (_id, build) => ((ev = build(ev)), true),
        domainSearch: {
          findWebsite: async () => accountDown,
          checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
        },
      });
      await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    }
    assert.equal((ev!.claude_rescue as { decision: string }).decision, 'retryable');
    assert.equal((ev![CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { attempts: number }).attempts, 0);
  });

  it('al primer error de la cuenta no se empieza ninguna empresa más', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => disposition({ id: `d${i}` }));
    let searches = 0;
    const f = fakeDeps({
      loadDispositions: async () => rows,
      domainSearch: {
        findWebsite: async () => (searches++, accountDown),
        checkDuplicate: async () => ({ status: 'new_candidate', summary: '' }),
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    // Sólo las que ya estaban en curso (una por hilo) llegan a llamar.
    assert.ok(searches <= 4, `búsquedas: ${searches}`);
    assert.ok(s.ok);
  });

  it('las filas que ya quedaron «sitio no encontrado» por la cuenta caída vuelven a intentarse', () => {
    const burned = {
      ...disposition().evidence,
      claude_rescue: { decision: 'website_not_found' },
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: {
        found: false,
        reason: 'model_error',
        error_code: 'http_400',
        attempts: 3,
        search_version: DOMAIN_SEARCH_VERSION,
      },
    };
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: burned }, NOW, true), true);
    // Un «no encontrado» de verdad (o un error pasajero agotado) sigue siendo final.
    const real = {
      ...burned,
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: false, reason: 'identity_not_confirmed', search_version: DOMAIN_SEARCH_VERSION },
    };
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: real }, NOW, true), false);
    const transient = {
      ...burned,
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: false, reason: 'model_error', error_code: 'http_529', attempts: 3, search_version: DOMAIN_SEARCH_VERSION },
    };
    assert.equal(needsDispositionRescue({ ...disposition(), evidence: transient }, NOW, true), false);
  });
});
