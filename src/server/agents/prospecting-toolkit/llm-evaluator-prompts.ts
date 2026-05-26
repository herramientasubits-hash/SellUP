/**
 * LLM Evaluator — Prompt builder (Hito 16H)
 *
 * Construye el prompt para evaluar resultados Tavily con LLM.
 * Sin lógica de negocio, sin llamadas externas, sin efectos secundarios.
 */

import type { LLMEvaluatorRawInput } from './llm-evaluator-types';

/**
 * Construye el prompt de evaluación para un batch de resultados Tavily.
 *
 * Guardrails embebidos en el prompt:
 * - Usar solo evidencia entregada
 * - No inventar empresas, websites ni URLs
 * - Artículos/listas/directorios → discard
 * - Evidencia ambigua → review
 * - Empresa real del sector y país → keep
 * - JSON válido, sin markdown
 * - Máximo una empresa por resultado
 * - No aprobar automáticamente
 * - Ser escéptico ante evidencia ambigua
 */
export function buildLLMEvaluatorPrompt(
  country: string,
  countryCode: string,
  industry: string,
  results: LLMEvaluatorRawInput[]
): string {
  const resultLines = results
    .map((r) =>
      [
        `--- Result #${r.idx} ---`,
        `Title: ${r.title}`,
        `URL: ${r.url}`,
        `Domain: ${r.domain ?? 'unknown'}`,
        `Snippet: ${r.snippet ?? '(no snippet)'}`,
        `Search query: ${r.query}`,
      ].join('\n')
    )
    .join('\n\n');

  return `You are a B2B Sales Intelligence expert evaluating web search results to identify real prospectable companies.

TARGET CRITERIA:
- Country: ${country} (${countryCode})
- Industry / Sector: ${industry}

TASK:
Evaluate each search result and determine if it represents a real, prospectable B2B company in the target country and industry.

STRICT RULES:
1. Use ONLY the evidence provided in title, URL, domain, and snippet. Do not use external knowledge.
2. Do NOT invent company names, websites, or URLs.
3. Do NOT create new URLs or domains. Use the exact URL from the result.
4. If the result appears to be an article, listicle, directory, blog post, news piece, aggregator, or ranking → decision = "discard"
5. If evidence is ambiguous, insufficient, or you cannot confirm sector/country → decision = "review"
6. If the result is clearly a real company in the target sector AND country → decision = "keep"
7. Return exactly ONE evaluation per result. Each idx must appear exactly once.
8. Be SKEPTICAL: when in doubt, choose "review" over "keep". Never auto-approve.
9. clean_company_name: extract from title or domain only. Do not invent. Set null if not determinable.
10. website: use the exact URL provided. Never create new URLs.
11. domain: use the exact domain from the result. Never create new domains.

SCORING CRITERIA (integer 0-10):
- sector_fit_score: How well the result fits the target industry (0 = no relation, 10 = perfect match)
- country_fit_score: How well the result matches the target country (0 = no evidence, 10 = confirmed)
- prospectability_score: How likely this is a real, contactable B2B company (0 = not prospectable, 10 = highly prospectable)

CONFIDENCE (float 0.0-1.0):
Your confidence in the decision based solely on available evidence.

RESULTS TO EVALUATE:
${resultLines}

RESPONSE FORMAT:
Return a JSON array only. No markdown, no explanation, no code blocks.
Each element must have exactly these fields:

[
  {
    "idx": <integer>,
    "decision": "keep" | "discard" | "review",
    "clean_company_name": <string or null>,
    "website": <string or null>,
    "domain": <string or null>,
    "sector_fit_score": <integer 0-10>,
    "country_fit_score": <integer 0-10>,
    "prospectability_score": <integer 0-10>,
    "confidence": <float 0.0-1.0>,
    "evidence": [<string>, ...],
    "reason": <string>,
    "risk_flags": [<string>, ...]
  },
  ...
]

Return ONLY the JSON array. No other text before or after.`;
}
