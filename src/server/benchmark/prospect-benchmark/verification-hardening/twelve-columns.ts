/**
 * Verification Hardening — Uniform Twelve-Column Transformer (Hotfix 16AB.24.11)
 *
 * Single source of truth for transforming a verified candidate into the
 * twelve-column review format. All candidates MUST use this function.
 * No ad-hoc column construction is permitted in scripts or callers.
 *
 * Column headers (exact):
 *   Empresa | País | Sector | Sitio web | LinkedIn | Ciudad |
 *   Tamaño estimado | Descripción | URL evidencia principal |
 *   Fuente / evidencia | Confianza | Notas
 *
 * Invariants:
 *   - Sector always uses the macrosector "Tecnología"
 *   - Subsector goes to Descripción or Notas, never replaces Sector
 *   - Descripción is generated deterministically from structured fields
 *   - Fuente / evidencia is generated deterministically from evidence fields
 *   - No model calls are made
 *   - Unknown URLs are never listed as confirmed sources
 */

// ─── Column definition ─────────────────────────────────────────────────────────

export const TWELVE_COLUMN_HEADERS = [
  'Empresa',
  'País',
  'Sector',
  'Sitio web',
  'LinkedIn',
  'Ciudad',
  'Tamaño estimado',
  'Descripción',
  'URL evidencia principal',
  'Fuente / evidencia',
  'Confianza',
  'Notas',
] as const;

export type TwelveColumnHeader = (typeof TWELVE_COLUMN_HEADERS)[number];
export type TwelveColumnRow = Record<TwelveColumnHeader, string | null>;

// ─── Input contract ────────────────────────────────────────────────────────────

