import { fetchSocrataDatasetSample } from '@/server/source-catalog/connectors/socrata-colombia/socrata-client';
import { normalizeRuesRecord } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import { getSourceConnectionRecord, SourceConnectionRecord } from '@/modules/source-catalog/queries';

export interface TaxIdentifierProviderResult {
  tax_identifier: string;
  normalized_tax_identifier: string;
  legal_name?: string;
  source_name: string;
  source_type: 'official' | 'public_registry' | 'government_dataset' | 'hubspot' | 'internal_metadata';
  source_url?: string;
  evidence_text?: string;
  confidence: 'high' | 'medium' | 'low';
  match_reason: string;
  risks: string[];
  requires_human_review: true;
}

export interface TaxIdentifierProviderInput {
  company_name: string | null;
  legal_name: string | null;
  website: string | null;
  domain: string | null;
  city: string | null;
  country_code: string;
}

export interface SocrataDebugInfo {
  socrata_availability: {
    available: boolean;
    source_key: string;
    connection_status: string;
    enabled_by: 'source_catalog_connections' | 'env' | 'none';
  };
  socrata_request: {
    dataset_id: string;
    base_url: string;
    query_mode: string;
    company_name: string;
    normalized_company_name: string;
  };
  socrata_response: {
    ok: boolean;
    status: number | null;
    records_count: number;
    error_kind: 'config_missing' | 'empty_query' | 'network_error' | 'http_error' | 'no_records' | 'dataset_missing_nit' | null;
    safe_error_message: string | null;
  };
}

export interface TaxIdentifierProvider {
  key: string;
  country_code: string;
  display_name: string;
  is_configured: boolean;
  lookup(
    input: TaxIdentifierProviderInput,
    context?: { debug?: SocrataDebugInfo }
  ): Promise<TaxIdentifierProviderResult[]>;
}

/**
 * Normaliza y limpia el nombre de una empresa para realizar búsquedas en el registro oficial.
 * Quita acentos, puntuaciones y sufijos societarios comunes (S.A.S., S.A., LTDA, etc.).
 */
