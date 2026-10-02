import type { DuplicateMatch } from '@/modules/prospect-batches/types';

export interface HubSpotSyncAudit {
  status: string;
  company_id?: string | null;
  sent_property_keys?: string[] | null;
  sent_properties_audit?: Record<string, unknown> | null;
  skipped_properties?: string[] | null;
  blocked_reason?: string | null;
  owner_mapping_status?: string | null;
  synced_at?: string | null;
  owner_assigned?: boolean | null;
  owner_id?: string | null;
  owner_email?: string | null;
  account_executive_assigned?: boolean | null;
  account_executive_property?: string | null;
  account_executive_value?: string | null;
  lifecyclestage_sent?: string | null;
  properties_sent?: Record<string, string> | null;
  properties_skipped?: string[] | null;
  warnings?: string[] | null;
}

export interface SheetQualityCheck {
  has_website?: boolean;
  has_linkedin?: boolean;
  import_confidence?: string;
  has_tax_identifier?: boolean;
  warnings?: string[];
  missing_fields?: string[];
}

export interface SheetDuplicateCheck {
  status?: string;
  matched_account_id?: string | null;
  matched_candidate_id?: string | null;
  matched_name?: string | null;
  matched_domain?: string | null;
  matched_website?: string | null;
  matched_country_code?: string | null;
  matched_tax_identifier?: string | null;
  matched_source?: string | null;
  matched_status?: string | null;
  matched_by?: string | null;
  confidence?: number;
}

export interface SheetHubSpotCheck {
  status?: string;
  matched_company_id?: string | null;
  matched_company_name?: string | null;
  matched_domain?: string | null;
  matched_website?: string | null;
  matched_phone?: string | null;
  matched_country?: string | null;
  matched_city?: string | null;
  matched_state?: string | null;
  matched_address?: string | null;
  matched_industry?: string | null;
  matched_macro_industry?: string | null;
  matched_lifecycle_stage?: string | null;
  matched_lead_status?: string | null;
  matched_owner_id?: string | null;
  matched_number_of_employees?: string | null;
  matched_description?: string | null;
  matched_linkedin_url?: string | null;
  matched_linkedin_bio?: string | null;
  matched_tax_identifier?: string | null;
  matched_createdate?: string | null;
  matched_lastmodifieddate?: string | null;
  matched_by?: string | null;
  confidence?: number;
  hubspot_url?: string | null;
}

export interface SheetNormalizedKeys {
  normalized_name?: string;
  normalized_domain?: string | null;
  normalized_tax_identifier?: string | null;
  normalized_linkedin_url?: string | null;
  country_code?: string | null;
}

export interface SheetValidationMetadata {
  validation_source?: string;
  sellup_duplicate_check?: SheetDuplicateCheck;
  hubspot_duplicate_check?: SheetHubSpotCheck;
  normalized_keys?: SheetNormalizedKeys;
  quality_check?: SheetQualityCheck;
  validated_at?: string;
}

export interface SheetImportMetadata {
  confidence?: string;
  company_size?: string;
  source_url?: string;
  source_evidence?: string;
  linkedin_url?: string | null;
}

export interface SheetCandidateMetadata {
  validation?: SheetValidationMetadata;
  import?: SheetImportMetadata;
  source_url?: string;
}

// ── Helpers de presentación ────────────────────────────────────

export function val(v: string | null | undefined, fallback = 'Sin dato'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return v;
}

export function getFlagEmoji(code: string) {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}

export function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export const DIRECTORY_DOMAINS = new Set([
  'registronit.com',
  'informacolombia.com',
  'datacreditoempresas.com.co',
  'einforma.co',
  'empresite.eleconomistaamerica.co',
  'empresite.com',
  'paginasamarillas.com.co',
  'procolombia.co',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'google.com',
  'gmail.com',
  'youtube.com',
  'wikipedia.org',
]);

export const DIRECTORY_KEYWORDS = [
  'paginasamarillas',
  'paginas-amarillas',
  'kompass',
  'opencorporates',
  'zoominfo',
  'clutch.co',
  'crunchbase',
  'emis.com',
  'empresite',
  'registronit',
  'informacolombia',
  'datacreditoempresas',
  'einforma',
  'datospymes',
  'directorioempresas',
  'buscaempresas',
  'rues.gov',
  'rues.org',
  'colombiacompra',
  'secop',
  'procolombia',
  'b2bmarketplace',
];

export function getTaxIdLabel(countryCode: string | null | undefined): string {
  switch (countryCode?.toUpperCase()) {
    case 'CO':
      return 'NIT';
    case 'MX':
      return 'RFC';
    case 'CL':
      return 'RUT';
    case 'PE':
      return 'RUC';
    case 'EC':
      return 'RUC';
    default:
      return 'identificador fiscal';
  }
}

export function isDirectoryOrThirdPartyDomain(url: string | null | undefined): boolean {
  const domain = extractDomainFromUrl(url);
  if (!domain) return false;
  if (DIRECTORY_DOMAINS.has(domain)) return true;
  if (DIRECTORY_KEYWORDS.some((k) => domain.includes(k))) return true;
  // Government institutional domains — never a commercial company website
  if (/\.gov\.co$/.test(domain) || domain === 'gov.co') return true;
  if (/\.gov\.cl$/.test(domain) || domain === 'gov.cl') return true;
  return false;
}

export function classifyRisk(riskText: string): 'critical' | 'high' | 'medium' | 'low' {
  const text = riskText.toLowerCase();
  if (
    text.includes('liquidación') ||
    text.includes('liquidation') ||
    text.includes('quiebra') ||
    text.includes('inactivo') ||
    text.includes('demanda') ||
    text.includes('fraude') ||
    text.includes('embargo')
  ) {
    return 'critical';
  }
  if (
    text.includes('alto') ||
    text.includes('high') ||
    text.includes('conflicto') ||
    text.includes('inconsistencia') ||
    text.includes('deuda')
  ) {
    return 'high';
  }
  if (
    text.includes('medio') ||
    text.includes('medium') ||
    text.includes('riesgo') ||
    text.includes('advertencia') ||
    text.includes('warning')
  ) {
    return 'medium';
  }
  return 'low';
}

export const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

export type { DuplicateMatch };

/** En candidatos de Chile, corrige las menciones heredadas del registro colombiano. */
export function sanitizeTextForChile(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bRUES\b/g, 'RES Chile')
    .replace(/sector Tecnología confirmado/gi, 'criterio solicitado Tecnología');
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  commercial_directory: 'Directorio comercial',
  public_registry: 'Registro público',
  chamber_of_commerce: 'Cámara de comercio',
  directory: 'Directorio',
  registry: 'Registro',
  news: 'Noticia / Prensa',
  social: 'Red social',
  linkedin_company: 'LinkedIn',
  official_website: 'Sitio web oficial',
};
