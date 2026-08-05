/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — presentación de LinkedIn empresarial y número
 * de empleados en el detalle del candidato.
 *
 * Puro: sólo lee metadata, no inventa valores ni llama a nada.
 *
 * Por qué existe:
 *   La UI mostraba «Sin LinkedIn» y «Sin dato» para todos los casos. Con eso, un
 *   candidato al que Apollo nunca le devolvió el dato y otro cuyo dato SÍ llegó y
 *   se perdió por dentro se veían exactamente igual, y no había forma de saber
 *   cuál de los dos problemas había que arreglar. Cada estado tiene su mensaje.
 */

type MetadataBag = Record<string, unknown>;

export type CompanyFieldDisplayKind =
  /** Hay valor y se muestra. */
  | 'value'
  /** El proveedor no lo devolvió: ausencia legítima. */
  | 'not_returned'
  /** El proveedor devolvió algo que no pasó validación. */
  | 'invalid'
  /** Llegó del proveedor y se perdió por dentro (mapeo o persistencia). */
  | 'internal_loss'
  /** Este candidato no viene de una ruta con contrato de campos del proveedor. */
  | 'unknown';

export type LinkedInFieldDisplay = {
  kind: CompanyFieldDisplayKind;
  /** URL canónica cuando `kind === 'value'`. */
  url: string | null;
  message: string | null;
  /** Etiqueta de procedencia («Fuente: Apollo · búsqueda»), cuando se conoce. */
  sourceLabel: string | null;
};

export type EmployeeCountFieldDisplay = {
  kind: CompanyFieldDisplayKind;
  value: number | null;
  message: string | null;
  sourceLabel: string | null;
};

const OPERATION_LABELS: Record<string, string> = {
  organizations_search: 'búsqueda de empresas',
  organization_enrichment: 'enriquecimiento de empresa',
};

function readBag(metadata: unknown, key: string): MetadataBag | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const block = (metadata as MetadataBag)[key];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return block as MetadataBag;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function buildSourceLabel(provider: unknown, operation: unknown): string | null {
  const providerName = readString(provider);
  if (!providerName) return null;
  const displayProvider = providerName === 'apollo' ? 'Apollo' : providerName;
  const operationKey = readString(operation);
  const operationLabel = operationKey ? OPERATION_LABELS[operationKey] : null;
  return operationLabel
    ? `Fuente: ${displayProvider} · ${operationLabel}`
    : `Fuente: ${displayProvider}`;
}

/**
 * Estado del LinkedIn empresarial para el detalle del candidato.
 *
 * `persistedUrl` es la URL que la fila ya tiene (columna `linkedin_url` o
 * cualquiera de las rutas de enriquecimiento): si existe, se muestra, porque el
 * dato está. La distinción de estados sólo gobierna el mensaje cuando NO hay URL.
 */
export function resolveLinkedInFieldDisplay(
  metadata: unknown,
  persistedUrl: string | null,
): LinkedInFieldDisplay {
  const block = readBag(metadata, 'company_linkedin');
  const sourceLabel = block
    ? buildSourceLabel(block['linkedin_source_provider'], block['linkedin_source_operation'])
    : null;

  if (persistedUrl) {
    return { kind: 'value', url: persistedUrl, message: null, sourceLabel };
  }

  const status = block ? readString(block['linkedin_status']) : null;

  if (status === 'confirmed') {
    // El mapeo confirmó una URL y, aun así, no hay nada que mostrar: el valor se
    // perdió entre el mapeo y la fila. NO es una ausencia del proveedor.
    return {
      kind: 'internal_loss',
      url: null,
      message: 'No se pudo guardar el LinkedIn obtenido',
      sourceLabel,
    };
  }

  if (status === 'not_returned') {
    return {
      kind: 'not_returned',
      url: null,
      message: 'Apollo no devolvió LinkedIn empresarial',
      sourceLabel: null,
    };
  }

  if (status === 'invalid') {
    return {
      kind: 'invalid',
      url: null,
      message: 'Apollo devolvió un LinkedIn que no es de empresa',
      sourceLabel,
    };
  }

  if (status === 'mapping_failed') {
    return {
      kind: 'internal_loss',
      url: null,
      message: 'No se pudo guardar el LinkedIn obtenido',
      sourceLabel,
    };
  }

  return { kind: 'unknown', url: null, message: null, sourceLabel: null };
}

/**
 * Estado del número de empleados para el detalle del candidato.
 *
 * `persistedValue` es el valor de la columna `employee_count`.
 */
export function resolveEmployeeCountFieldDisplay(
  metadata: unknown,
  persistedValue: number | string | null,
): EmployeeCountFieldDisplay {
  const block = readBag(metadata, 'company_employee_count');
  const sourceLabel = block
    ? buildSourceLabel(
        block['employee_count_source'],
        block['employee_count_source_operation'],
      )
    : null;

  const numericValue =
    typeof persistedValue === 'number'
      ? persistedValue
      : typeof persistedValue === 'string' && persistedValue.trim() !== ''
        ? Number(persistedValue)
        : null;

  if (numericValue !== null && Number.isFinite(numericValue) && numericValue > 0) {
    return { kind: 'value', value: numericValue, message: null, sourceLabel };
  }

  const status = block ? readString(block['employee_count_status']) : null;

  if (status === 'confirmed') {
    const mapped = block?.['employee_count'];
    if (typeof mapped === 'number' && Number.isFinite(mapped) && mapped > 0) {
      // El mapeo tiene el número pero la columna no: pérdida interna, y el valor
      // observado se muestra igual para no esconder lo que el proveedor dio.
      return {
        kind: 'internal_loss',
        value: mapped,
        message: 'No se pudo guardar el número de empleados obtenido',
        sourceLabel,
      };
    }
    return {
      kind: 'internal_loss',
      value: null,
      message: 'No se pudo guardar el número de empleados obtenido',
      sourceLabel,
    };
  }

  if (status === 'not_returned') {
    return {
      kind: 'not_returned',
      value: null,
      message: 'Apollo no devolvió el número de empleados',
      sourceLabel: null,
    };
  }

  if (status === 'invalid') {
    return {
      kind: 'invalid',
      value: null,
      message: 'Apollo devolvió un número de empleados no válido',
      sourceLabel,
    };
  }

  if (status === 'mapping_failed') {
    return {
      kind: 'internal_loss',
      value: null,
      message: 'No se pudo mapear el número de empleados',
      sourceLabel,
    };
  }

  return { kind: 'unknown', value: null, message: null, sourceLabel: null };
}
