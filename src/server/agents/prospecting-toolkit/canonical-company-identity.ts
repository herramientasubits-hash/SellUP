/**
 * Canonical Company Identity — Hito 16AB.43.25
 *
 * Construye la clave de identidad canónica de una empresa para deduplicación semántica.
 * Permite detectar que "Siesa Enterprise" y "Siesa" son la misma empresa.
 * Detecta frases/categorías que no son nombres de empresa ("SaaS y plataformas").
 *
 * Sin llamadas externas. Sin writes. Sin LLM. Determinístico.
 *
 * Ejemplos de identityKey:
 *   "Siesa Enterprise"    → "siesa"
 *   "SIESA S.A.S."        → "siesa"
 *   "Loggro Enterprise"   → "loggro"
 *   "EDUCA EDTECH Group"  → "educa edtech"
 *   "IEBS Business School"→ "iebs business school"
 *   "Softland"            → "softland"
 *   "Contarerp"           → "contarerp"
 *
 * Ejemplos de frases bloqueadas:
 *   "SaaS y plataformas"         → isNonCompanyPhrase: true
 *   "Software empresarial"        → isNonCompanyPhrase: true
 *   "Plataformas LMS"             → isNonCompanyPhrase: true
 *   "Soluciones y tecnología"     → isNonCompanyPhrase: true
 */

// ─── Page-title y etiquetas comerciales genéricas — nunca son nombres de empresa (Hito 16AB.43.27) ──

/**
 * Títulos de página que aparecen como "nombre" cuando Tavily extrae
 * el título de una sección de un sitio web en lugar del nombre de la empresa.
 * Ejemplos: itscolombia.net/nosotros → title "Nosotros"
 */
const PAGE_TITLE_EXACT = new Set([
  'nosotros',
  'quienes somos',
  'quiénes somos',
  'sobre nosotros',
  'acerca de nosotros',
  'about us',
  'who we are',
  'contacto',
  'contact',
  'inicio',
  'home',
]);

/**
 * Etiquetas comerciales genéricas que no son nombres de empresa real.
 * Pueden aparecer como snippet o título de landing page de marketing.
 */
const GENERIC_COMMERCIAL_LABELS_EXACT = new Set([
  'aliado elite',
  'aliado élite',
  'partner tecnologico',
  'partner tecnológico',
  'proveedor especializado',
  'proveedor especializada',
  'soluciones empresariales',
  'consultoria en transformacion digital',
  'consultoría en transformación digital',
  'servicios tecnologicos',
  'servicios tecnológicos',
]);

// ─── Sufijos legales (igual a normalization.ts para coherencia) ───────────────

const LEGAL_SUFFIX_RE =
  /[\s,]+(?:s\.?\s*a\.?\s*s\.?|s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?\s*de\s+c\.?\s*v\.?|s\.?\s*a\.?|sas|srl|spa|ltda\.?|s\.?\s*l\.?|inc\.?|llc|corp\.?|ag|sa|sl|de\s+c\.?\s*v\.?)[\s.,]*$/i;

// ─── Descriptores de marca al final que no cambian la identidad base ──────────
//
// Se eliminan solo cuando están al final del nombre y el resultado tiene ≥1 palabra.
// Ejemplo: "Siesa Enterprise" → "siesa", "Loggro Enterprise" → "loggro"
// NO se eliminan palabras del medio: "IEBS Business School" sigue siendo "iebs business school"

const TRAILING_BRAND_DESCRIPTORS = new Set([
  'enterprise', 'enterprises',
  'group', 'groups',
  'holdings', 'holding',
  'global',
  'international',
  'technologies', 'technology',
  'digital',
  'tech',
  'corporation', 'corporations',
]);

// ─── Palabras de categoría que aparecen en frases no-empresa ─────────────────
//
// Se usan para detectar frases tipo "SaaS y plataformas", "Software empresarial".
// No son palabras de marca — son descriptores genéricos de producto/servicio.

const CATEGORY_WORDS = new Set([
  // Categorías de producto tech
  'saas', 'paas', 'iaas', 'erp', 'crm', 'lms', 'hrm', 'hcm', 'scm', 'bi', 'iot', 'ai',
  // Tipos de producto genérico
  'software', 'plataforma', 'plataformas', 'platform', 'platforms',
  'sistema', 'sistemas', 'system', 'systems',
  'aplicacion', 'aplicaciones', 'app', 'apps', 'application', 'applications',
  // Categorías de servicio
  'servicio', 'servicios', 'service', 'services',
  'solucion', 'soluciones', 'solution', 'solutions',
  // Categorías de negocio
  'empresa', 'empresas', 'empresarial', 'empresariales', 'company', 'companies',
  'negocio', 'negocios', 'business',
  // Tecnología genérica (todas las formas de género/número)
  'tecnologia', 'tecnologias', 'tecnologico', 'tecnologicos', 'tecnologica', 'tecnologicas',
  'technology', 'technologies',
  'digital', 'digitales', 'informatica', 'informatico', 'informaticas', 'informaticos',
  // Gestión
  'gestion', 'administracion', 'management',
  // Educación
  'educacion', 'formacion', 'aprendizaje', 'capacitacion', 'education', 'learning',
  // Herramientas
  'herramienta', 'herramientas', 'tool', 'tools',
  // Desarrollo
  'desarrollo', 'development',
]);

// ─── Tipo público ─────────────────────────────────────────────────────────────

