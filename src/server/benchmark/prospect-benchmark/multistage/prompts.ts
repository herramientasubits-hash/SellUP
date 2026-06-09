/**
 * Multistage Orchestrator — Stage Prompts (16AB.23.3)
 *
 * Each stage has a focused prompt with tight scope.
 * Stage 1 never uses web search. Stages 2 and 5 use max 4 searches.
 */

import type { DiscoveryCandidate } from './ms-types';

// ─── Common system prompt ─────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert B2B commercial prospect researcher specialized in Latin America.
ABSOLUTE RULES:
- NEVER invent URLs. Only include URLs retrieved via web search.
- NEVER include a product, brand, project, or closed entity.
- Confidence must be exactly "Alta", "Media", or "Baja".
- Do NOT include companies with confidence "Baja".
- Company names: ONLY the clean recommended name (no parenthetical, no legal suffixes, no country qualifiers).
- Return ONLY a JSON object wrapped in <json_output>...</json_output> tags. No other text.`;

// ─── Stage 1: Search Plan (no web search) ────────────────────────────────────

export function buildPlanPrompt(country: string, industry: string, context: string): string {
  return `Generate a strategic search plan for finding B2B ${industry} companies in ${country}.
Context: ${context}

No web searches needed — strategic planning only.

Return ONLY:
<json_output>
{
  "subsectors": ["SaaS B2B", "ciberseguridad", "datos y IA", "fintech B2B", "servicios tech", "healthtech", "retail tech"],
  "cities": ["Bogotá", "Medellín", "Cali", "Barranquilla"],
  "company_types": ["software propio", "empresa de servicios tech", "plataforma B2B"],
  "target_sources": ["Fedesoft", "ProColombia", "Y Combinator", "LinkedIn /company/", "ycombinator.com"],
  "queries": [
    "empresas SaaS B2B Colombia 2024",
    "ciberseguridad Colombia empresas tecnología",
    "fintech B2B Colombia serie A",
    "miembros Fedesoft empresas software 2024",
    "ProColombia empresas software Colombia exportación",
    "Y Combinator startups Colombia",
    "datos IA empresas Colombia B2B",
    "servicios tecnológicos empresas Colombia",
    "healthtech Colombia empresas",
    "retail tech Colombia plataformas"
  ],
  "exclusions": ["confianza Baja", "empresas cerradas", "sin sede Colombia", "artículos y blogs"],
  "diversity_strategy": "Cubrir Bogotá + Medellín + 2 ciudades más; mín. 4 subsectores distintos",
  "batch_themes": [
    "SaaS y software empresarial colombiano",
    "Datos, IA y ciberseguridad en Colombia",
    "Fintech B2B y tecnología financiera",
    "Servicios tecnológicos e ingeniería de software",
    "Healthtech, retail tech y verticales B2B"
  ]
}
</json_output>`;
}

// ─── Stage 2: Discovery per theme batch ──────────────────────────────────────

export function buildDiscoveryPrompt(
  batchIndex: number,
  theme: string,
  country: string,
  context: string,
  existingNames: string[]
): string {
  const exclusions = existingNames.length > 0
    ? `\nALREADY FOUND (do NOT repeat): ${existingNames.join(', ')}`
    : '';

  return `Find exactly 5 real B2B tech companies in ${country} for this theme:
THEME: ${theme}
CONTEXT: ${context}${exclusions}

Use web search to find companies. Prioritize:
- Companies with confirmed official websites
- Level A evidence (LinkedIn /company/, Y Combinator, official site) if available
- Level B evidence (ProColombia, Fedesoft, Bloomberg) if A not available
- Avoid aggregator blogs, yosoylatino.es, ecosistemastartup.com as primary evidence

For each company note:
- Actual website URL (verified with search)
- LinkedIn /company/ URL if findable
- City only if confirmed
- Size only if from a source
- Best evidence URL

Return EXACTLY 5 candidates:
<json_output>
{
  "batch_index": ${batchIndex},
  "batch_theme": "${theme}",
  "candidates": [
    {
      "name": "Empresa S.A.",
      "website": "https://empresa.com.co",
      "linkedin": "https://www.linkedin.com/company/empresa",
      "city": "Bogotá",
      "sector": "Tecnología / SaaS B2B",
      "description": "Plataforma B2B de software para ...",
      "confidence": "Alta",
      "evidence_url": "https://www.linkedin.com/company/empresa",
      "evidence_source": "LinkedIn corporativo + sitio oficial",
      "estimated_size": "200-500 empleados",
      "notes": ""
    }
  ]
}
</json_output>`;
}

// ─── Stage 5: Verification per batch ─────────────────────────────────────────

export function buildVerificationPrompt(
  candidates: DiscoveryCandidate[],
  country: string
): string {
  const candidateJson = candidates.map((c) => JSON.stringify({
    name: c.name,
    website: c.website,
    linkedin: c.linkedin,
    sector: c.sector,
    city: c.city,
    description: c.description,
    notes: c.notes,
  }, null, 2)).join('\n\n');

  return `Verify these ${candidates.length} ${country} B2B tech companies for a prospect list.

CANDIDATES TO VERIFY:
${candidateJson}

For EACH company, use web search to verify:
1. Real operating company (not a product, article, association, closed entity)
2. Official website (verify it loads and belongs to this company)
3. Active in ${country} (office, team, clients, or registered entity)
4. B2B tech (actual tech product/service — not just a tech user)
5. LinkedIn /company/ page — search for exact URL, leave null if not found
6. Employee size — cite source; if estimate only, write "estimado ~X"; if unknown leave null
7. City — only if confirmed by evidence
8. Best evidence URL: Level A (LinkedIn, YC, official site) > B (ProColombia, Fedesoft) > C (Clutch, media)
9. Confidence: Alta = verified all above; Media = partial; Baja = unverifiable

CRITICAL:
- resolved_name must be CLEAN: no parenthetical, no legal suffix (S.A., S.A.S.), no country qualifier
- If rejected, set is_real_company=false and explain rejection_reason
- Do NOT include companies with confidence="Baja" — set rejection_reason instead

Return:
<json_output>
{
  "candidates": [
    {
      "original_name": "...",
      "resolved_name": "Clean Name Only",
      "is_real_company": true,
      "official_website": "https://...",
      "linkedin_url": "https://www.linkedin.com/company/...",
      "operates_in_colombia": true,
      "is_tech_b2b": true,
      "city": "Bogotá",
      "estimated_size": "200-500 empleados",
      "confidence": "Alta",
      "evidence_url": "https://www.linkedin.com/company/...",
      "evidence_source": "LinkedIn corporativo + sitio oficial",
      "description": "...",
      "notes": "",
      "rejection_reason": null
    }
  ]
}
</json_output>`;
}

// ─── Stage 2 replacement discovery ───────────────────────────────────────────

export function buildReplacementDiscoveryPrompt(
  round: number,
  country: string,
  context: string,
  neededCount: number,
  existingNames: string[]
): string {
  return `REPLACEMENT ROUND ${round}: Find ${neededCount} additional B2B tech companies in ${country}.
CONTEXT: ${context}
ALREADY FOUND (do NOT repeat): ${existingNames.join(', ')}

Focus on companies that may have been missed in previous searches.
Look in different sectors or cities than those already covered.

Return EXACTLY ${neededCount} candidates (or fewer if that many don't exist):
<json_output>
{
  "batch_index": ${100 + round},
  "batch_theme": "replacement_round_${round}",
  "candidates": []
}
</json_output>`;
}
