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
- If LinkedIn is not found, return empty string.
- Confidence must be exactly "Alta", "Media", or "Baja" — no other values.

QUALITY CRITERIA for each company:
- Verified real existence with web evidence
- Operating in the target country
- Matches the target industry
- B2B orientation or corporate clients
- Has a real working website
- Identifiable corporate LinkedIn page (when available)
- Estimated size supported by found evidence (not invented)

OUTPUT: Return ONLY a JSON object wrapped in <json_output>...</json_output> tags.
No markdown, no prose before or after the tags.`;

export function buildProviderSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildProviderUserPrompt(request: BenchmarkRequest): string {
  const limit = BENCHMARK_LIMITS;

  return `Research ${limit.max_candidates_to_discover} candidate companies, then select the best ${request.requested_count}.

REQUEST:
- Country: ${request.country} (${request.country_code})
- Industry: ${request.industry}
- Commercial context: ${request.commercial_context}

PROCESS (follow in order):

PHASE A — Search Planning:
Before searching, plan: identify 3-5 tech subsectors relevant to Colombia, 3-4 cities to cover, specific search queries (minimum 8), sources to prioritize (official directories, industry associations, company databases), and diversification strategy.

PHASE B — Discovery:
Execute at least 8 targeted web searches. Use varied queries:
- Sector-specific: "empresas software Colombia 2024", "startups fintech Colombia"
- City-specific: "empresas tecnología Bogotá", "tech companies Medellín"
- Association-guided: "miembros Fedesoft", "empresas Colombia Fintech"
- Directory-guided: "directorio empresas tecnología Colombia"
- Verification: "[company name] Colombia sede oficial"
Discover ${limit.max_candidates_to_discover} candidates before selecting final ${request.requested_count}.

PHASE C — Individual verification:
For each candidate verify:
- Real existence (not just a mention)
- Active operations in Colombia
- Matches technology sector
- Has real website
- B2B/corporate orientation
- Not a closed/liquidated company

PHASE D — Deduplication:
Before final selection, check for:
- Same company under different names
- Companies from same corporate group
- Products/brands presented as companies

PHASE E — Diversification check:
The final ${request.requested_count} should NOT concentrate in:
- Only Bogotá
- Only software factories
- Only multinational subsidiaries
- Only the most-known companies
Aim for reasonable diversity in: cities, tech subsectors, company size, local/regional/global origin.

PHASE F — Final selection:
Select the ${request.requested_count} companies with the best combination of: verified existence, sector fit, evidence quality, completeness, novelty, scale, commercial potential, and diversity.

MANDATORY OUTPUT FORMAT:
<json_output>
{
  "search_plan": {
    "subsectors": ["fintech", "edtech", "SaaS B2B", "ciberseguridad", "datos y analytics"],
    "cities": ["Bogotá", "Medellín", "Cali", "Barranquilla"],
    "queries_planned": ["empresas software B2B Colombia 2024", "..."],
    "sources_prioritized": ["Fedesoft", "Colombia Fintech", "LinkedIn Companies", "Cámara de Comercio"],
    "exclusions": ["multinacionales globales sin sede CO", "empresas cerradas"],
    "quality_criteria": ["sitio web funcional", "mínimo 50 empleados", "evidencia B2B"],
    "diversification_strategy": "Mix de ciudades y subsectores, evitar concentración en Bogotá/software factories"
  },
  "candidates_discovered": 25,
  "candidates": [
    {
      "name": "Empresa SAS",
      "country": "Colombia",
      "sector": "Tecnología / Software B2B",
      "website": "https://empresa.com.co",
      "linkedin": "https://www.linkedin.com/company/empresa",
      "city": "Bogotá",
      "estimated_size": "200-500 empleados",
      "description": "Empresa de software B2B especializada en...",
      "evidence_url": "https://empresa.com.co/about",
      "evidence_source": "Sitio web oficial + LinkedIn corporativo",
      "confidence": "Alta",
      "notes": ""
    }
  ]
}
</json_output>

Return EXACTLY ${request.requested_count} companies in the candidates array.
Every URL in the output must be a real URL you found during web search — no invented URLs.`;
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
