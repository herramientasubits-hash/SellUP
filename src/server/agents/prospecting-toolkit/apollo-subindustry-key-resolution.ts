/**
 * apollo-subindustry-key-resolution.ts — IDENTIDAD de una subindustria, resuelta
 * sólo por coincidencia EXACTA.
 *
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2A · §§ 2, 3, 5, 9 y 11.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * `apollo-subindustry-precision.ts` resolvía la clave de catálogo de una
 * subindustria así:
 *
 *   for (const key of Object.keys(SUBINDUSTRY_ANCHOR_TERMS)) {
 *     if (normalized.includes(key) || key.includes(normalized)) return key;
 *   }
 *
 * Las dos mitades son inseguras y lo son por motivos distintos:
 *
 *   `normalized.includes(key)`  cualquier etiqueta que CONTENGA la clave la
 *                               resuelve. «Supermercados e Hipermercados extra»
 *                               —o cualquier sufijo que un día añada el catálogo—
 *                               hereda el catálogo completo de anclas.
 *
 *   `key.includes(normalized)`  cualquier etiqueta CONTENIDA en la clave la
 *                               resuelve, y las claves son frases largas. Con las
 *                               dos claves actuales, `"super"`, `"moda"`,
 *                               `"calzado"`, `"tiendas"`, `"departamento"`,
 *                               `"mercados"` y —medido, no supuesto— las cadenas
 *                               de UNA sola letra `"a"`, `"e"`, `"s"`, `"o"`,
 *                               `"y"` resuelven a una subindustria real.
 *
 * No es cosmético. `subindustryMapped: true` cambia el desenlace del candidato:
 * con evidencia de ancla queda `confirmed` y CUENTA hacia el objetivo (PR #251),
 * y con industria declarada contradictoria queda `rejected` y deja de
 * persistirse. Una etiqueta basura, o una subindustria legítima que resulte ser
 * substring de otra, decide así gasto y admisión bajo el catálogo de OTRA
 * subindustria — y el ganador lo elige el orden de `Object.keys`, no una regla.
 *
 * Con 2 claves largas el daño está acotado a etiquetas que nadie envía hoy. Con
 * 12 claves cortas —`banca tradicional`, `agritech`, `insurtech`, `legaltech`— la
 * colisión pasa a ser la norma. Por eso esta corrección va ANTES de ampliar la
 * cobertura, no después.
 *
 * ── El contrato nuevo (§ 2) ───────────────────────────────────────────────────
 *
 * La identidad de una subindustria se resuelve ÚNICAMENTE por:
 *
 *   1. `subindustryId` exacto, si quien llama lo tiene;
 *   2. nombre canónico normalizado EXACTO;
 *   3. alias EXPLÍCITO normalizado EXACTO;
 *   4. nada — `null`, fail-closed.
 *
 * Prohibido, sin excepción: substring implícito, prefijo, sufijo, contención
 * bidireccional, token parcial como identidad y cualquier forma de fuzzy
 * matching. Dos cadenas normalizadas distintas NO son la misma subindustria salvo
 * que un alias explícito lo declare.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

// ─── Normalización (§ 3) ──────────────────────────────────────────────────────

/**
 * La MISMA normalización que ya usaba la precisión, extraída para que exista una
 * sola: minúsculas, descomposición Unicode, marcas diacríticas fuera, espacios
 * colapsados y recortados.
 *
 * La puntuación NO se normaliza, y es deliberado: el contrato vigente tampoco lo
 * hacía, y quitar la coma de «Tiendas por Departamento, Moda y Calzado» sería
 * introducir una equivalencia nueva —justo la clase de laxitud que esta fase
 * elimina—.
 */
