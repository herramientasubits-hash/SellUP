/**
 * Company Name Normalizer (Hito 16W.2)
 *
 * Detecta y limpia nombres de empresa que son frases SEO, títulos de listas,
 * o directorios. Extrae el nombre de marca real usando inferencia de dominio
 * como fallback cuando el nombre es genérico. Preserva el nombre original para
 * auditoría en originalName.
 *
 * No hace llamadas externas. No escribe en DB. No llama proveedores pagados.
 *
 * Reglas aplicadas en orden:
 *   1. Eliminar sufijo legal para visualización (SAS, Ltda, Inc…)
 *   2. Si el nombre resultante es una frase SEO → intentar inferencia de dominio
 *   3. Validar que la inferencia de dominio no produzca otro nombre genérico
 *   4. Retornar { name, originalName, wasNormalized, normalizationReason }
 */

// ─── SEO generic keyword set ──────────────────────────────────────────────────
// Exported para que prospecting-pipeline.ts pueda reusar sin duplicar.
// Superset del GENERIC_KEYWORDS original (Hito 13H) + nuevas entradas (Hito 16W.2).

export const SEO_GENERIC_KEYWORDS = new Set([
  // Servicios / soluciones
  'servicios', 'servicio', 'service', 'services',
  'soluciones', 'solucion', 'solution', 'solutions',
  // Empresa / compañía
  'empresa', 'empresarial', 'empresariales', 'company', 'companies',
  'corporaciones', 'corporacion', 'corporation',
  // Tecnología
  'tecnologia', 'tecnologica', 'tecnologico', 'tecnologicos', 'tecnologicas',
  'technology', 'tech',
  // IT / sistemas
  'outsourcing', 'externalizacion',
  'soporte', 'support',
  'informatico', 'informatica', 'informaticos', 'informaticas',
  'sistemas', 'systems', 'system',
  'redes', 'networks', 'network',
  'infraestructura', 'infrastructure',
  'informacion', 'information',
  // Consultoría / desarrollo
  'consultoria', 'consulting', 'consultancy',
  'desarrollo', 'development',
  'software',
  'ingenieria', 'engineering',
  // Gestión / negocios
  'gestion', 'management',
  'negocios', 'business',
  // Digital
  'digital', 'digitales',
  // Geografía (ciudades / países) — Colombia-centric
  'colombia', 'bogota', 'medellin', 'cali', 'barranquilla',
  // Partículas / preposiciones que indican frase descriptiva
  'para', 'empresas',
  // Listas / rankings (Hito 13H)
  'medida', 'ranking', 'listado', 'lista', 'top',
  // Adicionales Hito 16W.2
  'mejores', 'mejor',
  'directorio', 'directorios',
  'proveedores', 'proveedor',
  'agencias', 'agencia',
  'houses',          // "software houses"
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type CompanyNameNormalizationResult = {
  name: string;
  originalName: string;
  wasNormalized: boolean;
  normalizationReason?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DISPLAY_LEGAL_SUFFIX_RE =
  /[\s,]+(?:S\.A\.S\.?|SAS|S\.A\.?|Ltda\.?|E\.U\.?|Corp\.?|Inc\.?|LLC|S\.R\.L\.?|LTDA|S\.L\.)[\s.,]*$/i;

const KNOWN_TLDS = [
  '.com.co', '.net.co', '.org.co', '.edu.co', '.gov.co', '.mil.co',
  '.com', '.co', '.net', '.org', '.io', '.biz', '.info',
];

// ─── Private helpers ──────────────────────────────────────────────────────────

function normalizeForKeywords(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Matches promotional/editorial SEO patterns that keyword-density alone misses:
// "empresa de X", "servicios de X", "#N", ordinal claims, superlatives, geo-qualifiers.
const PROMOTIONAL_SEO_RE =
  /\b(?:empresas?\s+de|servicios?\s+de|soluciones?\s+de|para\s+empresas?|num(?:ero|\.?)?\s*1|l[ií]der(?:es)?|mejor(?:es)?|#\s*\d|en\s+(?:colombia|latam|bogot[aá]|medell[ií]n|cali|latinoam[eé]rica))\b/;

function hasPromotionalSEOModifiers(name: string): boolean {
  return PROMOTIONAL_SEO_RE.test(normalizeForKeywords(name));
}

function stripLegalSuffixForDisplay(name: string): string {
  return name.replace(DISPLAY_LEGAL_SUFFIX_RE, '').trim();
}

/**
 * Retorna true si el nombre es una frase genérica SEO (lista, directorio,
 * descripción de sector) y no un nombre de empresa real.
 *
 * Lógica: si ≥50% de las palabras significativas (longitud > 2) son
 * palabras clave genéricas, se considera frase SEO.
 * Excepción: si el nombre tiene sufijo legal (SAS, Ltda…) no se clasifica
 * como SEO — el sufijo legal indica entidad registrada.
 */
function isSEOPhrase(name: string): boolean {
  if (DISPLAY_LEGAL_SUFFIX_RE.test(name)) return false;

  // Promotional editorial patterns evade keyword-density checks — short-circuit early.
  if (hasPromotionalSEOModifiers(name)) return true;

  const words = normalizeForKeywords(name)
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (words.length === 0) return true;

  const genericCount = words.filter(w => SEO_GENERIC_KEYWORDS.has(w)).length;
  return genericCount / words.length >= 0.5;
}

/**
 * Infiere nombre de marca desde un dominio o URL.
 * Sin llamadas externas. Retorna null si no puede inferir un nombre limpio.
 */
function inferNameFromDomain(domainOrUrl: string): string | null {
  try {
    const parsed = new URL(
      domainOrUrl.startsWith('http') ? domainOrUrl : `https://${domainOrUrl}`
    );
    let host = parsed.hostname.replace(/^www\./, '');

    for (const tld of KNOWN_TLDS) {
      if (host.endsWith(tld)) {
        host = host.slice(0, -tld.length);
        break;
      }
    }

    if (!host || host.length < 2) return null;

    // Guiones → palabras separadas con Title Case
    if (host.includes('-')) {
      return host.split('-').map(toTitleCase).join(' ');
    }

    // Sufijo de país conocido ("solutekcolombia" → "Solutek Colombia")
    const countrySuffix =
      /^(.+?)(colombia|peru|mexico|argentina|chile|ecuador|venezuela)$/i.exec(host);
    if (countrySuffix) {
      const prefix = countrySuffix[1];
      const country = toTitleCase(countrySuffix[2]);
      const prefixName = prefix.length <= 4 ? prefix.toUpperCase() : toTitleCase(prefix);
      return `${prefixName} ${country}`;
    }

    // Dominio corto (≤4 chars) → acrónimo en mayúsculas
    if (host.length <= 4) return host.toUpperCase();

    return toTitleCase(host);
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normaliza el nombre de empresa propuesto para prospección.
 *
 * - Siempre: elimina sufijo legal para visualización (SAS, Ltda…)
 * - Si el resultado es una frase SEO: intenta inferir nombre desde dominio
 * - Preserva el nombre original en `originalName` para trazabilidad
 *
 * @param rawName  Nombre crudo (del LLM o inferencia de título)
 * @param domain   Dominio o URL del candidato para fallback (opcional)
 */
export function normalizeProspectCompanyName(
  rawName: string,
  domain?: string
): CompanyNameNormalizationResult {
  const originalName = rawName;

  // Step 1: strip legal suffix for display
  const withoutSuffix = stripLegalSuffixForDisplay(rawName);

  // Step 2: if not SEO after stripping, we're done
  if (!isSEOPhrase(withoutSuffix)) {
    const wasNormalized = withoutSuffix !== rawName;
    return {
      name: withoutSuffix,
      originalName,
      wasNormalized,
      normalizationReason: wasNormalized ? 'legal_suffix_stripped' : undefined,
    };
  }

  // Step 3: name is SEO — attempt domain fallback
  if (domain) {
    const fromDomain = inferNameFromDomain(domain);
    // Reject domain-inferred name if it's also SEO (e.g. "empresas-colombia.com")
    if (fromDomain && !isSEOPhrase(fromDomain)) {
      return {
        name: fromDomain,
        originalName,
        wasNormalized: true,
        normalizationReason: 'seo_phrase_replaced_by_domain',
      };
    }
  }

  // Step 4: no clean fallback — return stripped name with flag
  return {
    name: withoutSuffix || rawName,
    originalName,
    wasNormalized: withoutSuffix !== rawName,
    normalizationReason: 'seo_phrase_no_clean_fallback',
  };
}