export function cleanCompanyNameForLookup(name: string): string {
  if (!name) return '';
  let upper = name
    .toUpperCase()
    // Remover acentos
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Normalizar abreviaciones con espacios intermedios (ej: S. A. S. -> SAS, S A S -> SAS)
  upper = upper
    .replace(/\bS\s*\.\s*A\s*\.\s*S\s*\.?\b/g, 'SAS')
    .replace(/\bS\s*A\s*S\b/g, 'SAS')
    .replace(/\bS\s*\.\s*A\s*\.?\b/g, 'SA')
    .replace(/\bS\s*A\b/g, 'SA')
    .replace(/\bL\s*T\s*D\s*A\b/g, 'LTDA');

  return upper
    .replace(/\b(SAS|SA|LTDA|LIMITADA|E\.?U\.?|S\.?E\.?N\.?C\.?)\b/g, '')
    // Remover puntuaciones
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    // Reemplazar múltiples espacios con uno solo
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula el Dígito de Verificación (DV) oficial para un NIT de Colombia.
 * Implementa el algoritmo de ponderación con módulo 11.
 */
export function calculateColombianCheckDigit(nitStr: string): number {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  const len = nitStr.length;
  for (let i = 0; i < len; i++) {
    const digit = parseInt(nitStr.charAt(len - 1 - i), 10);
    if (!isNaN(digit)) {
      sum += digit * weights[i];
    }
  }
  const remainder = sum % 11;
  if (remainder === 0 || remainder === 1) {
    return remainder;
  }
  return 11 - remainder;
}

/**
 * Valida un NIT colombiano y verifica su Dígito de Verificación si está presente.
 */
export function validateColombianNit(value: string): {
  normalized: string;
  has_check_digit: boolean;
  check_digit_valid: boolean | null;
} {
  // Limpiar puntos y espacios
  const cleaned = value.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
  const parts = cleaned.split('-');
  const nitStr = parts[0];
  const dvStr = parts[1] ?? '';

  const isOnlyDigits = (str: string) => /^\d+$/.test(str);

  if (!isOnlyDigits(nitStr)) {
    return {
      normalized: cleaned,
      has_check_digit: false,
      check_digit_valid: null,
    };
  }

  const hasCheckDigit = dvStr.length > 0 && isOnlyDigits(dvStr);
  let checkDigitValid: boolean | null = null;

  if (hasCheckDigit) {
    const calculatedDv = calculateColombianCheckDigit(nitStr);
    checkDigitValid = parseInt(dvStr, 10) === calculatedDv;
  }

  return {
    normalized: cleaned,
    has_check_digit: hasCheckDigit,
    check_digit_valid: checkDigitValid,
  };
}

export interface SocrataAvailabilityResult {
  available: boolean;
  source_key: string;
  connection_status: string;
  enabled_by: 'source_catalog_connections' | 'env' | 'none';
}

/**
 * Helper unificado para determinar si Socrata Colombia (datos.gov.co) está disponible.
 * Sigue reglas estrictas de prioridad y estados válidos.
 */
export async function checkSocrataColombiaAvailability(): Promise<SocrataAvailabilityResult> {
  const aliases = [
    'socrata_colombia',
    'colombia_socrata',
    'datos_gov_colombia',
    'datos_gov_co',
    'rues_colombia',
    'co_rues'
  ];

  let dbConnection: SourceConnectionRecord | null = null;
  let resolvedKey = 'socrata_colombia';

  // 1. Intentar buscar en DB primero
  for (const key of aliases) {
    try {
      const connection = await getSourceConnectionRecord(key);
      if (connection) {
        dbConnection = connection;
        resolvedKey = connection.source_key || key;
        break;
      }
    } catch (err) {
      console.error(`Error querying availability for alias ${key}:`, err);
    }
  }

  const isProd = process.env.NODE_ENV === 'production';

  // Si se encontró en la DB:
  if (dbConnection) {
    const status = dbConnection.connection_status;
    const isAvailableStatus = status === 'connected' || status === 'not_applicable';

    // Prioridad en producción: DB manda sobre ENV
    if (isProd) {
      if (isAvailableStatus) {
        return {
          available: true,
          source_key: resolvedKey,
          connection_status: status,
          enabled_by: 'source_catalog_connections',
        };
      } else {
        // En producción: si el estado no es válido (ej: error, disconnected, not_tested), no está disponible
        return {
          available: false,
          source_key: resolvedKey,
          connection_status: status,
          enabled_by: 'source_catalog_connections',
        };
      }
    } else {
      // Fuera de producción (desarrollo/test): la variable de entorno puede forzar disponibilidad
      if (process.env.COLOMBIA_TAX_PROVIDER_ENABLED === 'true') {
        return {
          available: true,
          source_key: resolvedKey,
          connection_status: status === 'connected' || status === 'not_applicable' ? status : `${status} (env_forced)`,
          enabled_by: 'env',
        };
      }

      if (isAvailableStatus) {
        return {
          available: true,
          source_key: resolvedKey,
          connection_status: status,
          enabled_by: 'source_catalog_connections',
        };
      }
    }
  }

  // 2. Si no se encontró en la DB (o si estamos fuera de producción), verificar la env var como fallback
  if (process.env.COLOMBIA_TAX_PROVIDER_ENABLED === 'true') {
    return {
      available: true,
      source_key: 'socrata_colombia',
      connection_status: 'env_forced',
      enabled_by: 'env',
    };
  }

  return {
    available: false,
    source_key: 'socrata_colombia',
    connection_status: dbConnection ? dbConnection.connection_status : 'none',
    enabled_by: 'none',
  };
}

/**
 * Verifica si el proveedor oficial de Colombia está configurado y habilitado.
 */
export async function checkIsColombiaProviderConfigured(): Promise<boolean> {
  const result = await checkSocrataColombiaAvailability();
  return result.available;
}

/**
 * Proveedor de identificadores fiscales oficiales de Colombia utilizando Socrata (datos.gov.co).
 */
export const colombiaOfficialTaxProvider: TaxIdentifierProvider = {
  key: 'colombia_official_registry',
  country_code: 'CO',
  display_name: 'Fuente oficial Colombia',
  get is_configured(): boolean {
    return process.env.COLOMBIA_TAX_PROVIDER_ENABLED === 'true';
  },

  async lookup(
    input: TaxIdentifierProviderInput,
    context?: { debug?: SocrataDebugInfo }
  ): Promise<TaxIdentifierProviderResult[]> {
    const availability = await checkSocrataColombiaAvailability();

    if (context) {
      context.debug = {
        socrata_availability: {
          available: availability.available,
          source_key: availability.source_key,
          connection_status: availability.connection_status,
          enabled_by: availability.enabled_by,
        },
        socrata_request: {
          dataset_id: 'c82u-588k',
          base_url: 'https://www.datos.gov.co/resource/c82u-588k.json',
          query_mode: 'none',
          company_name: input.company_name || input.legal_name || '',
          normalized_company_name: '',
        },
        socrata_response: {
          ok: false,
          status: null,
          records_count: 0,
          error_kind: null,
          safe_error_message: null,
        },
      };
    }

    if (!availability.available) {
      if (context && context.debug) {
        context.debug.socrata_response.error_kind = 'config_missing';
        context.debug.socrata_response.safe_error_message = 'Fuente oficial Colombia no configurada.';
      }
      return [];
    }

    const companyName = input.company_name || input.legal_name || '';
    const cleanName = cleanCompanyNameForLookup(companyName);

    if (context && context.debug) {
      context.debug.socrata_request.normalized_company_name = cleanName;
    }

    if (cleanName.length < 3) {
      if (context && context.debug) {
        context.debug.socrata_response.ok = true;
        context.debug.socrata_response.status = 200;
        context.debug.socrata_response.error_kind = 'empty_query';
        context.debug.socrata_response.safe_error_message = 'Nombre de empresa demasiado corto para búsqueda.';
      }
      return [];
    }

    const baseWhere = `organizacion_juridica IS NOT NULL AND organizacion_juridica != 'PERSONA NATURAL'`;
    let response: Awaited<ReturnType<typeof fetchSocrataDatasetSample>>;
    let queryMode = 'q_search';

    if (context && context.debug) {
      context.debug.socrata_request.query_mode = queryMode;
    }

    try {
      response = await fetchSocrataDatasetSample({
        dataset: 'rues',
        limit: 10,
        q: cleanName,
        where: baseWhere,
      });

      const GENERIC_WORDS = new Set([
        'EMPRESA', 'EMPRESAS', 'COMPANIA', 'COMPAÑIA', 'COMPANIAS', 'COMPAÑIAS',
        'GRUPO', 'HOLDING', 'CORPORACION', 'CORPORACIONES', 'FUNDACION', 'FUNDACIONES',
        'ASOCIACION', 'ASOCIACIONES', 'COLOMBIA', 'COLOMBIANA', 'COLOMBIANAS', 'COLOMBIANO', 'COLOMBIANOS',
        'SERVICIOS', 'SERVICIO', 'PRODUCTOS', 'PRODUCTO', 'SISTEMAS', 'SISTEMA',
        'TECNOLOGIA', 'TECNOLOGIAS', 'INVERSIONES', 'INVERSION', 'NEGOCIOS', 'NEGOCIO',
        'SOLUCIONES', 'SOLUCION', 'INTERNACIONAL', 'INTERNACIONALES', 'GLOBAL', 'GLOBALES',
        'AMERICA', 'LATAM', 'ANDINA', 'ANDINO', 'LTDA', 'LIMITADA', 'SAS', 'SA', 'S.A.S.', 'S.A.',
        'CONSORCIO', 'CONSORCIOS', 'UNION', 'TEMPORAL', 'UNIONES', 'TEMPORALES',
        'COOPERATIVA', 'COOPERATIVAS', 'COOP', 'PROYECTOS', 'PROYECTO', 'DESARROLLOS', 'DESARROLLO',
        'DISTRIBUIDORA', 'DISTRIBUIDORAS', 'COMERCIALIZADORA', 'COMERCIALIZADORAS',
        'REPRESENTACIONES', 'REPRESENTACION', 'IMPORTACIONES', 'IMPORTACION', 'EXPORTACIONES', 'EXPORTACION',
        'LATINOAMERICA', 'LATINOAMERICANA', 'LATINOAMERICANO', 'IBEROAMERICA', 'IBEROAMERICANA', 'IBEROAMERICANO'
      ]);
      const tokens = cleanName.split(' ').filter(t => t.length >= 3 && !GENERIC_WORDS.has(t));
      if (response.ok && (!response.records || response.records.length === 0) && tokens.length > 0) {
        queryMode = 'token_fallback';
        if (context && context.debug) {
          context.debug.socrata_request.query_mode = queryMode;
        }
        const firstToken = tokens[0];
        response = await fetchSocrataDatasetSample({
          dataset: 'rues',
          limit: 10,
          q: firstToken,
          where: baseWhere,
        });

        if (response.ok && (!response.records || response.records.length === 0)) {
          queryMode = 'like_fallback';
          if (context && context.debug) {
            context.debug.socrata_request.query_mode = queryMode;
          }
          response = await fetchSocrataDatasetSample({
            dataset: 'rues',
            limit: 10,
            where: `${baseWhere} AND upper(razon_social) like '%${firstToken}%'`,
          });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error de red';
      if (context && context.debug) {
        context.debug.socrata_response.ok = false;
        context.debug.socrata_response.error_kind = 'network_error';
        context.debug.socrata_response.safe_error_message = errMsg;
      }
      throw err;
    }

    if (context && context.debug) {
      context.debug.socrata_response.ok = response.ok;
      if (!response.ok) {
        const httpStatusMatch = response.error?.match(/HTTP (\d+)/);
        context.debug.socrata_response.status = httpStatusMatch ? parseInt(httpStatusMatch[1]) : null;
        context.debug.socrata_response.error_kind = 'http_error';
        context.debug.socrata_response.safe_error_message = response.error;
      } else {
        context.debug.socrata_response.status = 200;
        context.debug.socrata_response.records_count = response.records?.length || 0;
      }
    }

    if (!response.ok) {
      throw new Error(response.error || 'Fallo de conexión técnica con datos.gov.co');
    }

    if (!response.records || response.records.length === 0) {
      if (context && context.debug) {
        context.debug.socrata_response.error_kind = 'no_records';
        context.debug.socrata_response.safe_error_message = 'No se encontraron registros.';
      }
      return [];
    }

    const rawRecords = response.records as Record<string, unknown>[];

    // Verificar si el dataset expone NIT
    const sampleRecord = rawRecords[0];
    const hasNitField = sampleRecord && ('numero_identificacion' in sampleRecord || 'nit' in sampleRecord);
    if (!hasNitField) {
      if (context && context.debug) {
        context.debug.socrata_response.error_kind = 'dataset_missing_nit';
        context.debug.socrata_response.safe_error_message = 'El dataset disponible no expone NIT.';
      }
      throw new Error('DATASET_MISSING_NIT');
    }

    const candidates: TaxIdentifierProviderResult[] = [];

    for (const record of rawRecords) {
      const normalized = normalizeRuesRecord(record);
      if (!normalized.companyName || !normalized.taxId) {
        continue;
      }

      const recordNameClean = cleanCompanyNameForLookup(normalized.companyName);
      let score = 0;
      let matchReason = '';
      const risks: string[] = ['Dato proveniente de registro oficial público — requiere validación humana.'];

      if (recordNameClean === cleanName) {
        score += 60;
        matchReason = 'Coincidencia exacta de razón social.';
      } else if (recordNameClean.includes(cleanName) || cleanName.includes(recordNameClean)) {
        score += 40;
        matchReason = 'Coincidencia parcial de razón social.';
      } else {
        const cleanTokens = cleanName.split(' ').filter(t => t.length >= 3);
        const recordTokens = recordNameClean.split(' ').filter(t => t.length >= 3);
        const hasCommonToken = cleanTokens.some(t => recordTokens.includes(t));
        if (hasCommonToken) {
          score += 25;
          matchReason = 'Coincidencia parcial por tokens de razón social.';
        } else {
          score += 5;
          matchReason = 'Coincidencia difusa de razón social.';
        }
      }

      // Comparar ubicación (Cámara de Comercio / Ciudad)
      if (input.city && normalized.city) {
        const cleanInputCity = input.city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const cleanRecordCity = normalized.city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (cleanInputCity === cleanRecordCity || cleanRecordCity.includes(cleanInputCity) || cleanInputCity.includes(cleanRecordCity)) {
          score += 30;
          matchReason += ' Coincidencia de ubicación.';
        }
      }

      // Validación del DV
      const validation = validateColombianNit(normalized.taxId);
      if (validation.has_check_digit && validation.check_digit_valid === false) {
        score -= 20;
        risks.push('El dígito de verificación del NIT no coincide con el algoritmo oficial modulo 11.');
      }

      let confidence: 'high' | 'medium' | 'low' = 'low';
      if (score >= 80) {
        confidence = 'high';
      } else if (score >= 50) {
        confidence = 'medium';
      }

      const cleanNit = normalized.taxId.replace(/[\s.]/g, '').replace(/[–—]/g, '-');

      candidates.push({
        tax_identifier: normalized.taxId,
        normalized_tax_identifier: cleanNit,
        legal_name: normalized.companyName,
        source_name: 'RUES / Registro Mercantil Colombia (datos.gov.co)',
        source_type: 'government_dataset',
        source_url: `https://www.datos.gov.co/resource/c82u-588k.json?numero_identificacion=${cleanNit.split('-')[0]}`,
        evidence_text: `Encontrado en RUES de datos.gov.co. Razón Social: ${normalized.companyName}, NIT: ${normalized.taxId}, Estado: ${normalized.legalStatus || 'No registrado'}, Matrícula: ${normalized.rawRecordId || 'No registrada'}, Cámara de Comercio: ${normalized.sourceMetadata?.camara_comercio || 'No registrada'}.`,
        confidence,
        match_reason: matchReason,
        risks,
        requires_human_review: true,
      });
    }

    // Ordenar por confianza (high > medium > low) y devolver máximo 3
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    return candidates
      .sort((a, b) => confidenceOrder[b.confidence] - confidenceOrder[a.confidence])
      .slice(0, 3);
  },
};
