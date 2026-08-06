/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — captura de LinkedIn empresarial y número de
 * empleados desde el payload de Apollo.
 *
 * Puro: sin fetch, sin env, sin Supabase, sin reloj propio (el `observedAt` se
 * inyecta). Recibe el `WebSearchResult` que el provider ya construyó.
 *
 * Por qué existe:
 *   Apollo devolvía `linkedin_url` en el 100% de los resultados de búsqueda y
 *   `estimated_num_employees` en cada `organization_enrichment` pagado, pero
 *   ninguno de los dos llegaba al candidato: `buildProspectingPipelineCandidate`
 *   no tenía campo donde ponerlos. El writer, al no recibirlos, escribía
 *   `linkedin_enrichment.status = 'not_found'` con el aviso «No LinkedIn company
 *   URL available in current evidence» — es decir, reportaba una AUSENCIA DEL
 *   PROVEEDOR cuando lo que había ocurrido era una PÉRDIDA INTERNA. Este módulo
 *   existe para que esas dos cosas no puedan volver a confundirse: cada campo
 *   sale de aquí con un estado explícito y con su procedencia.
 *
 * Contrato:
 *   - `not_returned`   → el proveedor no lo devolvió. Ausencia legítima.
 *   - `invalid`        → el proveedor devolvió algo que no pasa validación
 *                        (perfil personal de LinkedIn, cero empleados, …).
 *   - `mapping_failed` → el payload tenía una forma que rompió la lectura.
 *                        Nunca se disfraza de ausencia.
 *   - `confirmed`      → valor válido, con proveedor, operación y observed_at.
 *
 * `null` NUNCA se convierte en cero y un valor confirmado NUNCA se sobrescribe
 * con una ausencia posterior.
 */

import { normalizeLinkedInCompanyUrl } from './linkedin-company-enrichment';

// ─── Contrato de completitud (§ 4 del addendum) ───────────────────────────────

export type CompanyFieldMappingStatus =
  | 'confirmed'
  | 'not_returned'
  | 'invalid'
  | 'mapping_failed';

/** Operación de Apollo que aportó el valor. */
export type ApolloCompanyFieldOperation = 'organizations_search' | 'organization_enrichment';

export type CompanyLinkedInCapture = {
  /** URL canónica `https://www.linkedin.com/company/<slug>`. Null salvo `confirmed`. */
  companyLinkedInUrl: string | null;
  status: CompanyFieldMappingStatus;
  sourceProvider: 'apollo' | null;
  sourceOperation: ApolloCompanyFieldOperation | null;
  observedAt: string | null;
  /** Valor crudo tal como llegó, sólo para diagnóstico. */
  rawValue: string | null;
  /** Motivo legible cuando el estado no es `confirmed`. */
  reason: string | null;
};

export type EmployeeCountCapture = {
  employeeCount: number | null;
  status: CompanyFieldMappingStatus;
  sourceProvider: 'apollo' | null;
  sourceOperation: ApolloCompanyFieldOperation | null;
  observedAt: string | null;
  rawValue: string | number | null;
  reason: string | null;
};

export type ApolloCompanyFieldsCapture = {
  linkedin: CompanyLinkedInCapture;
  employeeCount: EmployeeCountCapture;
};

// ─── Guardrails de validación ─────────────────────────────────────────────────

/**
 * Un conteo de empleados por debajo de 1 no es un dato de tamaño: es un cero
 * defensivo del proveedor o un campo sin poblar. Se marca `invalid`, no `0`.
 */
export const MIN_VALID_EMPLOYEE_COUNT = 1;

/**
 * Techo de cordura. Walmart —el empleador privado más grande del mundo— ronda
 * los 2,1 M. Cinco millones deja margen de sobra para cualquier organización
 * real y sigue atrapando un payload corrupto.
 */
export const MAX_VALID_EMPLOYEE_COUNT = 5_000_000;

