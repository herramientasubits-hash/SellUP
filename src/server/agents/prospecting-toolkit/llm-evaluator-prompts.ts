/**
 * LLM Evaluator — Prompt builder (Hito 16H, actualizado Hito 16L)
 *
 * Construye el prompt para evaluar resultados Tavily con LLM.
 * Sin lógica de negocio, sin llamadas externas, sin efectos secundarios.
 *
 * Hito 16L: buildIndustrySpecificCriteria() inyecta reglas específicas
 * por industria (Manufactura) para distinguir fabricantes reales de
 * proveedores/tecnología para el sector.
 */

import type { LLMEvaluatorRawInput } from './llm-evaluator-types';

// ─── Criterios específicos por industria ─────────────────────────────────────

const MANUFACTURING_KEYWORDS = [
  'manufactur', 'manufacturing', 'maquiladora', 'maquila',
];

const TECHNOLOGY_KEYWORDS = [
  'technology', 'tecnologia', 'tecnología', 'tech', 'software',
  'sistemas', 'informatica', 'informática', 'digital', 'it ',
];

function isManufacturingIndustry(industry: string): boolean {
  const lower = industry.toLowerCase();
  return MANUFACTURING_KEYWORDS.some((kw) => lower.includes(kw));
}

function isTechnologyIndustry(industry: string): boolean {
  const lower = industry.toLowerCase();
  return TECHNOLOGY_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Retorna un bloque de criterios específicos por industria para inyectar en el prompt.
 * Retorna string vacío si no hay reglas especiales para la industria.
 */
function buildIndustrySpecificCriteria(industry: string): string {
  if (isManufacturingIndustry(industry)) {
    return `
INDUSTRY-SPECIFIC RULES FOR MANUFACTURING (${industry}):
The target is REAL MANUFACTURERS — companies that physically produce goods in their own facilities.

KEEP (sector_fit_score ≥ 7) — valid targets:
- Factories, plants, or industrial facilities producing physical goods
- Metalwork, metal fabrication, or machinery manufacturers
- Packaging, plastics, or containers manufacturers
- Textile, apparel, or garment producers
- Food & beverage producers, processors, or packagers
- Auto parts, maquiladora, or industrial component manufacturers
- Chemical, pharmaceutical, or cosmetics manufacturers
- Construction materials, ceramics, glass, or wood manufacturers

DISCARD or REVIEW (sector_fit_score ≤ 4) — NOT valid for this target:
- Technology vendors, automation providers, or software companies serving manufacturing
- Consulting firms or digital transformation agencies for the factory sector
- ERP, MES, or Industry 4.0 solution providers that do not manufacture goods
- Industry associations, chambers of commerce, or trade organizations (gremios, cámaras)
- Sector portals, directories, reports, or news sites
- Audiovisual, marketing, or professional services firms

ADD to risk_flags when any of these apply:
- "only serves manufacturing sector, no evidence of own production"
- "technology/automation vendor, not a manufacturer"
- "multinational with generic branding, no local plant evidence"
- "industry association, chamber, or sector portal"
- "page shows sector solutions but no factory or production evidence"
`;
  }

  if (isTechnologyIndustry(industry)) {
    return `
INDUSTRY-SPECIFIC RULES FOR TECHNOLOGY (${industry}):
The target is REAL TECH COMPANIES — firms that build, own, or operate software products, platforms, or infrastructure.

KEEP (sector_fit_score ≥ 7) — valid targets:
- SaaS companies with a named product or platform
- Cloud, DevOps, or DevSecOps platform providers
- Cybersecurity firms offering own software, services, or managed security
- Software development companies or software factories with proprietary IP
- IT infrastructure, networking, or data center operators
- Fintech, healthtech, edtech, or vertical SaaS companies
- Managed services providers (MSP) delivering recurring technology services

REVIEW (sector_fit_score 4-6) — investigate further:
- IT consulting firms mixing services with some product offerings
- Outsourcing or staff-augmentation shops with a partial software portfolio
- System integrators that resell third-party platforms with little own IP
- Companies with generic "technology solutions" branding and no named product

DISCARD (sector_fit_score ≤ 3) — NOT valid for this target:
- Digital marketing, SEO, or social media agencies (no software product)
- Web design or UX studios with no underlying platform or SaaS
- Generic web development services with no named product or B2B client evidence
- HR / recruitment firms specializing in tech talent (not a tech company itself)
- Training academies, bootcamps, or certification providers
- Industry directories, rankings, listicles, or sector portals
- Consulting-only firms with no technology product or platform
- Documents or presentations hosted on content-sharing platforms (Scribd, SlideShare, Issuu, Prezi, etc.)

ADD to risk_flags when any of these apply:
- "marketing or SEO agency, not a software company"
- "web design studio, no evidence of own platform or IP"
- "generic web development service, no named product or B2B evidence"
- "HR/recruitment agency targeting tech roles"
- "training or certification provider, not a tech product company"
- "generic branding — no named product, platform, or service found"
- "directory, listicle, or sector portal"
- "document on content-sharing platform, not a company homepage"
`;
  }

  return '';
}

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
 * - Hito 16L: criterios específicos por industria inyectados dinámicamente
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

  const industryRules = buildIndustrySpecificCriteria(industry);

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
4. If the result appears to be an article, listicle, directory, blog post, news piece, aggregator, ranking, or a document/presentation hosted on a content-sharing platform (Scribd, SlideShare, Issuu, Medium, Substack, Google Docs/Drive, Prezi, etc.) → decision = "discard"
5. If evidence is ambiguous, insufficient, or you cannot confirm sector/country → decision = "review"
6. If the result is clearly a real company in the target sector AND country → decision = "keep"
7. Return exactly ONE evaluation per result. Each idx must appear exactly once.
8. Be SKEPTICAL: when in doubt, choose "review" over "keep". Never auto-approve.
9. clean_company_name: extract from title or domain only. Do not invent. Set null if not determinable.
10. website: use the exact URL provided. Never create new URLs.
11. domain: use the exact domain from the result. Never create new domains.
${industryRules}
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