export function normalizeSubindustryIdentity(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Registro de identidad ────────────────────────────────────────────────────

/**
 * Una subindustria con política de PRECISIÓN declarada.
 *
 * `key` es la clave con la que los catálogos de precisión (anclas, exclusiones,
 * conflictos, amplias, contradicciones) indexan sus listas. Se mantiene separada
 * de `canonicalName` porque las listas ya están escritas contra la forma
 * normalizada, y renombrarlas no es asunto de esta fase.
 */
export type SubindustryPrecisionIdentityEntry = {
  /** Clave de indexación de los catálogos de precisión. Ya normalizada. */
  key: string;
  /** Nombre canónico tal como lo publica el catálogo. */
  canonicalName: string;
  /**
   * `public.subindustries.id`. `null` mientras la precisión no reciba la versión
   * del catálogo — ver § 11 y `SUBINDUSTRY_PRECISION_PHASE_2B_INPUT`.
   */
  subindustryId: string | null;
  /**
   * Alias EXPLÍCITOS, code-owned, que resuelven a esta entrada por igualdad
   * normalizada. Vacío no es un pendiente: es la declaración de que hoy sólo el
   * nombre canónico resuelve (§ 4).
   */
  explicitAliases: readonly string[];
};

/** Cómo se resolvió la identidad. Trazable a propósito: `null` no dice por qué. */
export type SubindustryIdentityMatchKind = 'subindustry_id' | 'canonical_name' | 'explicit_alias';

export type SubindustryIdentityResolution = {
  key: string;
  canonicalName: string;
  subindustryId: string | null;
  matchedBy: SubindustryIdentityMatchKind;
};

/**
 * Lo que quien llama sabe de la subindustria pedida.
 *
 * `subindustryId` es opcional porque hoy NINGÚN consumidor de precisión lo tiene:
 * la etiqueta viaja como texto desde la selección del wizard. Está en el contrato
 * para que Phase 2B pueda pasarlo sin cambiar la firma (§ 11).
 */
export type SubindustryIdentityRequest = {
  label?: string | null;
  subindustryId?: string | null;
};

// ─── Resolución (§ 2, § 9) ────────────────────────────────────────────────────

/**
 * Resuelve la identidad de una subindustria, o `null`.
 *
 * Orden del § 2, y cada paso es una IGUALDAD:
 *
 *   1. `subindustryId` exacto contra una entrada que declare id;
 *   2. nombre canónico normalizado exacto;
 *   3. alias explícito normalizado exacto, y sólo si NO es ambiguo.
 *
 * Fail-closed (§ 9): sin coincidencia devuelve `null`. No hay fallback al sector
 * padre, ni «clave más cercana», ni primera entrada del registro, ni mapping por
 * defecto. Un alias declarado por DOS entradas no elige ganador: no resuelve.
 */
export function resolveSubindustryPrecisionIdentity(
  request: SubindustryIdentityRequest,
  registry: readonly SubindustryPrecisionIdentityEntry[],
): SubindustryIdentityResolution | null {
  const requestedId = request.subindustryId?.trim();
  if (requestedId) {
    const byId = registry.find((entry) => entry.subindustryId === requestedId);
    if (byId) {
      return {
        key: byId.key,
        canonicalName: byId.canonicalName,
        subindustryId: byId.subindustryId,
        matchedBy: 'subindustry_id',
      };
    }
    // Un id que el registro no conoce NO degrada a búsqueda por nombre: el id es
    // la identidad más fuerte, y aceptar la etiqueta tras fallar el id sería
    // dejar que la forma débil contradiga a la fuerte.
    return null;
  }

  const label = request.label?.trim();
  if (!label) return null;
  const normalized = normalizeSubindustryIdentity(label);
  if (normalized === '') return null;

  for (const entry of registry) {
    if (normalizeSubindustryIdentity(entry.canonicalName) === normalized || entry.key === normalized) {
      return {
        key: entry.key,
        canonicalName: entry.canonicalName,
        subindustryId: entry.subindustryId,
        matchedBy: 'canonical_name',
      };
    }
  }

  // Alias explícito. Se recorre TODO el registro antes de decidir: un alias que
  // dos entradas declaran es ambiguo y no puede resolver a la primera que lo cite.
  const aliasMatches = registry.filter((entry) =>
    entry.explicitAliases.some((alias) => normalizeSubindustryIdentity(alias) === normalized),
  );
  if (aliasMatches.length !== 1) return null;

  const [matched] = aliasMatches;
  return {
    key: matched.key,
    canonicalName: matched.canonicalName,
    subindustryId: matched.subindustryId,
    matchedBy: 'explicit_alias',
  };
}

// ─── Auditoría de colisiones (§ 5) ────────────────────────────────────────────

/**
 * Etiquetas de UNA subindustria del catálogo publicado, tal como la auditoría las
 * recibe. Sólo lectura: esta auditoría NUNCA consulta la base de datos.
 */
export type SubindustryCatalogLabels = {
  canonicalName: string;
  aliases: readonly string[];
};

export type SubindustryIdentityCollision = {
  normalized: string;
  /** Nombres canónicos implicados, en el orden en que el catálogo los declara. */
  canonicalNames: string[];
};

export type SubindustryIdentityCollisionAudit = {
  canonicalCount: number;
  aliasCount: number;
  /** Dos nombres canónicos distintos que normalizan igual. */
  canonicalCollisions: SubindustryIdentityCollision[];
  /** Un alias que normaliza igual que el canónico de OTRA subindustria. */
  aliasCanonicalCollisions: SubindustryIdentityCollision[];
  /** El mismo alias declarado por dos subindustrias distintas. */
  aliasAliasCollisions: SubindustryIdentityCollision[];
  /**
   * Alias que no pueden resolver identidad porque apuntan a más de una
   * subindustria. Unión de las dos clases anteriores, deduplicada.
   */
  ambiguousAliases: string[];
};

/**
 * § 5 — ¿qué etiquetas del catálogo publicado NO pueden identificar una
 * subindustria por sí solas?
 *
 * Read-only y pura. No escoge ganador: una colisión se REPORTA, y el resolver la
 * trata como «no resuelve» (§ 9). Un alias que coincide con el canónico de su
 * PROPIA subindustria no es colisión —es redundancia inofensiva—.
 */
export function auditSubindustryIdentityCollisions(
  catalog: readonly SubindustryCatalogLabels[],
): SubindustryIdentityCollisionAudit {
  const canonicalByNormalized = new Map<string, string[]>();
  for (const entry of catalog) {
    const normalized = normalizeSubindustryIdentity(entry.canonicalName);
    if (normalized === '') continue;
    const bucket = canonicalByNormalized.get(normalized) ?? [];
    bucket.push(entry.canonicalName);
    canonicalByNormalized.set(normalized, bucket);
  }

  const aliasOwners = new Map<string, string[]>();
  let aliasCount = 0;
  for (const entry of catalog) {
    const seenForEntry = new Set<string>();
    for (const alias of entry.aliases) {
      aliasCount += 1;
      const normalized = normalizeSubindustryIdentity(alias);
      if (normalized === '' || seenForEntry.has(normalized)) continue;
      seenForEntry.add(normalized);
      const bucket = aliasOwners.get(normalized) ?? [];
      bucket.push(entry.canonicalName);
      aliasOwners.set(normalized, bucket);
    }
  }

  const canonicalCollisions: SubindustryIdentityCollision[] = [];
  for (const [normalized, names] of canonicalByNormalized) {
    if (names.length > 1) canonicalCollisions.push({ normalized, canonicalNames: names });
  }

  const aliasCanonicalCollisions: SubindustryIdentityCollision[] = [];
  const aliasAliasCollisions: SubindustryIdentityCollision[] = [];
  for (const [normalized, owners] of aliasOwners) {
    if (owners.length > 1) {
      aliasAliasCollisions.push({ normalized, canonicalNames: owners });
    }
    const canonicalOwners = canonicalByNormalized.get(normalized) ?? [];
    const foreignCanonical = canonicalOwners.filter((name) => !owners.includes(name));
    if (foreignCanonical.length > 0) {
      aliasCanonicalCollisions.push({
        normalized,
        canonicalNames: [...owners, ...foreignCanonical],
      });
    }
  }

  const ambiguousAliases = [
    ...new Set([
      ...aliasAliasCollisions.map((collision) => collision.normalized),
      ...aliasCanonicalCollisions.map((collision) => collision.normalized),
    ]),
  ].sort();

  return {
    canonicalCount: catalog.length,
    aliasCount,
    canonicalCollisions,
    aliasCanonicalCollisions,
    aliasAliasCollisions,
    ambiguousAliases,
  };
}

// ─── Interfaz para Phase 2B (§ 11) ────────────────────────────────────────────

/**
 * § 11 — lo que un resolver ESTABLE debería recibir cuando Phase 2B conecte los
 * alias del catálogo publicado. Documentación ejecutable, no un consumidor: no
 * hay loader, no hay esquema nuevo y no se leen reglas de precisión en runtime.
 *
 * Por qué no se conecta aquí (§ 4): los 127 alias del catálogo viven en
 * `subindustry_aliases`, se publican con un `catalog_version_id` y pueden cambiar
 * sin despliegue. La precisión, en cambio, recibe hoy una etiqueta de texto y
 * nada más: no sabe qué versión resolvió la selección del wizard. Conectar los
 * alias sin esa versión crearía una segunda fuente de verdad —exactamente lo que
 * el CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM eliminó del lado de discovery— y un
 * snapshot estático duplicado, que está prohibido.
 *
 * Y no es gratis: `Banca Tradicional` declara los alias `banco` y `bank`, y
 * `Fintech: Infraestructura y Pagos` declara `fintech`. Admitirlos como identidad
 * es admitir etiquetas de una sola palabra genérica, que es la clase de entrada
 * que esta fase acaba de dejar fuera. La decisión de cuáles se promueven es de
 * Phase 2B y debe tomarse alias por alias, con la auditoría de colisiones del
 * § 5 delante.
 */
export type SubindustryPrecisionPhase2BInput = {
  /** `public.subindustries.id` — la identidad fuerte. */
  subindustryId: string | null;
  canonicalName: string;
  /** Alias APROBADOS uno a uno, no el volcado completo del catálogo. */
  explicitAliases: readonly string[];
  /** Versión publicada que resolvió la selección. Sin ella no hay alias runtime. */
  catalogVersionId: string | null;
};