/** Claves del payload de Apollo que aportan cada campo. */
const LINKEDIN_FIELD_KEYS = ['linkedin_url'] as const;
const EMPLOYEE_COUNT_FIELD_KEYS = ['estimated_num_employees', 'employee_count'] as const;

// ─── Lectura defensiva del payload ────────────────────────────────────────────

type MetadataBag = Record<string, unknown>;

function readMetadata(result: unknown): MetadataBag | null {
  if (!result || typeof result !== 'object') return null;
  const metadata = (result as MetadataBag)['metadata'];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as MetadataBag;
}

function readApolloProfile(metadata: MetadataBag): MetadataBag | null {
  const profile = metadata['apollo_profile'];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return profile as MetadataBag;
}

/**
 * Campos que el cascade de enrichment añadió a `apollo_profile` en esta corrida.
 *
 * Es la única fuente honesta de la operación de procedencia: el cascade sólo
 * rellena lo que la búsqueda dejó vacío, así que «el campo está en la lista»
 * significa exactamente «lo aportó el enrichment».
 */
function readEnrichmentFieldsAdded(metadata: MetadataBag): ReadonlySet<string> {
  const raw = metadata['apollo_enrichment_fields_added'];
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim()) out.add(entry.trim());
  }
  return out;
}

function resolveSourceOperation(
  metadata: MetadataBag,
  fieldKeys: readonly string[],
): ApolloCompanyFieldOperation {
  const fieldsAdded = readEnrichmentFieldsAdded(metadata);
  return fieldKeys.some((key) => fieldsAdded.has(key))
    ? 'organization_enrichment'
    : 'organizations_search';
}