export type CanonicalCompanyIdentity = {
  rawName: string;
  /** Clave mínima comparable. Vacía si isNonCompanyPhrase. */
  identityKey: string;
  /** true si el nombre es una frase/categoría, no un nombre de empresa real. */
  isNonCompanyPhrase: boolean;
  /** Razón del bloqueo, si aplica. */
  nonCompanyReason?: string;
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

function normalizeForIdentity(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLegalSuffix(name: string): string {
  return name.replace(LEGAL_SUFFIX_RE, '').trim();
}

/** Elimina descriptores de marca al final del nombre normalizado. */
function stripTrailingBrandDescriptors(normalizedName: string): string {
  const words = normalizedName.split(' ');
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (TRAILING_BRAND_DESCRIPTORS.has(last)) {
      words.pop();
    } else {
      break;
    }
  }
  return words.join(' ');
}

/** Regex para conjunciones españolas/inglesas entre términos de categoría. */
const CONJUNCTION_RE = /\s+(?:y|e|o|and|or)\s+/i;

/**
 * Retorna true si el grupo de palabras normalizadas es predominantemente
 * palabras de categoría (sin señal de marca real).
 * Umbral: ≥60% de las palabras son CATEGORY_WORDS.
 */
function isCategoryWordGroup(words: string[]): boolean {
  if (words.length === 0) return true;
  const catCount = words.filter((w) => CATEGORY_WORDS.has(w)).length;
  return catCount / words.length >= 0.6;
}

/**
 * Detecta frases con conjunción entre términos de categoría:
 * "SaaS y plataformas", "Soluciones y estrategia", "Software o servicios"
 *
 * Reglas:
 * - Contiene " y " / " e " / " o " / " and " / " or "
 * - Ninguna parte de la conjunción tiene señal de marca real (no es todo CATEGORY_WORDS)
 * - No tiene sufijo legal (lo que indicaría entidad registrada real)
 */
function isConjunctionCategoryPhrase(name: string): boolean {
  if (!CONJUNCTION_RE.test(name)) return false;
  if (LEGAL_SUFFIX_RE.test(name)) return false;

  const parts = name.split(CONJUNCTION_RE);
  if (parts.length < 2) return false;

  return parts.every((part) => {
    const words = normalizeForIdentity(part.trim())
      .split(' ')
      .filter((w) => w.length > 1);
    return isCategoryWordGroup(words);
  });
}

/**
 * Detecta nombres donde TODAS las palabras significativas son términos de categoría.
 * "Software empresarial", "Plataformas LMS", "Soluciones tecnológicas".
 */
function isAllCategoryWords(name: string): boolean {
  if (LEGAL_SUFFIX_RE.test(name)) return false;
  const words = normalizeForIdentity(name)
    .split(' ')
    .filter((w) => w.length > 1);
  if (words.length === 0) return true;
  return words.every((w) => CATEGORY_WORDS.has(w));
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Construye la identidad canónica de una empresa para deduplicación semántica.
 *
 * Pipeline:
 *   1. Detección de frase-categoría (conjunción o palabras genéricas)
 *   2. Strip sufijo legal
 *   3. Normalización (minúsculas, sin tildes, sin puntuación)
 *   4. Strip descriptores de marca al final
 */
export function buildCanonicalCompanyIdentity(rawName: string): CanonicalCompanyIdentity {
  const name = (rawName ?? '').trim();

  if (!name) {
    return { rawName, identityKey: '', isNonCompanyPhrase: true, nonCompanyReason: 'empty_name' };
  }

  // ── Detección page-title / etiqueta genérica (Hito 16AB.43.27) ────────────
  const nameLower = normalizeForIdentity(name);

  if (PAGE_TITLE_EXACT.has(nameLower)) {
    return {
      rawName,
      identityKey: '',
      isNonCompanyPhrase: true,
      nonCompanyReason: 'page_title_not_company_name',
    };
  }

  if (GENERIC_COMMERCIAL_LABELS_EXACT.has(nameLower)) {
    return {
      rawName,
      identityKey: '',
      isNonCompanyPhrase: true,
      nonCompanyReason: 'generic_commercial_label',
    };
  }

  // ── Detección de frase no-empresa ─────────────────────────────────────────
  if (isConjunctionCategoryPhrase(name)) {
    return {
      rawName,
      identityKey: '',
      isNonCompanyPhrase: true,
      nonCompanyReason: 'conjunction_between_categories',
    };
  }

  if (isAllCategoryWords(name)) {
    return {
      rawName,
      identityKey: '',
      isNonCompanyPhrase: true,
      nonCompanyReason: 'all_words_are_category_terms',
    };
  }

  // ── Construir identity key ────────────────────────────────────────────────
  const withoutLegal = stripLegalSuffix(name);
  const normalized = normalizeForIdentity(withoutLegal);
  const identityKey = stripTrailingBrandDescriptors(normalized).trim();

  if (!identityKey) {
    return {
      rawName,
      identityKey: '',
      isNonCompanyPhrase: true,
      nonCompanyReason: 'empty_identity_key_after_normalization',
    };
  }

  return { rawName, identityKey, isNonCompanyPhrase: false };
}

/**
 * Retorna solo la clave de identidad (vacía si es frase no-empresa).
 */
export function buildIdentityKey(name: string): string {
  return buildCanonicalCompanyIdentity(name).identityKey;
}
