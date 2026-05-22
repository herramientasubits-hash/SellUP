/**
 * Web Search Provider — Mock
 *
 * Retorna resultados sintéticos realistas para desarrollo y pruebas.
 * No realiza ninguna llamada externa. Costo: $0.
 * Los resultados están claramente marcados como mock en metadata.
 */

import type { WebSearchInput, WebSearchOutput, WebSearchResult } from '../types';

// ─── Plantillas por industria ─────────────────────────────────────────────────

const INDUSTRY_TEMPLATES: Record<string, string[]> = {
  tecnologia: ['Software', 'Tech', 'Digital', 'Cloud', 'Data', 'Dev'],
  manufactura: ['Industrial', 'Manufacturing', 'Fabricacion', 'Planta', 'Metal'],
  retail: ['Comercial', 'Retail', 'Tienda', 'Distribuidora', 'Mercado'],
  salud: ['Salud', 'Health', 'Clinica', 'Medical', 'Pharma'],
  educacion: ['Education', 'Educacion', 'Learning', 'Academia', 'Instituto'],
  finanzas: ['Finance', 'Fintech', 'Capital', 'Inversiones', 'Credito'],
};

const FALLBACK_TERMS = ['Empresa', 'Group', 'Corp', 'Solutions', 'Services'];

function getIndustryTerms(industry: string | null | undefined): string[] {
  if (!industry) return FALLBACK_TERMS;
  const normalized = industry.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [key, terms] of Object.entries(INDUSTRY_TEMPLATES)) {
    if (normalized.includes(key)) return terms;
  }
  return FALLBACK_TERMS;
}

// ─── Generador de resultados mock ─────────────────────────────────────────────

function buildMockResults(
  input: WebSearchInput,
  count: number,
): WebSearchResult[] {
  const terms = getIndustryTerms(input.industry);
  const country = input.country ?? 'Colombia';
  const countryCode = (input.countryCode ?? 'CO').toUpperCase();

  return Array.from({ length: count }, (_, i) => {
    const idx = (i % terms.length);
    const term = terms[idx];
    const num = String(i + 1).padStart(2, '0');
    const slug = `mock-${term.toLowerCase()}-${countryCode.toLowerCase()}-${num}`;

    return {
      title: `${term} ${country} Mock ${num} S.A.S`,
      url: `https://example.com/${slug}`,
      snippet: `Empresa de ${input.industry ?? 'servicios'} ubicada en ${country}. Resultado generado por mock provider para pruebas sin costo externo.`,
      source: 'mock',
      rank: i + 1,
      provider: 'mock' as const,
      confidence: 0.5,
      metadata: {
        mock: true,
        note: 'Mock result for development without external API cost',
        generatedFor: {
          query: input.query,
          country,
          industry: input.industry ?? null,
        },
      },
    };
  });
}

// ─── Provider público ─────────────────────────────────────────────────────────

export async function runMockWebSearch(input: WebSearchInput, maxResults: number): Promise<WebSearchOutput> {
  const results = buildMockResults(input, maxResults);

  return {
    provider: 'mock',
    query: input.query,
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      mock: true,
      note: 'Mock provider — no external calls made',
    },
  };
}