/** Primer valor no vacío entre varias rutas del payload. */
function firstPresent(
  bags: readonly (MetadataBag | null)[],
  keys: readonly string[],
): unknown {
  for (const bag of bags) {
    if (!bag) continue;
    for (const key of keys) {
      const value = bag[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      return value;
    }
  }
  return undefined;
}

// ─── Captura de LinkedIn empresarial (§ 2 del addendum) ───────────────────────

function notReturnedLinkedIn(): CompanyLinkedInCapture {
  return {
    companyLinkedInUrl: null,
    status: 'not_returned',
    sourceProvider: null,
    sourceOperation: null,
    observedAt: null,
    rawValue: null,
    reason: 'apollo_did_not_return_company_linkedin_url',
  };
}

/**
 * Captura el LinkedIn empresarial del payload de Apollo.
 *
 * Acepta sólo páginas de empresa: `normalizeLinkedInCompanyUrl` rechaza `/in/`,
 * `/pub/`, `/school/` y cualquier host que no sea linkedin.com, y canoniza
 * protocolo y dominio (`http://www.linkedin.com/company/x` →
 * `https://www.linkedin.com/company/x`).
 */
export function captureApolloCompanyLinkedIn(
  result: unknown,
  observedAt: string,
): CompanyLinkedInCapture {
  let metadata: MetadataBag | null;
  let raw: unknown;

  try {
    metadata = readMetadata(result);
    if (!metadata) return notReturnedLinkedIn();
    raw = firstPresent([readApolloProfile(metadata), metadata], LINKEDIN_FIELD_KEYS);
  } catch (error) {
    return {
      companyLinkedInUrl: null,
      status: 'mapping_failed',
      sourceProvider: 'apollo',
      sourceOperation: null,
      observedAt,
      rawValue: null,
      reason: `linkedin_read_failed: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }

  if (raw === undefined) return notReturnedLinkedIn();

  if (typeof raw !== 'string') {
    return {
      companyLinkedInUrl: null,
      status: 'invalid',
      sourceProvider: 'apollo',
      sourceOperation: resolveSourceOperation(metadata, LINKEDIN_FIELD_KEYS),
      observedAt,
      rawValue: null,
      reason: `linkedin_url_not_a_string: ${typeof raw}`,
    };
  }

  const normalized = normalizeLinkedInCompanyUrl(raw);
  if (normalized.rejected || !normalized.normalized) {
    return {
      companyLinkedInUrl: null,
      status: 'invalid',
      sourceProvider: 'apollo',
      sourceOperation: resolveSourceOperation(metadata, LINKEDIN_FIELD_KEYS),
      observedAt,
      rawValue: raw,
      reason: `linkedin_url_rejected: ${normalized.rejectReason ?? 'unknown'}`,
    };
  }

  return {
    companyLinkedInUrl: normalized.normalized,
    status: 'confirmed',
    sourceProvider: 'apollo',
    sourceOperation: resolveSourceOperation(metadata, LINKEDIN_FIELD_KEYS),
    observedAt,
    rawValue: raw,
    reason: null,
  };
}

// ─── Captura del número de empleados (§ 3 del addendum) ───────────────────────

function notReturnedEmployeeCount(): EmployeeCountCapture {
  return {
    employeeCount: null,
    status: 'not_returned',
    sourceProvider: null,
    sourceOperation: null,
    observedAt: null,
    rawValue: null,
    reason: 'apollo_did_not_return_employee_count',
  };
}

/**
 * Convierte el valor crudo a entero. Un string numérico se acepta; cualquier
 * otra cosa es `invalid`, nunca cero.
 */
function toEmployeeInteger(raw: string | number): { value: number | null; reason: string | null } {
  const numeric = typeof raw === 'number' ? raw : Number(raw.trim());

  if (!Number.isFinite(numeric)) return { value: null, reason: 'employee_count_not_numeric' };
  if (!Number.isInteger(numeric)) return { value: null, reason: 'employee_count_not_an_integer' };
  if (numeric < MIN_VALID_EMPLOYEE_COUNT) {
    return { value: null, reason: `employee_count_below_minimum_${MIN_VALID_EMPLOYEE_COUNT}` };
  }
  if (numeric > MAX_VALID_EMPLOYEE_COUNT) {
    return { value: null, reason: `employee_count_above_maximum_${MAX_VALID_EMPLOYEE_COUNT}` };
  }

  return { value: numeric, reason: null };
}

/** Captura el número de empleados del payload de Apollo. */
export function captureApolloEmployeeCount(
  result: unknown,
  observedAt: string,
): EmployeeCountCapture {
  let metadata: MetadataBag | null;
  let raw: unknown;

  try {
    metadata = readMetadata(result);
    if (!metadata) return notReturnedEmployeeCount();
    raw = firstPresent([readApolloProfile(metadata), metadata], EMPLOYEE_COUNT_FIELD_KEYS);
  } catch (error) {
    return {
      employeeCount: null,
      status: 'mapping_failed',
      sourceProvider: 'apollo',
      sourceOperation: null,
      observedAt,
      rawValue: null,
      reason: `employee_count_read_failed: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }

  if (raw === undefined) return notReturnedEmployeeCount();

  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return {
      employeeCount: null,
      status: 'invalid',
      sourceProvider: 'apollo',
      sourceOperation: resolveSourceOperation(metadata, EMPLOYEE_COUNT_FIELD_KEYS),
      observedAt,
      rawValue: null,
      reason: `employee_count_unexpected_type: ${typeof raw}`,
    };
  }

  const parsed = toEmployeeInteger(raw);
  const sourceOperation = resolveSourceOperation(metadata, EMPLOYEE_COUNT_FIELD_KEYS);

  if (parsed.value === null) {
    return {
      employeeCount: null,
      status: 'invalid',
      sourceProvider: 'apollo',
      sourceOperation,
      observedAt,
      rawValue: raw,
      reason: parsed.reason,
    };
  }

  return {
    employeeCount: parsed.value,
    status: 'confirmed',
    sourceProvider: 'apollo',
    sourceOperation,
    observedAt,
    rawValue: raw,
    reason: null,
  };
}

/** Captura ambos campos de una sola lectura del payload. */
export function captureApolloCompanyFields(
  result: unknown,
  observedAt: string,
): ApolloCompanyFieldsCapture {
  return {
    linkedin: captureApolloCompanyLinkedIn(result, observedAt),
    employeeCount: captureApolloEmployeeCount(result, observedAt),
  };
}

// ─── Fusión entre observaciones (búsqueda → enrichment) ───────────────────────

/**
 * Fusiona dos observaciones del LinkedIn empresarial.
 *
 * Regla dura: un valor confirmado NUNCA se pierde. Si la observación previa
 * está confirmada, ninguna ausencia, invalidez ni fallo posterior la borra —
 * ése es exactamente el defecto que este módulo cierra. Entre dos confirmadas
 * gana la primera: la procedencia original es la verdadera.
 */
export function mergeCompanyLinkedInCapture(
  existing: CompanyLinkedInCapture | null | undefined,
  incoming: CompanyLinkedInCapture,
): CompanyLinkedInCapture {
  if (!existing) return incoming;
  if (existing.status === 'confirmed') return existing;
  if (incoming.status === 'confirmed') return incoming;

  // Ninguna confirmada: `invalid` y `mapping_failed` describen algo que sí pasó
  // y pesan más que una ausencia.
  if (existing.status === 'not_returned' && incoming.status !== 'not_returned') return incoming;
  return existing;
}

/**
 * Fusiona dos observaciones del número de empleados.
 *
 * Entre dos confirmadas gana la del `organization_enrichment`: es la operación
 * que se pagó precisamente para obtener el perfil completo. Nunca se degrada un
 * valor confirmado a null, ni se sustituye por otro sin procedencia.
 */
export function mergeEmployeeCountCapture(
  existing: EmployeeCountCapture | null | undefined,
  incoming: EmployeeCountCapture,
): EmployeeCountCapture {
  if (!existing) return incoming;

  if (existing.status === 'confirmed' && incoming.status === 'confirmed') {
    const incomingIsEnrichment = incoming.sourceOperation === 'organization_enrichment';
    const existingIsEnrichment = existing.sourceOperation === 'organization_enrichment';
    if (incomingIsEnrichment && !existingIsEnrichment) return incoming;
    return existing;
  }

  if (existing.status === 'confirmed') return existing;
  if (incoming.status === 'confirmed') return incoming;

  if (existing.status === 'not_returned' && incoming.status !== 'not_returned') return incoming;
  return existing;
}

// ─── Serialización a metadata persistible (§ 2 y § 3 del addendum) ────────────

/**
 * Bloque de metadata del LinkedIn empresarial, con los nombres de señal que el
 * contrato exige. `prospect_candidates` no tiene columnas de procedencia, así
 * que la procedencia vive aquí, estructurada.
 */
export type CompanyLinkedInMetadataBlock = {
  company_linkedin_url: string | null;
  linkedin_status: CompanyFieldMappingStatus;
  linkedin_source_provider: 'apollo' | null;
  linkedin_source_operation: ApolloCompanyFieldOperation | null;
  linkedin_observed_at: string | null;
  linkedin_mapping_status: CompanyFieldMappingStatus;
  linkedin_mapping_reason: string | null;
};

export type CompanyEmployeeCountMetadataBlock = {
  employee_count: number | null;
  employee_count_status: CompanyFieldMappingStatus;
  employee_count_source: 'apollo' | null;
  employee_count_source_operation: ApolloCompanyFieldOperation | null;
  employee_count_observed_at: string | null;
  employee_count_mapping_reason: string | null;
};

export function toCompanyLinkedInMetadataBlock(
  capture: CompanyLinkedInCapture,
): CompanyLinkedInMetadataBlock {
  return {
    company_linkedin_url: capture.companyLinkedInUrl,
    linkedin_status: capture.status,
    linkedin_source_provider: capture.sourceProvider,
    linkedin_source_operation: capture.sourceOperation,
    linkedin_observed_at: capture.observedAt,
    linkedin_mapping_status: capture.status,
    linkedin_mapping_reason: capture.reason,
  };
}

export function toCompanyEmployeeCountMetadataBlock(
  capture: EmployeeCountCapture,
): CompanyEmployeeCountMetadataBlock {
  return {
    employee_count: capture.employeeCount,
    employee_count_status: capture.status,
    employee_count_source: capture.sourceProvider,
    employee_count_source_operation: capture.sourceOperation,
    employee_count_observed_at: capture.observedAt,
    employee_count_mapping_reason: capture.reason,
  };
}

// ─── § G · trazabilidad por campo ─────────────────────────────────────────────

/**
 * Dónde se guardó finalmente el valor.
 *
 * `column` es el único estado que una QA puede certificar. `metadata_only`
 * existe para el despliegue gradual —la columna aún no está en ese entorno— y
 * `not_persisted` para cuando no había valor que guardar.
 */
export type CompanyFieldPersistenceMode = 'column' | 'metadata_only' | 'not_persisted';

/**
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § G — las cinco etapas por las
 * que pasa un campo, cada una con su respuesta de sí o no.
 *
 * Existe porque «el campo no está» tenía cinco causas posibles y ninguna forma
 * de distinguirlas: el proveedor no lo devolvió, llegó con un valor inválido, el
 * mapeo lo perdió, el writer no lo recibió, o se guardó y la UI no lo pinta. Con
 * la traza, cada una se lee directamente.
 */
export type CompanyFieldTrace = {
  returned_by_provider: boolean;
  normalized: boolean;
  sent_to_writer: boolean;
  persisted: boolean;
  displayed: boolean;
  source_provider: 'apollo' | null;
  source_operation: ApolloCompanyFieldOperation | null;
  /** `usage_key` de la operación que lo trajo. `null` si no hubo operación pagada. */
  source_request_id: string | null;
  observed_at: string | null;
  mapping_status: CompanyFieldMappingStatus;
  persistence_mode: CompanyFieldPersistenceMode;
};

function traceFor(
  capture: { status: CompanyFieldMappingStatus; sourceProvider: 'apollo' | null;
    sourceOperation: ApolloCompanyFieldOperation | null; observedAt: string | null },
  hasValue: boolean,
  options: { sourceRequestId: string | null; persistenceMode: CompanyFieldPersistenceMode },
): CompanyFieldTrace {
  // `not_returned` es lo único que afirma que el proveedor no lo entregó. Un
  // `invalid` o un `mapping_failed` SÍ llegaron: se perdieron después, y
  // reportarlos como ausencia del proveedor es justo el error que esto cierra.
  const returnedByProvider = capture.status !== 'not_returned';
  return {
    returned_by_provider: returnedByProvider,
    normalized: capture.status === 'confirmed',
    sent_to_writer: hasValue,
    persisted: options.persistenceMode !== 'not_persisted',
    // Se pinta lo que se guardó; los demás estados tienen su propio mensaje.
    displayed: options.persistenceMode !== 'not_persisted',
    source_provider: capture.sourceProvider,
    source_operation: capture.sourceOperation,
    source_request_id: options.sourceRequestId,
    observed_at: capture.observedAt,
    mapping_status: capture.status,
    persistence_mode: options.persistenceMode,
  };
}

export function buildCompanyLinkedInTrace(
  capture: CompanyLinkedInCapture,
  options: { sourceRequestId: string | null; persistenceMode: CompanyFieldPersistenceMode },
): CompanyFieldTrace {
  return traceFor(capture, capture.companyLinkedInUrl !== null, options);
}

export function buildEmployeeCountTrace(
  capture: EmployeeCountCapture,
  options: { sourceRequestId: string | null; persistenceMode: CompanyFieldPersistenceMode },
): CompanyFieldTrace {
  return traceFor(capture, capture.employeeCount !== null, options);
}
