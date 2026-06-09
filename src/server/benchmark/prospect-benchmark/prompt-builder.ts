/**
 * Prospect Generation Benchmark — Prompt Builder (Hito 16AB.23)
 *
 * Construye el prompt unificado para proveedores nativos de IA (Anthropic, OpenAI, Gemini).
 * Sin lógica de negocio. Sin llamadas externas. Completamente determinístico.
 */

import type { BenchmarkRequest } from './types';
import { BENCHMARK_LIMITS } from './canonical-request';

const SYSTEM_PROMPT = `You are an expert B2B commercial prospect researcher specialized in Latin America.
Your task: identify REAL, VERIFIABLE companies that match a specific commercial profile.

ABSOLUTE RULES (violations invalidate the result):
- NEVER invent URLs. Only include URLs you actually retrieved via web search.
- NEVER invent employee counts or company descriptions. Only state what you found.
- NEVER include a company that does not exist or has closed.
- NEVER include a product, brand, or project as if it were a company.
- NEVER include duplicates — same company under different names.
- If LinkedIn is not found, return empty string — do NOT invent a LinkedIn URL.
- Confidence must be exactly "Alta", "Media", or "Baja" — no other values.
- Do NOT include companies with confidence "Baja" in the candidates array.

COMPANY NAME RULES (critical):
- The "name" field must contain ONLY the clean recommended company name.
- NO parenthetical additions: write "Perficient Latin America" not "Perficient Latin America (ex-PSL)".
- NO country or city qualifiers: write "Truora" not "Truora Inc. (Colombia)".
- NO legal suffixes alone: write "Sofka Technologies" not "Sofka Technologies S.A.S.".
- Historical names, legal forms, or acquisition context belong in the "notes" field only.

EVIDENCE HIERARCHY (use the strongest available source):
- Level A (Primary): official company website, LinkedIn /company/ page, Y Combinator directory,
  investor press releases (PRNewswire, BusinessWire), official corporate documents.
- Level B (High Authority): ProColombia, Fedesoft, chambers of commerce, IBM PartnerPlus,
  TechCrunch, Bloomberg, Reuters, official investment announcements.
- Level C (Acceptable): recognized directories (Clutch, TheManifest), sector media, corporate job profiles.
- Level D/E (NOT acceptable as primary): aggregator blogs, republished rankings, SEO content,
  forums, Reddit, yosoylatino.es, ecosistemastartup.com, content without author.

EVIDENCE URL RULES:
- evidence_url must be the STRONGEST source supporting: identity + Colombia + sector + scale.
- Do NOT default to the company website when a stronger external source exists.
- Do NOT use an aggregator listing when an official source is available.
- Do NOT use the same weak URL for multiple companies.

QUALITY CRITERIA for each company:
- Verified real existence with web evidence (Level A or B required)
- Active operations in Colombia (office, team, clients, or registered entity)
- Matches the technology sector (actual tech product or service — not just tech user)
- B2B orientation or corporate clients
- Has a real working website
- Identifiable corporate LinkedIn /company/ page (when found — use exact URL)
- Estimated size supported by found evidence; if only approximate, say "estimado ~X" — never invent
- City must be supported by evidence; leave empty if not confirmed

OUTPUT: Return ONLY a JSON object wrapped in <json_output>...</json_output> tags.
No markdown, no prose before or after the tags.`;

