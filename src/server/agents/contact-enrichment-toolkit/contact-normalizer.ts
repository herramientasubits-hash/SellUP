// Agente 2A — Apollo Contact Normalizer
// Hito 17A.3A — Convierte ApolloPerson en un contacto normalizado de staging.
// Función pura: sin red, sin DB. Segura para tests unitarios.

import type { ApolloPerson } from '@/server/integrations/apollo-client';
import { pickBestApolloPhone, type ClassifiedPhone } from './phone-classification';

// ── Normalización de cargo Apollo ─────────────────────────────────
// Apollo a veces devuelve en el campo title una mezcla de cargo real,
// headline de LinkedIn y especialidades, separados por |, ·, —, etc.
// Extraemos el primer segmento como cargo limpio y preservamos el raw.

const TITLE_SEPARATORS = [' | ', '|', ' · ', '•', ' — ', ' – ', ' - '] as const;
const MIN_SEGMENT_LENGTH = 3;

export interface ApolloJobTitleNormalization {
  rawTitle: string | null;
  normalizedTitle: string | null;
  changed: boolean;
  strategy: 'empty' | 'unchanged' | 'split_by_separator' | 'fallback_original';
  separator?: string;
}

export function normalizeApolloJobTitle(raw: string | null | undefined): ApolloJobTitleNormalization {
  if (!raw || typeof raw !== 'string') {
    return { rawTitle: null, normalizedTitle: null, changed: false, strategy: 'empty' };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { rawTitle: null, normalizedTitle: null, changed: false, strategy: 'empty' };
  }

  for (const sep of TITLE_SEPARATORS) {
    if (trimmed.includes(sep)) {
      const first = trimmed.split(sep)[0].trim();
      if (first.length >= MIN_SEGMENT_LENGTH) {
        return {
          rawTitle: trimmed,
          normalizedTitle: first,
          changed: first !== trimmed,
          strategy: 'split_by_separator',
          separator: sep,
        };
      }
      // Primer segmento demasiado corto → fallback al raw.
      return {
        rawTitle: trimmed,
        normalizedTitle: trimmed,
        changed: false,
        strategy: 'fallback_original',
        separator: sep,
      };
    }
  }

  return { rawTitle: trimmed, normalizedTitle: trimmed, changed: false, strategy: 'unchanged' };
}

// ── Contacto normalizado ──────────────────────────────────────

export interface NormalizedApolloContact {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  country: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  source: 'apollo';
  sourceContactId: string | null;
  confidence: number;
  enrichmentMetadata: Record<string, unknown>;
}

// ── Vocabulario de seniority (conservador) ─────────────────────
// Mapea los valores de Apollo a un vocabulario estable interno.

const SENIORITY_MAP: Record<string, string> = {
  owner: 'owner',
  founder: 'owner',
  c_suite: 'executive',
  c_level: 'executive',
  partner: 'partner',
  vp: 'vp',
  head: 'director',
  director: 'director',
  manager: 'manager',
  senior: 'senior',
  entry: 'entry',
  intern: 'entry',
};

export function normalizeSeniority(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SENIORITY_MAP[key] ?? 'employee';
}

// ── Normalización de strings ───────────────────────────────────

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const cleaned = cleanString(value)?.toLowerCase() ?? null;
  if (!cleaned) return null;
  // Apollo a veces devuelve placeholders de email bloqueados.
  if (cleaned.includes('email_not_unlocked') || cleaned.includes('domain.com')) {
    return null;
  }
  return cleaned;
}

function normalizeLinkedin(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  return cleaned.toLowerCase().replace(/\/+$/, '');
}

/**
 * Selecciona el mejor teléfono de Apollo conservando su tipo y fuente.
 * El número escalar resultante mantiene el comportamiento previo (primer
 * número no vacío, ahora priorizado por tipo: móvil personal > móvil >
 * marcado directo > work > hq > other > unknown). Devuelve null si no hay
 * ningún número utilizable.
 *
 * PHONE-3A: no revela teléfonos nuevos ni gasta créditos; solo preserva el
 * `type` que Apollo ya entrega gratis en la búsqueda.
 */
function pickPhone(person: ApolloPerson): ClassifiedPhone | null {
  return pickBestApolloPhone(person.phone_numbers);
}

