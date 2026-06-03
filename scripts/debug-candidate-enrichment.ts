/**
 * Laboratorio de diagnóstico de enriquecimiento — 16AK.16
 *
 * Ejecuta enriquecimiento controlado sobre UN candidato específico
 * y emite un reporte de diagnóstico detallado.
 *
 * DRY RUN por defecto:
 *   - No escribe en Supabase.
 *   - No modifica candidato.
 *   - No crea lotes.
 *   - No toca HubSpot.
 *
 * Uso:
 *   npx tsx scripts/debug-candidate-enrichment.ts --candidate-id <uuid>
 *   npx tsx scripts/debug-candidate-enrichment.ts \
 *     --name "ANGELICAL Y MANANTIAL SAS" \
 *     --nit "901955673" \
 *     --country "Colombia" \
 *     --city "Bucaramanga" \
 *     --region "Santander"
 *
 * Variables de entorno requeridas (en .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL      — para lookup por --candidate-id
 *   SUPABASE_SERVICE_ROLE_KEY     — para lookup por --candidate-id
 *   TAVILY_API_KEY                — para búsquedas reales
 *   ANTHROPIC_API_KEY             — para evaluación Claude
 *
 * Casos de prueba documentados:
 *   Caso 1: ANGELICAL Y MANANTIAL SAS   NIT 901955673  Bucaramanga
 *   Caso 2: PRONALTE LIMITADA           NIT 800236140  Cali
 *   Caso 3: INVERSIONES DIRC LTDA       NIT 800077031  Cali
 *   Caso 4: AGENCIA DE SEGUROS SANTORINI LTDA  NIT 901951637  Bogotá
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Carga .env.local desde la raíz del proyecto para que el script tenga
// acceso a NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
config({ path: resolve(process.cwd(), '.env.local') });

// ─── Relative imports from prospecting-toolkit ────────────────────────────────
// Uses relative paths to avoid tsconfig @/ alias dependency in scripts.
import {
  buildSearchQueriesByIntent,
  scoreWebEvidence,
  extractWebEnrichmentResult,
  buildPublicDescription,
  hasHighConfidenceEvidence,
  isOfficialWebsiteCandidate,
  getOfficialWebsiteRejectionReason,
  hasMinimumEvidenceForClaude,
  extractDomainFromUrl,
  buildCompanyNameVariants,
  scoreEntityMatch,
  extractColombianTaxIdentifiersFromText,
  hasTaxIdentifierConflict,
  getDistinctiveCompanyTokens,
  normalizeNIT,
  getCountrySearchContext,
  type CandidateBasicInfo,
  type ScoredWebResult,
  type WebEnrichmentResult,
} from '../src/server/agents/prospecting-toolkit/web-evidence-scorer';

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = val;
      if (val !== 'true') i++;
    }
  }
  return args;
}



// ─── Tavily direct fetch (bypass Vault for debug) ─────────────────────────────

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
  response_time?: number;
}

async function fetchTavily(
  query: string,
  apiKey: string,
  maxResults = 5,
): Promise<Array<{ url: string; title: string; snippet: string | null }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: maxResults, search_depth: 'basic', include_raw_content: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Tavily HTTP ${resp.status}`);
    const data = (await resp.json()) as TavilyResponse;
    return (data.results ?? [])
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map((r) => ({ url: r.url!, title: r.title ?? r.url!, snippet: r.content ?? null }));
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Anthropic direct fetch ───────────────────────────────────────────────────

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

async function fetchAnthropic(
  prompt: string,
  apiKey: string,
  model = 'claude-haiku-4-5-20251001',
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = (await resp.json()) as AnthropicResponse;
    const textContent = data.content.find((c) => c.type === 'text');
    if (!textContent) throw new Error('Anthropic: no text content');
    return { text: textContent.text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Prompt builder (standalone — mirrors official-candidate-enricher) ─────────

function buildDebugEvaluationPrompt(
  candidate: CandidateBasicInfo & { id?: string },
  scoredResults: ScoredWebResult[],
  queriesRun: string[],
  industry: string,
  preWebsite: string | null,
  preLinkedIn: string | null,
): string {
  const name = candidate.legal_name ?? candidate.name ?? 'Empresa desconocida';
  const evidenceBlock = scoredResults
    .map((r, i) =>
      [
        `[${i + 1}] Tipo: ${r.source_type.toUpperCase()} | Confidence: ${r.confidence} | Score: ${r.raw_score}`,
        `    URL: ${r.url}`,
        `    Título: ${r.title}`,
        r.snippet ? `    Texto: ${r.snippet.slice(0, 280)}` : '',
      ].filter(Boolean).join('\n'),
    )
    .join('\n\n');

  return `Eres un evaluador de evidencia comercial para SellUp, plataforma B2B Colombia.

EMPRESA (fuente oficial):
- Nombre: ${name}
${candidate.tax_identifier ? `- NIT: ${candidate.tax_identifier}` : ''}
${candidate.city ? `- Ciudad: ${candidate.city}` : ''}
- Sector registrado: ${candidate.industry ?? industry}
- País: Colombia

BÚSQUEDAS REALIZADAS (${queriesRun.length}):
${queriesRun.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}

EVIDENCIA WEB PRE-CLASIFICADA (${scoredResults.length} resultados):
${evidenceBlock || '(sin resultados)'}

EXTRACCIÓN PREVIA (sistema local):
${preWebsite ? `- Website detectado: ${preWebsite}` : '- Website: no detectado'}
${preLinkedIn ? `- LinkedIn detectado: ${preLinkedIn}` : '- LinkedIn: no detectado'}

INDUSTRIA objetivo: ${industry}

INSTRUCCIONES:
1. Usa SOLO evidencia de los resultados. No inventes datos.
2. website/domain: SOLO fuentes OFFICIAL_WEBSITE con confidence high/medium.
3. company_linkedin_url: SOLO /company/ con match fuerte de nombre.
4. Si solo hay directorios, repositorios o fuentes académicas: website = null.
5. fit_score: null si menos de 2 resultados con texto relevante.

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "website": "<URL propia empresa o null>",
  "domain": "<dominio sin www o null>",
  "company_linkedin_url": "<URL /company/ con match fuerte o null>",
  "description": "<1-2 frases desde snippets high/medium o null>",
  "commercial_signals": ["<señal explícita>"],
  "fit_score": <0-100 o null>,
  "fit_status": "high" | "medium" | "low" | "unknown",
  "fit_reasons": ["<razón>"],
  "risks": ["<riesgo>"],
  "missing_fields": ["<campo sin evidencia>"],
  "summary": "<1 oración resumen>",
  "evidence_used": ["<url>"],
  "field_confidence": {
    "website": "high"|"medium"|"low"|"unknown",
    "linkedin": "high"|"medium"|"low"|"unknown",
    "description": "high"|"medium"|"low"|"unknown",
    "company_size": "high"|"medium"|"low"|"unknown",
    "sector": "high"|"medium"|"low"|"unknown"
  }
}`;
}

// ─── Report printer ───────────────────────────────────────────────────────────

const SEP = '─'.repeat(70);
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function h1(text: string) { console.log(`\n${BOLD}${CYAN}${'═'.repeat(70)}${RESET}`); console.log(`${BOLD}${CYAN}  ${text}${RESET}`); console.log(`${BOLD}${CYAN}${'═'.repeat(70)}${RESET}`); }
function h2(text: string) { console.log(`\n${BOLD}  ▶ ${text}${RESET}`); console.log(`  ${SEP}`); }
function ok(text: string) { console.log(`  ${GREEN}✓${RESET} ${text}`); }
function warn(text: string) { console.log(`  ${YELLOW}⚠${RESET} ${text}`); }
function err(text: string) { console.log(`  ${RED}✗${RESET} ${text}`); }
function info(label: string, value: unknown) {
  const v = value === null || value === undefined ? `${DIM}(null)${RESET}` : String(value);
  console.log(`  ${DIM}${label.padEnd(28)}${RESET}${v}`);
}
function dim(text: string) { console.log(`  ${DIM}${text}${RESET}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

interface CandidateInput extends CandidateBasicInfo {
  id?: string;
  website?: string | null;
  domain?: string | null;
  company_linkedin_url?: string | null;
  region?: string | null;
  country?: string | null;
  industry_raw?: string | null;
}

async function main() {
  const args = parseArgs();

  h1('SellUp — Laboratorio de diagnóstico de enriquecimiento (16AK.16)');
  console.log(`  ${DIM}DRY RUN — sin escrituras, sin HubSpot, sin lotes${RESET}`);

  // ── Load env ─────────────────────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  // Intenta leer keys desde process.env primero; si no, las lee de Supabase Vault.
  async function readKeyFromVault(vaultName: string): Promise<string | null> {
    if (!supabaseUrl || !serviceKey) return null;
    try {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data, error } = await admin.rpc('get_vault_secret_decrypted', { p_name: vaultName });
      if (error || !data) return null;
      return data as string;
    } catch {
      return null;
    }
  }

  let tavilyKey: string | null = process.env.TAVILY_API_KEY ?? null;
  let anthropicKey: string | null = process.env.ANTHROPIC_API_KEY ?? null;

  if (!tavilyKey) {
    tavilyKey = await readKeyFromVault('sellup_tavily_api_key');
    if (tavilyKey) console.log(`  ${DIM}[env] TAVILY_API_KEY cargada desde Supabase Vault.${RESET}`);
    else warn('TAVILY_API_KEY no configurada — búsquedas reales deshabilitadas.');
  }
  if (!anthropicKey) {
    anthropicKey = await readKeyFromVault('sellup_ai_anthropic');
    if (anthropicKey) console.log(`  ${DIM}[env] ANTHROPIC_API_KEY cargada desde Supabase Vault.${RESET}`);
    else warn('ANTHROPIC_API_KEY no configurada — evaluación Claude deshabilitada.');
  }

  // ── Resolve candidate ─────────────────────────────────────────────────────────
  let candidate: CandidateInput;

  if (args['candidate-id']) {
    if (!supabaseUrl || !serviceKey) {
      err('--candidate-id requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
      process.exit(1);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error: loadErr } = await admin
      .from('prospect_candidates')
      .select('id, name, legal_name, tax_identifier, city, industry, website, domain, country_code, metadata')
      .eq('id', args['candidate-id'])
      .single();
    if (loadErr || !data) {
      err(`Candidato no encontrado: ${args['candidate-id']} — ${loadErr?.message ?? 'sin datos'}`);
      process.exit(1);
    }
    candidate = data as CandidateInput;
  } else if (args['name']) {
    // --rut is an alias for --nit (Chile-friendly) — 16AK.17B
    const taxId = args['rut'] ?? args['nit'] ?? null;
    // Derive country_code from --country-code or --country arg
    const countryArg = (args['country-code'] ?? args['country'] ?? 'Colombia').trim();
    let derivedCountryCode: string | null = null;
    if (countryArg.toUpperCase() === 'CL' || countryArg.toLowerCase() === 'chile') {
      derivedCountryCode = 'CL';
    } else if (countryArg.toUpperCase() === 'CO' || countryArg.toLowerCase() === 'colombia') {
      derivedCountryCode = 'CO';
    } else {
      derivedCountryCode = countryArg.length === 2 ? countryArg.toUpperCase() : 'CO';
    }
    candidate = {
      id: undefined,
      name: args['name'] ?? null,
      legal_name: args['name'] ?? null,
      tax_identifier: taxId,
      city: args['city'] ?? null,
      industry: args['industry'] ?? null,
      country_code: derivedCountryCode,
      website: null,
      domain: null,
      country: countryArg,
      region: args['region'] ?? null,
    };
  } else {
    err('Uso: --candidate-id <uuid>  o  --name "NOMBRE" --nit "NIT" --city "Ciudad"');
    process.exit(1);
  }

  const industry = candidate.industry ?? args['industry'] ?? 'No especificado';

  // ─── A. Candidate input ───────────────────────────────────────────────────────
  h2('A. Candidate input');
  const candidateCtx = getCountrySearchContext(candidate);
  info('ID', candidate.id ?? '(inline — no DB)');
  info('name', candidate.name);
  info('legal_name', candidate.legal_name);
  info(`tax_identifier (${candidateCtx.taxIdLabel})`, candidate.tax_identifier);
  info('country_code', candidate.country_code ?? '(not set — defaulting to CO)');
  info('city', candidate.city);
  info('region', candidate.region ?? args['region'] ?? null);
  info('country', candidate.country ?? candidateCtx.countryTerm);
  info('industry', candidate.industry);
  info('website (actual)', candidate.website ?? null);
  info('domain (actual)', candidate.domain ?? null);

  // ─── B. Search plan ───────────────────────────────────────────────────────────
  h2('B. Search plan');

  console.log(`  ${DIM}Country context (16AK.17B):${RESET}`);
  info('  country_term', candidateCtx.countryTerm);
  info('  tax_id_label', candidateCtx.taxIdLabel);
  info('  registry_label', candidateCtx.officialRegistryLabel);
  info('  preferred_tlds', candidateCtx.preferredTLDs.join(', '));
  info('  foreign_hints', candidateCtx.foreignHints.slice(0, 6).join(', '));

  const nameVariants = buildCompanyNameVariants(
    candidate.legal_name ?? candidate.name ?? '',
    candidate.city,
    candidate.tax_identifier,
  );
  console.log(`  ${DIM}Name variants:${RESET}`);
  for (const v of nameVariants) dim(`  · "${v}"`);

  const queries = buildSearchQueriesByIntent(candidate, industry);
  console.log(`\n  ${DIM}Queries por intent:${RESET}`);
  for (const q of queries) {
    console.log(`  ${YELLOW}[${q.intent}]${RESET} ${q.query}`);
  }
  info('Max queries', `${queries.length} (early-stop si evidencia suficiente tras q1)`);
  info('Max results/query', '5');

  // ─── C. Tavily raw results ────────────────────────────────────────────────────
  h2('C. Tavily raw results');

  const rawResults: Array<{ url: string; title: string; snippet: string | null; query: string; intent: string }> = [];
  let tavilyCalls = 0;
  const queriesRun: string[] = [];

  if (!tavilyKey) {
    warn('Tavily deshabilitado — mostrando queries que se ejecutarían.');
  } else {
    let earlyStop = false;
    for (const strategy of queries) {
      if (earlyStop) break;
      tavilyCalls++;
      console.log(`\n  → Query [${strategy.intent}]: "${strategy.query}"`);
      try {
        const results = await fetchTavily(strategy.query, tavilyKey, 5);
        queriesRun.push(strategy.query);

        for (const r of results) {
          rawResults.push({ ...r, query: strategy.query, intent: strategy.intent });
        }

        // Early-stop check
        const preview = scoreWebEvidence(candidate, rawResults.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet })));
        if (hasHighConfidenceEvidence(preview)) {
          ok(`Early-stop: evidencia suficiente tras ${tavilyCalls} query(s).`);
          earlyStop = true;
        }

        for (const r of results) {
          const domain = extractDomainFromUrl(r.url) ?? '?';
          console.log(`    ${DIM}[${domain}]${RESET} ${r.title.slice(0, 70)}`);
          if (r.snippet) dim(`    ${r.snippet.slice(0, 120)}…`);
        }
      } catch (fetchErr) {
        err(`Tavily falló en query "${strategy.query}": ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
        queriesRun.push(strategy.query);
      }
    }
    console.log(`\n  Queries ejecutadas: ${tavilyCalls} | Resultados totales: ${rawResults.length}`);
  }

  if (rawResults.length === 0 && tavilyKey) {
    warn('Sin resultados de Tavily — continuando con reporte de clasificación vacío.');
  }

  // ─── D. Classification ────────────────────────────────────────────────────────
  h2('D. Classification (scoring local)');

  const plainResults = rawResults.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
  const scoredResults: ScoredWebResult[] = scoreWebEvidence(candidate, plainResults);

  if (scoredResults.length === 0) {
    dim('Sin resultados para clasificar.');
  } else {
    for (let i = 0; i < rawResults.length; i++) {
      const raw = rawResults[i];
      const scored = scoredResults[i];
      if (!scored) continue;
      const domain = extractDomainFromUrl(scored.url) ?? '?';
      const rejectionReason = getOfficialWebsiteRejectionReason(domain);
      const isBlockedAsOfficial = rejectionReason !== null;
      const isLinkedIn = scored.source_type === 'linkedin_company';
      const isOfficialCandidate = isOfficialWebsiteCandidate(scored.url);
      const nameMatch = scoreEntityMatch(
        candidate.legal_name ?? candidate.name ?? '',
        `${scored.title} ${scored.snippet ?? ''}`,
        candidate.city,
        candidate.tax_identifier,
      );

      // NIT analysis for this result
      const evidenceFullText = `${scored.url} ${scored.title} ${scored.snippet ?? ''}`;
      const extractedTaxIds = extractColombianTaxIdentifiersFromText(evidenceFullText);
      const taxCheck = hasTaxIdentifierConflict(candidate.tax_identifier, evidenceFullText);
      const candidateNitNorm = normalizeNIT(candidate.tax_identifier ?? '');

      // Distinctive tokens analysis for LinkedIn
      const { distinctive: distinctiveTokens, generic: genericTokens } = getDistinctiveCompanyTokens(
        candidate.legal_name ?? candidate.name ?? '',
      );
      const evidenceLower = evidenceFullText.toLowerCase();
      const matchedDistinctive = distinctiveTokens.filter((t) => evidenceLower.includes(t));

      console.log(`\n  ${BOLD}[${i + 1}] ${scored.title.slice(0, 60)}${RESET}`);
      info('  URL', scored.url);
      info('  Domain', domain);
      info('  Query intent', `${raw.intent}`);
      info('  source_type', scored.source_type);
      info('  confidence', scored.confidence);
      info('  raw_score', scored.raw_score);
      info('  entity_match_score', nameMatch);
      info('  matched_signals', scored.matched_signals.join(', ') || '(ninguno)');

      // ── NIT diagnostic ────────────────────────────────────────────
      info('  extracted_tax_ids', extractedTaxIds.length > 0 ? extractedTaxIds.join(', ') : '(ninguno)');
      if (taxCheck === 'match') {
        ok(`  tax_id_match = true  (NIT candidato ${candidateNitNorm} encontrado)`);
      } else if (taxCheck === 'conflict') {
        err(`  tax_id_conflict = true  (NIT diferente al candidato: ${extractedTaxIds.join(', ')} ≠ ${candidateNitNorm})`);
      } else {
        dim(`  tax_id_neutral (sin NIT en evidencia)`);
      }

      // ── Distinctive token diagnostic ──────────────────────────────
      if (isLinkedIn) {
        info('  distinctive_tokens', distinctiveTokens.length > 0 ? distinctiveTokens.join(', ') : '(ninguno)');
        info('  generic_tokens_ignored', genericTokens.length > 0 ? genericTokens.join(', ') : '(ninguno)');
        info('  matched_distinctive_tokens', matchedDistinctive.length > 0 ? matchedDistinctive.join(', ') : '(ninguno)');
      }

      if (isBlockedAsOfficial) {
        err(`  Rechazado como website oficial: ${rejectionReason}`);
      } else if (isOfficialCandidate && scored.source_type === 'official_website') {
        ok(`  Candidato a website oficial`);
      }

      if (isLinkedIn) {
        if (nameMatch >= 70 && matchedDistinctive.length > 0) {
          ok(`  linkedin_verdict_reason: CONFIRMADO (name_match=${nameMatch} ≥ 70, token distintivo "${matchedDistinctive[0]}" presente)`);
        } else if (nameMatch >= 70 && distinctiveTokens.length > 0 && matchedDistinctive.length === 0) {
          err(`  linkedin_verdict_reason: RECHAZADO — name_match=${nameMatch} ≥ 70 pero ningún token distintivo [${distinctiveTokens.join(', ')}] en evidencia`);
        } else if (nameMatch >= 70 && distinctiveTokens.length === 0) {
          warn(`  linkedin_verdict_reason: POSIBLE — name_match=${nameMatch} ≥ 70 pero nombre sin tokens distintivos (solo genéricos)`);
        } else if (nameMatch >= 20) {
          warn(`  linkedin_verdict_reason: POSIBLE (name_match=${nameMatch}, umbral confirmado=70)`);
        } else {
          err(`  linkedin_verdict_reason: RECHAZADO (name_match=${nameMatch} < 20)`);
        }
      }

      // ── Geographic coherence (16AK.17B) ─────────────────────────────────────
      const geo = scored.geographic_coherence;
      if (geo) {
        if (geo.coherent) {
          ok(`  geo_coherent: true  signals=[${geo.country_signals_found.join(', ')}]`);
        } else {
          err(`  geo_coherent: false  reason=${geo.rejection_reason ?? 'unknown'}`);
          if (geo.foreign_signals_found.length > 0) {
            err(`  foreign_signals_found: ${geo.foreign_signals_found.join(', ')}`);
          }
        }
        info('  country_signals_found', geo.country_signals_found.join(', ') || '(ninguno)');
        info('  matched_city_region', String(geo.matched_city_region));
        info('  matched_tax_id', String(geo.matched_tax_id));
        info('  matched_exact_legal_name', String(geo.matched_exact_legal_name));
      } else {
        dim(`  geo_coherent: (not computed — country_code not set)`);
      }

      if (scored.snippet) dim(`  Snippet: ${scored.snippet.slice(0, 150)}…`);
    }
  }

  // ─── E. Final extracted fields ────────────────────────────────────────────────
  h2('E. Final extracted fields (extracción local)');

  const webResult: WebEnrichmentResult = extractWebEnrichmentResult(candidate, scoredResults);
  const publicDesc = buildPublicDescription(scoredResults);

  console.log(`\n  ${BOLD}official_website:${RESET}`);
  if (webResult.official_website) {
    ok(`${webResult.official_website.url}`);
    info('    domain', webResult.official_website.domain);
    info('    confidence', webResult.official_website.confidence);
    info('    reason', webResult.official_website.reason);
  } else {
    err('null — ningún resultado pasó los filtros de website oficial');
  }

  console.log(`\n  ${BOLD}linkedin_company:${RESET}`);
  if (webResult.linkedin_company) {
    ok(`${webResult.linkedin_company.url}`);
    info('    confidence', webResult.linkedin_company.confidence);
    info('    reason', webResult.linkedin_company.reason);
  } else {
    err('null — no hay LinkedIn confirmado con name_match ≥ 70');
  }

  if (webResult.possible_linkedin_matches.length > 0) {
    console.log(`\n  ${BOLD}possible_linkedin_matches (${webResult.possible_linkedin_matches.length}):${RESET}`);
    for (const m of webResult.possible_linkedin_matches) {
      warn(`  ${m.url}  [${m.match_quality}] ${m.reason}`);
    }
  }

  if (webResult.public_evidence.length > 0) {
    console.log(`\n  ${BOLD}public_evidence (${webResult.public_evidence.length}):${RESET}`);
    for (const e of webResult.public_evidence) {
      dim(`  · [${e.source_type}] [${e.confidence}] ${e.url}`);
    }
  } else {
    dim('\n  public_evidence: (vacío)');
  }

  if (webResult.rejected_as_official_website.length > 0) {
    console.log(`\n  ${BOLD}rejected_as_official_website (${webResult.rejected_as_official_website.length}):${RESET}`);
    for (const r of webResult.rejected_as_official_website) {
      err(`  · ${r.domain} — ${r.reason}`);
    }
  }

  if (publicDesc) {
    console.log(`\n  ${BOLD}public_description:${RESET}`);
    dim(`  "${publicDesc.text.slice(0, 200)}"`);
    info('    confidence', publicDesc.confidence);
  }

  // Limited public data flag
  const hasNoWebsite = !webResult.official_website && !candidate.website;
  const hasNoLinkedIn = !webResult.linkedin_company;
  const hasNoDescription = !publicDesc;
  const limitedPublicData = hasNoWebsite && hasNoLinkedIn && hasNoDescription;
  if (limitedPublicData) {
    warn('limited_public_data = true  (se agregaría a review_flags si se hiciera apply)');
  } else {
    ok('limited_public_data = false');
  }

  // ─── F. Gate summary (16AK.17B) ──────────────────────────────────────────────
  h2('F. Gate summary (Digital Presence Gate)');

  const isChile = candidate.country_code === 'CL';
  const hasAnyCoherentResult = scoredResults.some((r) => r.geographic_coherence?.coherent === true);
  const allResultsForeign = scoredResults.length > 0 && !hasAnyCoherentResult;

  const shouldCallClaude = hasMinimumEvidenceForClaude(webResult, scoredResults, candidate);
  const apolloAllowed = !!webResult.official_website;
  const apolloSkipReason = apolloAllowed ? null : isChile ? 'no_confirmed_country_coherent_domain' : 'no_confirmed_domain';

  // Gate decision
  const gatePass = !!(webResult.official_website || webResult.linkedin_company);
  const gateReason = isChile && allResultsForeign
    ? 'foreign_entity_matches_only'
    : !webResult.official_website && !webResult.linkedin_company && webResult.public_evidence.length === 0
    ? 'no_digital_presence'
    : !webResult.official_website && !webResult.linkedin_company
    ? 'public_evidence_only_no_confirmed_site'
    : webResult.official_website
    ? 'official_website_confirmed'
    : 'linkedin_confirmed';

  if (gatePass) {
    ok(`Gate: PASS  (${gateReason})`);
  } else {
    err(`Gate: FAIL  (${gateReason})`);
  }
  info('  official_website', webResult.official_website?.url ?? null);
  info('  linkedin_company', webResult.linkedin_company?.url ?? null);

  if (isChile) {
    info('  geo_coherent_results', `${scoredResults.filter((r) => r.geographic_coherence?.coherent).length} / ${scoredResults.length}`);
    if (allResultsForeign) {
      err('  Chile gate: ALL results are foreign/incoherent → FAIL');
    } else {
      ok(`  Chile gate: ${hasAnyCoherentResult ? 'at least 1 coherent result found' : 'no results'}`);
    }
  }

  // Compute claude_skip_reason for diagnostics
  let claudeSkipReason: string | null = null;
  if (!shouldCallClaude) {
    if (isChile && allResultsForeign) {
      claudeSkipReason = 'no_country_coherent_evidence — todos los resultados son entidades extranjeras o sin señal chilena';
    } else {
      const hasAnyConflict = scoredResults.some((r) =>
        hasTaxIdentifierConflict(candidate.tax_identifier, `${r.url} ${r.title} ${r.snippet ?? ''}`) === 'conflict',
      );
      const hasAnyMatch = scoredResults.some((r) =>
        hasTaxIdentifierConflict(candidate.tax_identifier, `${r.url} ${r.title} ${r.snippet ?? ''}`) === 'match',
      );
      if (hasAnyConflict && !hasAnyMatch) {
        claudeSkipReason = 'tax_identifier_conflict — NIT/RUT diferente encontrado en evidencia sin corroboración';
      } else if (!webResult.official_website && !webResult.linkedin_company && webResult.public_evidence.length === 0) {
        claudeSkipReason = 'no_evidence — sin website, LinkedIn ni directorios con nombre';
      } else if (!webResult.official_website && !webResult.linkedin_company) {
        claudeSkipReason = 'weak_entity_match — solo empresas parecidas, sin match de entidad específica';
      } else {
        claudeSkipReason = 'insufficient_evidence';
      }
    }
  }

  info('  claude_allowed', String(shouldCallClaude));
  if (!shouldCallClaude) info('  claude_skip_reason', claudeSkipReason ?? 'insufficient_evidence');
  info('  apollo_allowed', String(apolloAllowed));
  if (!apolloAllowed) info('  apollo_skip_reason', apolloSkipReason ?? 'no_confirmed_domain');

  // ─── G. Claude evaluation ─────────────────────────────────────────────────────
  h2('G. Claude evaluation');

  if (!shouldCallClaude) {
    warn('Claude NO se llama — evidencia insuficiente.');
    dim(`  claude_skip_reason: ${claudeSkipReason}`);
    dim('  evaluation_status = insufficient_evidence');
    dim('  fit_score = null');
  } else if (!anthropicKey) {
    warn('Claude habilitado por evidencia, pero ANTHROPIC_API_KEY no configurada.');
    dim('  Para ejecutar evaluación, agrega ANTHROPIC_API_KEY al entorno.');
  } else {
    ok('Claude se llama — evidencia suficiente.');
    const prompt = buildDebugEvaluationPrompt(
      candidate,
      scoredResults,
      queriesRun,
      industry,
      webResult.official_website?.url ?? null,
      webResult.linkedin_company?.url ?? null,
    );

    console.log(`\n  ${DIM}Prompt length: ${prompt.length} chars${RESET}`);

    try {
      const { text, inputTokens, outputTokens } = await fetchAnthropic(prompt, anthropicKey);
      info('  input_tokens', inputTokens);
      info('  output_tokens', outputTokens);

      // Parse response
      let parsed: Record<string, unknown> | null = null;
      try {
        const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const match = /\{[\s\S]*\}/.exec(stripped);
        if (match) parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        err('Claude devolvió JSON inválido.');
      }

      if (parsed) {
        console.log(`\n  ${BOLD}Claude response:${RESET}`);
        info('  fit_score', parsed.fit_score ?? null);
        info('  fit_status', parsed.fit_status ?? null);
        info('  website', parsed.website ?? null);
        info('  domain', parsed.domain ?? null);
        info('  company_linkedin_url', parsed.company_linkedin_url ?? null);
        info('  description', typeof parsed.description === 'string' ? parsed.description.slice(0, 100) : null);
        info('  summary', typeof parsed.summary === 'string' ? parsed.summary.slice(0, 120) : null);

        if (Array.isArray(parsed.fit_reasons) && parsed.fit_reasons.length > 0) {
          dim('  fit_reasons:');
          for (const r of parsed.fit_reasons as string[]) dim(`    · ${r}`);
        }
        if (Array.isArray(parsed.risks) && parsed.risks.length > 0) {
          dim('  risks:');
          for (const r of parsed.risks as string[]) dim(`    · ${r}`);
        }
        if (Array.isArray(parsed.missing_fields) && parsed.missing_fields.length > 0) {
          dim('  missing_fields:');
          for (const f of parsed.missing_fields as string[]) dim(`    · ${f}`);
        }

        // Guard: check if Claude returned a directory as website
        if (typeof parsed.website === 'string' && parsed.website.length > 0) {
          const aiDomain = extractDomainFromUrl(parsed.website);
          if (aiDomain) {
            const rejReason = getOfficialWebsiteRejectionReason(aiDomain);
            if (rejReason) {
              err(`  Claude retornó directorio como website: ${aiDomain} → RECHAZADO (${rejReason})`);
            }
          }
        }
      }
    } catch (claudeErr) {
      err(`Claude falló: ${claudeErr instanceof Error ? claudeErr.message : String(claudeErr)}`);
    }
  }

  // ─── G. Cost trace ────────────────────────────────────────────────────────────
  h2('G. Cost trace');
  info('tavily_calls', tavilyCalls);
  info('tavily_results_total', rawResults.length);
  info('claude_called', shouldCallClaude && !!anthropicKey ? 'sí' : 'no');
  if (!shouldCallClaude) {
    info('claude_skip_reason', claudeSkipReason ?? 'insufficient_evidence');
  } else if (!anthropicKey) {
    info('claude_skip_reason', 'ANTHROPIC_API_KEY no configurada');
  }
  dim('  Costo Tavily: ~$0.005 USD por búsqueda (estimado)');
  dim('  Costo Claude Haiku: ~$0.0004 USD por evaluación (estimado)');

  // ─── Confirmaciones finales ───────────────────────────────────────────────────
  h2('Confirmaciones de seguridad');
  ok('Sin escrituras en Supabase (DRY RUN)');
  ok('Sin llamadas a HubSpot');
  ok('Sin creación de lotes');
  ok('Sin creación de accounts');
  ok('Sin aprobación de candidatos');
  ok('Sin modificación de candidatos existentes');

  console.log(`\n${BOLD}${CYAN}${'═'.repeat(70)}${RESET}`);
  console.log(`${BOLD}${CYAN}  FIN DEL REPORTE DE DIAGNÓSTICO${RESET}`);
  console.log(`${BOLD}${CYAN}${'═'.repeat(70)}${RESET}\n`);
}

main().catch((e) => {
  console.error('\n❌  Error inesperado:', e);
  process.exit(1);
});