export function buildProviderSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildProviderUserPrompt(request: BenchmarkRequest): string {
  const limit = BENCHMARK_LIMITS;

  return `Research a pool of ${limit.max_candidates_to_discover} candidate companies, then select the best ${request.requested_count} for the final list.

REQUEST:
- Country: ${request.country} (${request.country_code})
- Industry: ${request.industry}
- Commercial context: ${request.commercial_context}

PROCESS (follow ALL phases in order):

PHASE A — Search Planning:
Plan before searching: identify 5-7 tech subsectors relevant to Colombia, 4-5 cities to cover
(Bogotá, Medellín, Cali, Barranquilla, plus others when evidence exists), at least 10 specific
search queries, sources to prioritize, and diversification strategy.

PHASE B — Wide Discovery (target: ${limit.max_candidates_to_discover} candidates):
Execute at least 10 targeted web searches. Vary by:
- Subsector: "empresas SaaS Colombia", "ciberseguridad Colombia empresas", "fintech B2B Colombia"
- City: "tech companies Medellín", "empresas tecnología Cali"
- Authority source: "miembros Fedesoft 2024", "ProColombia software empresas", "Y Combinator Colombia"
- Verification: "[company] Colombia official site", "[company] LinkedIn Colombia"
Discover ${limit.max_candidates_to_discover} candidates BEFORE selecting the final ${request.requested_count}.
Cover diverse subsectors: SaaS, cybersecurity, data & AI, fintech B2B, enterprise software,
tech services, infrastructure, healthtech, retail tech.

PHASE C — Identity Resolution:
For each candidate confirm:
- Real company (not a product, brand, project, or closed entity)
- Official domain (website actually belongs to this company)
- Name-domain correspondence

PHASE D — Individual Verification:
For each candidate verify:
- Colombia: office, team, registered entity, or active Colombian clients
- Technology sector: actual tech product or B2B service (not just tech user)
- LinkedIn: search for /company/{slug} — record exact URL if found
- Size: cite the source; if only an estimate exists, mark as "estimado ~X"
- City: only state if confirmed by a source

PHASE E — Evidence Quality Check:
For each candidate identify the strongest evidence source:
- Prefer Level A (official site, LinkedIn /company/, YC, PRNewswire) over weaker sources
- Prefer Level B (ProColombia, Fedesoft, Bloomberg, TechCrunch) when A is not available
- Do NOT use Level D/E (aggregator blogs, yosoylatino.es, ecosistemastartup.com, SEO content)
  as the primary evidence_url
- Do NOT reuse the same weak URL as evidence for more than one company

PHASE F — Replacement:
If any candidate fails verification (no real website, no Colombia evidence, Baja confidence,
or only Level D/E evidence), replace with the next best candidate from your discovery pool.
Do this up to 2 rounds.

PHASE G — Diversification:
The final ${request.requested_count} should reasonably cover: multiple cities, multiple subsectors.
Do NOT force diversity at the expense of evidence quality.

PHASE H — Final Selection:
Select the ${request.requested_count} companies that best combine:
verified existence + sector fit + Level A/B evidence + completeness + novelty + diversity.
If fewer than ${request.requested_count} meet all criteria after 2 replacement rounds,
return only the number that pass — do NOT pad with low-quality candidates.
Do NOT include companies with confidence "Baja".

MANDATORY OUTPUT FORMAT:
<json_output>
{
  "search_plan": {
    "subsectors": ["fintech", "SaaS B2B", "ciberseguridad", "datos y IA", "healthtech"],
    "cities": ["Bogotá", "Medellín", "Cali", "Barranquilla"],
    "queries_planned": ["empresas SaaS B2B Colombia 2024", "ciberseguridad Colombia empresas", "..."],
    "sources_prioritized": ["Fedesoft", "ProColombia", "Y Combinator", "LinkedIn /company/"],
    "exclusions": ["confianza Baja", "empresas cerradas", "sin sede Colombia"],
    "quality_criteria": ["evidencia Nivel A o B", "Colombia confirmado", "B2B verificado"],
    "diversification_strategy": "Cubrir Bogotá + Medellín + al menos una ciudad adicional; mín. 4 subsectores distintos"
  },
  "candidates_discovered": ${limit.max_candidates_to_discover},
  "candidates": [
    {
      "name": "Empresa",
      "country": "Colombia",
      "sector": "Tecnología / SaaS B2B",
      "website": "https://empresa.com.co",
      "linkedin": "https://www.linkedin.com/company/empresa",
      "city": "Bogotá",
      "estimated_size": "200-500 empleados",
      "description": "Empresa de software B2B especializada en...",
      "evidence_url": "https://www.ycombinator.com/companies/empresa",
      "evidence_source": "Y Combinator directory + sitio web oficial + LinkedIn corporativo",
      "confidence": "Alta",
      "notes": ""
    }
  ]
}
</json_output>

Return EXACTLY ${request.requested_count} companies in the candidates array (or fewer if < ${request.requested_count} pass all quality criteria).
Every URL in the output must be a real URL you retrieved during web search — NEVER invent URLs.`;
}

export function extractJsonFromResponse(text: string): string | null {
  // Try <json_output> tags first (preferred)
  const tagMatch = text.match(/<json_output>([\s\S]*?)<\/json_output>/);
  if (tagMatch?.[1]) return tagMatch[1].trim();

  // Fallback: try JSON code block
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1].trim();

  // Fallback: find first { ... } block
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return text.slice(jsonStart, jsonEnd + 1).trim();
  }

  return null;
}

export function parseProviderResponse(raw: string): {
  search_plan?: Record<string, unknown>;
  candidates_discovered?: number;
  candidates?: unknown[];
} | null {
  const jsonStr = extractJsonFromResponse(raw);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed !== 'object' || !parsed) return null;
    return parsed as {
      search_plan?: Record<string, unknown>;
      candidates_discovered?: number;
      candidates?: unknown[];
    };
  } catch {
    return null;
  }
}
