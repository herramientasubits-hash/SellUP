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
  const tavilyKey = process.env.TAVILY_API_KEY ?? null;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null;

  if (!tavilyKey) warn('TAVILY_API_KEY no configurada — búsquedas reales deshabilitadas.');
  if (!anthropicKey) warn('ANTHROPIC_API_KEY no configurada — evaluación Claude deshabilitada.');

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
    candidate = {
      id: undefined,
      name: args['name'] ?? null,
      legal_name: args['name'] ?? null,
      tax_identifier: args['nit'] ?? null,
      city: args['city'] ?? null,
      industry: args['industry'] ?? null,
      website: null,
      domain: null,
      country: args['country'] ?? 'Colombia',
      region: args['region'] ?? null,
    };
  } else {
    err('Uso: --candidate-id <uuid>  o  --name "NOMBRE" --nit "NIT" --city "Ciudad"');
    process.exit(1);
  }

  const industry = candidate.industry ?? args['industry'] ?? 'No especificado';

  // ─── A. Candidate input ───────────────────────────────────────────────────────
  h2('A. Candidate input');
  info('ID', candidate.id ?? '(inline — no DB)');
  info('name', candidate.name);
  info('legal_name', candidate.legal_name);
  info('tax_identifier (NIT)', candidate.tax_identifier);
  info('city', candidate.city);
  info('region', candidate.region ?? args['region'] ?? null);
  info('country', candidate.country ?? args['country'] ?? 'Colombia');
  info('industry', candidate.industry);
  info('website (actual)', candidate.website ?? null);
  info('domain (actual)', candidate.domain ?? null);

  // ─── B. Search plan ───────────────────────────────────────────────────────────
  h2('B. Search plan');

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

      console.log(`\n  ${BOLD}[${i + 1}] ${scored.title.slice(0, 60)}${RESET}`);
      info('  URL', scored.url);
      info('  Domain', domain);
      info('  Query intent', `${raw.intent}`);
      info('  source_type', scored.source_type);
      info('  confidence', scored.confidence);
      info('  raw_score', scored.raw_score);
      info('  entity_match_score', nameMatch);
      info('  matched_signals', scored.matched_signals.join(', ') || '(ninguno)');

      if (isBlockedAsOfficial) {
        err(`  Rechazado como website oficial: ${rejectionReason}`);
      } else if (isOfficialCandidate && scored.source_type === 'official_website') {
        ok(`  Candidato a website oficial`);
      }

      if (isLinkedIn) {
        const linkedInMatch = nameMatch;
        if (linkedInMatch >= 70) {
          ok(`  LinkedIn confirmado (name_match=${linkedInMatch} ≥ 70)`);
        } else if (linkedInMatch >= 20) {
          warn(`  LinkedIn posible (name_match=${linkedInMatch}, umbral confirmado=70)`);
        } else {
          err(`  LinkedIn rechazado (name_match=${linkedInMatch} < 20)`);
        }
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

  // ─── F. Claude evaluation ─────────────────────────────────────────────────────
  h2('F. Claude evaluation');

  const shouldCallClaude = hasMinimumEvidenceForClaude(webResult, scoredResults);

  if (!shouldCallClaude) {
    warn('Claude NO se llama — evidencia insuficiente.');
    dim('  Motivo: sin website oficial, sin LinkedIn confirmado, sin evidencia pública strong.');
    dim('  evaluation_status = insufficient_evidence');
    dim('  Evaluación no disponible por falta de evidencia pública');
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
    info('claude_skip_reason', 'insufficient_evidence');
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