function pickDepartment(person: ApolloPerson): string | null {
  const departments = person.departments ?? [];
  const sub = person.subdepartments ?? [];
  const candidate = [...departments, ...sub].find((d) => cleanString(d));
  if (!candidate) return null;
  // Apollo usa snake_case (p. ej. "human_resources") — lo dejamos legible.
  return candidate.trim().replace(/_/g, ' ');
}

function buildFullName(
  firstName: string | null,
  lastName: string | null,
  fallback: string | null,
): string | null {
  const joined = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (joined.length > 0) return joined;
  return fallback;
}

// ── Confianza heurística (sin LLM) ─────────────────────────────
// Apollo no entrega un score; lo derivamos de la completitud del perfil.

function computeConfidence(input: {
  hasEmail: boolean;
  hasLinkedin: boolean;
  hasTitle: boolean;
  hasSeniority: boolean;
}): number {
  let score = 0.5;
  if (input.hasEmail) score += 0.2;
  if (input.hasLinkedin) score += 0.15;
  if (input.hasTitle) score += 0.1;
  if (input.hasSeniority) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

/**
 * Normaliza una persona de Apollo a un contacto de staging.
 * Devuelve null si no hay un nombre completo utilizable (regla del hito:
 * no insertar candidatos sin full_name).
 */
export function normalizeApolloPerson(
  person: ApolloPerson,
): NormalizedApolloContact | null {
  const firstName = cleanString(person.first_name);
  const lastName = cleanString(person.last_name);
  const headline = cleanString(person.headline);
  const fullName = buildFullName(firstName, lastName, headline);

  if (!fullName) {
    return null;
  }

  const email = normalizeEmail(person.email);
  const linkedinUrl = normalizeLinkedin(person.linkedin_url);
  const titleNorm = normalizeApolloJobTitle(person.title);
  const title = titleNorm.normalizedTitle;
  const seniority = normalizeSeniority(person.seniority);
  const department = pickDepartment(person);
  const country = cleanString(person.country);
  const classifiedPhone = pickPhone(person);
  const phone = classifiedPhone?.number ?? null;

  const confidence = computeConfidence({
    hasEmail: !!email,
    hasLinkedin: !!linkedinUrl,
    hasTitle: !!title,
    hasSeniority: !!seniority,
  });

  return {
    firstName,
    lastName,
    fullName,
    title,
    seniority,
    department,
    country,
    linkedinUrl,
    email,
    phone,
    source: 'apollo',
    sourceContactId: cleanString(person.id),
    confidence,
    enrichmentMetadata: {
      provider: 'apollo',
      apollo_id: person.id,
      raw_seniority: person.seniority ?? null,
      departments: person.departments ?? [],
      subdepartments: person.subdepartments ?? [],
      headline: headline ?? null,
      email_status: person.email_status ?? null,
      organization: person.organization
        ? {
            id: person.organization.id,
            name: person.organization.name,
            website_url: person.organization.website_url,
          }
        : null,
      apollo_title_normalization: {
        raw_title: titleNorm.rawTitle,
        normalized_title: titleNorm.normalizedTitle,
        changed: titleNorm.changed,
        strategy: titleNorm.strategy,
        ...(titleNorm.separator !== undefined ? { separator: titleNorm.separator } : {}),
      },
      // PHONE-3A: conserva el tipo/fuente que Apollo ya entrega en la búsqueda.
      // Se omite cuando no hay teléfono utilizable (patrón aditivo, no obligatorio).
      ...(classifiedPhone
        ? {
            phone: {
              number: classifiedPhone.number,
              type: classifiedPhone.type,
              source: classifiedPhone.source,
              raw_type: classifiedPhone.raw_type,
            },
          }
        : {}),
    },
  };
}

/** Normaliza una lista, descartando los que no tienen full_name. */
export function normalizeApolloPeople(
  people: ApolloPerson[],
): { normalized: NormalizedApolloContact[]; droppedNoName: number } {
  const normalized: NormalizedApolloContact[] = [];
  let droppedNoName = 0;
  for (const person of people) {
    const result = normalizeApolloPerson(person);
    if (result) {
      normalized.push(result);
    } else {
      droppedNoName += 1;
    }
  }
  return { normalized, droppedNoName };
}
