import { fetchSocrataDatasetSample } from '@/server/source-catalog/connectors/socrata-colombia/socrata-client';
import { normalizeRuesRecord } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import { getSourceConnectionRecord } from '@/modules/source-catalog/queries';

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

export interface TaxIdentifierProvider {
  key: string;
  country_code: string;
  display_name: string;
  is_configured: boolean;
  lookup(input: TaxIdentifierProviderInput): Promise<TaxIdentifierProviderResult[]>;
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

/**
 * Verifica si el proveedor oficial de Colombia está configurado y habilitado.
 */
export async function checkIsColombiaProviderConfigured(): Promise<boolean> {
  if (process.env.COLOMBIA_TAX_PROVIDER_ENABLED === 'true') {
    return true;
  }
  try {
    const connection = await getSourceConnectionRecord('socrata_colombia');
    return connection?.connection_status === 'connected';
  } catch {
    return false;
  }
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

  async lookup(input: TaxIdentifierProviderInput): Promise<TaxIdentifierProviderResult[]> {
    const isConfigured = await checkIsColombiaProviderConfigured();
    if (!isConfigured) {
      return [];
    }

    const companyName = input.company_name || input.legal_name || '';
    const cleanName = cleanCompanyNameForLookup(companyName);
    if (cleanName.length < 3) {
      return [];
    }

    // SoQL Query: evitar personas naturales y hacer match case-insensitive de razón social
    const where = `organizacion_juridica IS NOT NULL AND organizacion_juridica != 'PERSONA NATURAL' AND upper(razon_social) like '%${cleanName}%'`;

    const response = await fetchSocrataDatasetSample({
      dataset: 'rues',
      limit: 10,
      where,
    });

    if (!response.ok) {
      throw new Error(response.error || 'Fallo de conexión técnica con datos.gov.co');
    }

    if (!response.records) {
      throw new Error('Fallo de conexión técnica con datos.gov.co: no se devolvieron registros');
    }

    const rawRecords = response.records as Record<string, unknown>[];
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
        score += 10;
        matchReason = 'Coincidencia difusa de razón social.';
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
        source_type: 'public_registry',
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