export type TwelveColumnInput = {
  candidateName: string;
  identity: {
    commercialName: string | null;
    legalName: string | null;
    aliases: string[];
    domain: string | null;
  };
  country: string;
  officialWebsite: string | null;
  linkedin: string | null;
  city: string | null;
  additionalCities: string[];
  estimatedSize: string | null;
  sizeScope: string | null;
  technologyB2bFit: {
    reason: string | null;
    subsector: string | null;
    isVerified: boolean;
  };
  colombiaOperation: {
    confirmed: boolean;
    cities: string[];
    evidence: string | null;
  };
  primaryEvidenceUrl: string | null;
  primaryEvidenceProvenance: string | null;
  identityEvidenceSources: string[];
  confidence: 'Alta' | 'Media' | 'Baja';
  conflicts: string[];
  duplicateStatus: string | null;
  requiresHumanReview: boolean;
  yearOrDate: string | null;
  extraNotes: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MACRO_SECTOR = 'Tecnología';
const DESCRIPTION_MAX_CHARS = 500;

function buildDescription(input: TwelveColumnInput): string | null {
  const parts: string[] = [];

  if (input.technologyB2bFit.reason) {
    parts.push(input.technologyB2bFit.reason.trim());
  }

  const companyRef = input.identity.commercialName ?? input.candidateName;

  if (input.colombiaOperation.confirmed && !parts.some((p) => /colombia/i.test(p))) {
    const citiesStr =
      input.colombiaOperation.cities.length > 0
        ? ` en ${input.colombiaOperation.cities.slice(0, 2).join(' y ')}`
        : '';
    parts.push(`Operación confirmada en Colombia${citiesStr}.`);
  }

  if (input.technologyB2bFit.subsector && parts.length > 0) {
    parts.push(`Subsegmento: ${input.technologyB2bFit.subsector}.`);
  }

  if (parts.length === 0) {
    if (input.identity.domain) {
      parts.push(`${companyRef} (${input.identity.domain}).`);
    } else {
      return null;
    }
  }

  const joined = parts.join(' ').trim();
  if (joined.length <= DESCRIPTION_MAX_CHARS) return joined;
  return joined.slice(0, DESCRIPTION_MAX_CHARS - 1) + '…';
}

function buildEvidenceSource(input: TwelveColumnInput): string | null {
  const sources: string[] = [];

  const domain = input.identity.domain;

  if (domain && input.officialWebsite) {
    sources.push(`Sitio oficial (${domain})`);
  }

  if (input.linkedin) {
    const slug = (() => {
      try {
        return new URL(input.linkedin).pathname.replace(/\/$/, '').split('/').pop() ?? null;
      } catch {
        return null;
      }
    })();
    sources.push(`LinkedIn corporativo${slug ? ` (${slug})` : ''}`);
  }

  for (const src of input.identityEvidenceSources) {
    const trimmed = src.trim();
    if (!trimmed) continue;
    const isDuplicate = sources.some(
      (s) => s.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(s.toLowerCase())
    );
    if (!isDuplicate && sources.length < 4) {
      sources.push(trimmed);
    }
  }

  if (
    input.primaryEvidenceUrl &&
    input.primaryEvidenceProvenance &&
    input.primaryEvidenceProvenance !== 'unknown_origin' &&
    input.primaryEvidenceProvenance !== 'model_generated_url'
  ) {
    const alreadyIncluded = sources.some((s) =>
      input.primaryEvidenceUrl ? s.includes(input.primaryEvidenceUrl) : false
    );
    if (!alreadyIncluded && sources.length < 5) {
      sources.push(`Evidencia principal (${input.primaryEvidenceUrl})`);
    }
  }

  return sources.length > 0 ? sources.join('; ') : null;
}

function buildNotes(input: TwelveColumnInput): string | null {
  const parts: string[] = [];

  if (input.identity.legalName) {
    parts.push(`Razón social: ${input.identity.legalName}`);
  }

  if (input.additionalCities.length > 0) {
    parts.push(`Ciudades adicionales: ${input.additionalCities.join(', ')}`);
  }

  if (input.sizeScope) {
    parts.push(`Alcance tamaño: ${input.sizeScope}`);
  }

  if (input.yearOrDate) {
    parts.push(input.yearOrDate);
  }

  if (input.conflicts.length > 0) {
    parts.push(`Conflictos: ${input.conflicts.join('; ')}`);
  }

  if (input.duplicateStatus) {
    parts.push(`Duplicidad: ${input.duplicateStatus}`);
  }

  if (input.requiresHumanReview) {
    parts.push('Requiere revisión humana');
  }

  if (input.extraNotes) {
    parts.push(input.extraNotes.trim());
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

// ─── Main transformer ──────────────────────────────────────────────────────────

export function transformVerificationToTwelveColumns(input: TwelveColumnInput): TwelveColumnRow {
  const empresa = input.identity.commercialName ?? input.candidateName;

  return {
    Empresa: empresa,
    País: input.country,
    Sector: MACRO_SECTOR,
    'Sitio web': input.officialWebsite,
    LinkedIn: input.linkedin,
    Ciudad: input.city,
    'Tamaño estimado': input.estimatedSize,
    Descripción: buildDescription(input),
    'URL evidencia principal': input.primaryEvidenceUrl,
    'Fuente / evidencia': buildEvidenceSource(input),
    Confianza: input.confidence,
    Notas: buildNotes(input),
  };
}

// ─── TSV serializer ────────────────────────────────────────────────────────────

export function serializeTwelveColumnsTsv(rows: TwelveColumnRow[]): string {
  const escape = (v: string | null): string => {
    if (v === null) return '';
    return v.replace(/\t/g, ' ').replace(/\n/g, ' ');
  };

  const header = TWELVE_COLUMN_HEADERS.join('\t');
  const dataRows = rows.map((row) =>
    TWELVE_COLUMN_HEADERS.map((h) => escape(row[h])).join('\t')
  );

  return [header, ...dataRows].join('\n');
}

// ─── Row validator ────────────────────────────────────────────────────────────

export function validateTwelveColumnRow(row: TwelveColumnRow): string[] {
  const errors: string[] = [];

  for (const header of TWELVE_COLUMN_HEADERS) {
    if (!(header in row)) {
      errors.push(`Missing column: "${header}"`);
    }
  }

  if (row['Sector'] !== MACRO_SECTOR) {
    errors.push(`Sector must be "${MACRO_SECTOR}" but got "${String(row['Sector'])}"`);
  }

  if (!row['Empresa']) {
    errors.push('Empresa must be non-null and non-empty');
  }

  return errors;
}
