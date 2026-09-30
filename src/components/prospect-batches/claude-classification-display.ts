/**
 * Lectura segura de `metadata.claude_classification` para la UI (puro).
 *
 * La metadata viene de la base de datos: se valida campo a campo y sólo se
 * muestran URLs http(s). Cualquier forma inesperada → null (no se muestra).
 */

export type ClaudeClassificationDisplay = {
  outcomeLabel: string;
  outcomeTone: 'positive' | 'partial' | 'neutral' | 'error';
  classifiedAt: string | null;
  sector: {
    label: string;
    matchesCurrentIndustry: boolean | null;
    quote: string;
    sourceUrl: string;
    verificationLabel: string;
  } | null;
  employeeRange: {
    label: string;
    quote: string;
    sourceUrl: string;
    verificationLabel: string;
  } | null;
  linkedin: { url: string; sourceLabel: string } | null;
  rejectedCount: number;
  notOperatingCompany: boolean;
  estimatedCostUsd: number | null;
};

const OUTCOMES: Record<string, { label: string; tone: ClaudeClassificationDisplay['outcomeTone'] }> = {
  classified: { label: 'Sector y tamaño sugeridos', tone: 'positive' },
  partially_classified: { label: 'Sugerencia parcial', tone: 'partial' },
  nothing_verifiable: { label: 'Sin datos verificables', tone: 'neutral' },
  website_unreachable: { label: 'Sitio no accesible (se puede reintentar)', tone: 'neutral' },
  website_redirected_offsite: { label: 'El sitio redirige a otro dominio', tone: 'neutral' },
  no_website: { label: 'Sin sitio web', tone: 'neutral' },
  model_error: { label: 'Error al clasificar (se puede reintentar)', tone: 'error' },
};

const VERIFICATION_LABELS: Record<string, string> = {
  quote_verified: 'Cita comprobada en la fuente',
  source_listed: 'Fuente de la búsqueda web — la cita NO se pudo comprobar',
};

const LINKEDIN_SOURCE_LABELS: Record<string, string> = {
  website_social_link: 'Enlazada desde el sitio oficial',
  provided_search_result: 'Encontrada por búsqueda web (el nombre coincide)',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function safeUrl(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function formatRange(min: number, max: number | null): string {
  const fmt = (n: number) => n.toLocaleString('es-CO');
  return max === null ? `Más de ${fmt(min)} empleados (estimado)` : `${fmt(min)}–${fmt(max)} empleados (estimado)`;
}

export function readClaudeClassificationDisplay(metadata: unknown): ClaudeClassificationDisplay | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).claude_classification;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const outcome = OUTCOMES[str(c.outcome) ?? ''];
  if (!outcome) return null;

  let sector: ClaudeClassificationDisplay['sector'] = null;
  if (c.sector && typeof c.sector === 'object') {
    const s = c.sector as Record<string, unknown>;
    const industry = str(s.industry_name);
    const quote = str(s.quote);
    const sourceUrl = safeUrl(s.source_url);
    const verification = VERIFICATION_LABELS[str(s.verification) ?? ''];
    if (industry && quote && sourceUrl && verification) {
      const sub = str(s.subindustry_name);
      sector = {
        label: sub ? `${industry} · ${sub}` : industry,
        matchesCurrentIndustry: typeof s.matches_current_industry === 'boolean' ? s.matches_current_industry : null,
        quote,
        sourceUrl,
        verificationLabel: verification,
      };
    }
  }

  let employeeRange: ClaudeClassificationDisplay['employeeRange'] = null;
  if (c.employee_range && typeof c.employee_range === 'object') {
    const e = c.employee_range as Record<string, unknown>;
    const min = typeof e.min === 'number' && Number.isFinite(e.min) ? e.min : null;
    const max = typeof e.max === 'number' && Number.isFinite(e.max) ? e.max : null;
    const quote = str(e.quote);
    const sourceUrl = safeUrl(e.source_url);
    const verification = VERIFICATION_LABELS[str(e.verification) ?? ''];
    if (min !== null && quote && sourceUrl && verification) {
      employeeRange = { label: formatRange(min, max), quote, sourceUrl, verificationLabel: verification };
    }
  }

  let linkedin: ClaudeClassificationDisplay['linkedin'] = null;
  if (c.linkedin_company && typeof c.linkedin_company === 'object') {
    const l = c.linkedin_company as Record<string, unknown>;
    const url = safeUrl(l.url);
    const sourceLabel = LINKEDIN_SOURCE_LABELS[str(l.source) ?? ''];
    if (url && /(^|\.)linkedin\.com$/i.test(new URL(url).hostname) && sourceLabel) linkedin = { url, sourceLabel };
  }

  return {
    outcomeLabel: outcome.label,
    outcomeTone: outcome.tone,
    classifiedAt: str(c.classified_at),
    sector,
    employeeRange,
    linkedin,
    rejectedCount: Array.isArray(c.rejected) ? c.rejected.length : 0,
    notOperatingCompany: c.is_operating_company === false,
    estimatedCostUsd: typeof c.estimated_cost_usd === 'number' ? c.estimated_cost_usd : null,
  };
}
