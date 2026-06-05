export type TaxIdentifierRule = {
  countryCode: string;
  label: string;
  placeholder: string;
  helpText: string;
  minLength: number;
  maxLength: number;
  inputMode: 'numeric' | 'text';
  acceptedCharacters: RegExp;
  formatPattern: RegExp;
  validationLevel: 'format_only' | 'checksum';
  normalize: (value: string) => string;
  validateFormat: (value: string) => boolean;
  validateChecksum?: (value: string) => boolean;
  canonicalExample: string;
  ruleVersion: string;
};

// ── Checksum Calculators ──────────────────────────────────────────

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

export function calculateChileCheckDigit(rutBody: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let i = rutBody.length - 1; i >= 0; i--) {
    sum += parseInt(rutBody.charAt(i), 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const rem = sum % 11;
  const calculated = 11 - rem;
  if (calculated === 11) return '0';
  if (calculated === 10) return 'K';
  return calculated.toString();
}

export function calculatePeruCheckDigit(rucBody: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(rucBody.charAt(i), 10) * weights[i];
  }
  const remainder = sum % 11;
  const calculated = 11 - remainder;
  if (calculated === 11) return '1';
  if (calculated === 10) return '0';
  return calculated.toString();
}

export function calculateArgentinaCheckDigit(cuitBody: string): string | null {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cuitBody.charAt(i), 10) * weights[i];
  }
  const remainder = sum % 11;
  const calculated = 11 - remainder;
  if (calculated === 11) return '0';
  if (calculated === 10) return null;
  return calculated.toString();
}

export function calculateCNPJCheckDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += digits[i] * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

// ── Registry of Rules ──────────────────────────────────────────────

export const TAX_IDENTIFIER_RULES: Record<string, TaxIdentifierRule> = {
  CO: {
    countryCode: 'CO',
    label: 'NIT',
    placeholder: 'Ej. 900123456-1',
    helpText: 'Ingrese el NIT con guion y dígito de verificación.',
    minLength: 5,
    maxLength: 20,
    inputMode: 'text',
    acceptedCharacters: /^[\d.\s-]*$/,
    formatPattern: /^\d{5,15}-\d$/,
    validationLevel: 'checksum',
    normalize: (val) => {
      const digits = val.replace(/\D/g, '');
      if (digits.length >= 6 && digits.length <= 16) {
        return digits.slice(0, -1) + '-' + digits.slice(-1);
      }
      return val.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
    },
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
      return /^\d{5,15}-\d$/.test(cleaned);
    },
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
      const parts = cleaned.split('-');
      const nitStr = parts[0];
      const dvStr = parts[1] ?? '';
      if (!nitStr || !dvStr || !/^\d+$/.test(nitStr) || !/^\d+$/.test(dvStr)) return false;
      return parseInt(dvStr, 10) === calculateColombianCheckDigit(nitStr);
    },
    canonicalExample: '900123456-1',
    ruleVersion: 'CO-NIT-v1',
  },
  MX: {
    countryCode: 'MX',
    label: 'RFC',
    placeholder: 'Ej. ABC860101XX1',
    helpText: 'Ingrese el RFC (12 caracteres para personas morales, 13 para personas físicas).',
    minLength: 12,
    maxLength: 13,
    inputMode: 'text',
    acceptedCharacters: /^[a-zA-Z0-9&\s-]*$/,
    formatPattern: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i,
    validationLevel: 'format_only',
    normalize: (val) => val.toUpperCase().replace(/[\s-]/g, ''),
    validateFormat: (val) => {
      const cleaned = val.toUpperCase().replace(/[\s-]/g, '');
      return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(cleaned);
    },
    canonicalExample: 'ABC860101XX1',
    ruleVersion: 'MX-RFC-v1',
  },
  CL: {
    countryCode: 'CL',
    label: 'RUT',
    placeholder: 'Ej. 76.123.456-K',
    helpText: 'Ingrese el RUT con guion y dígito verificador.',
    minLength: 7,
    maxLength: 15,
    inputMode: 'text',
    acceptedCharacters: /^[\d.\s-kK]*$/,
    formatPattern: /^\d{7,8}-[0-9K]$/i,
    validationLevel: 'checksum',
    normalize: (val) => {
      const cleaned = val.replace(/[^0-9kK]/g, '').toUpperCase();
      if (cleaned.length >= 8 && cleaned.length <= 9) {
        return cleaned.slice(0, -1) + '-' + cleaned.slice(-1);
      }
      return val.replace(/[\s.]/g, '').replace(/[–—]/g, '-').toUpperCase();
    },
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-').toUpperCase();
      return /^\d{7,8}-[0-9K]$/.test(cleaned);
    },
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-').toUpperCase();
      const parts = cleaned.split('-');
      const body = parts[0];
      const dv = parts[1];
      if (!body || !dv || !/^\d+$/.test(body)) return false;
      return dv === calculateChileCheckDigit(body);
    },
    canonicalExample: '76123456-K',
    ruleVersion: 'CL-RUT-v1',
  },
  PE: {
    countryCode: 'PE',
    label: 'RUC',
    placeholder: 'Ej. 20123456789',
    helpText: 'Ingrese el RUC de 11 dígitos.',
    minLength: 11,
    maxLength: 15,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^(10|15|17|20)\d{9}$/,
    validationLevel: 'checksum',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      return /^(10|15|17|20)\d{9}$/.test(cleaned);
    },
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      if (cleaned.length !== 11) return false;
      const rucBody = cleaned.slice(0, 10);
      const dv = cleaned.slice(10);
      return dv === calculatePeruCheckDigit(rucBody);
    },
    canonicalExample: '20123456789',
    ruleVersion: 'PE-RUC-v1',
  },
  EC: {
    countryCode: 'EC',
    label: 'RUC',
    placeholder: 'Ej. 1791234567001',
    helpText: 'Ingrese el RUC de 13 dígitos (debe terminar en 001).',
    minLength: 13,
    maxLength: 18,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}00[1-9]$/,
    validationLevel: 'format_only',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      return /^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}00[1-9]$/.test(cleaned);
    },
    canonicalExample: '1791234567001',
    ruleVersion: 'EC-RUC-v1',
  },
  AR: {
    countryCode: 'AR',
    label: 'CUIT',
    placeholder: 'Ej. 30-12345678-9',
    helpText: 'Ingrese el CUIT con guiones o compacto.',
    minLength: 10,
    maxLength: 15,
    inputMode: 'text',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^(20|23|24|27|30|33|34)\d{9}$/,
    validationLevel: 'checksum',
    normalize: (val) => {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 11) {
        return digits.slice(0, 2) + '-' + digits.slice(2, 10) + '-' + digits.slice(10);
      }
      return val.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
    },
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      return /^(20|23|24|27|30|33|34)\d{9}$/.test(cleaned);
    },
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      if (cleaned.length !== 11) return false;
      const cuitBody = cleaned.slice(0, 10);
      const dv = cleaned.slice(10);
      const expected = calculateArgentinaCheckDigit(cuitBody);
      return expected !== null && dv === expected;
    },
    canonicalExample: '30-12345678-9',
    ruleVersion: 'AR-CUIT-v1',
  },
  BR: {
    countryCode: 'BR',
    label: 'CNPJ',
    placeholder: 'Ej. 12.345.678/0001-95',
    helpText: 'Ingrese el CNPJ con formato estándar o compacto.',
    minLength: 14,
    maxLength: 20,
    inputMode: 'text',
    acceptedCharacters: /^[\d\s./-]*$/,
    formatPattern: /^\d{14}$/,
    validationLevel: 'checksum',
    normalize: (val) => {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 14) {
        return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8) + '/' + digits.slice(8, 12) + '-' + digits.slice(12);
      }
      return val.trim();
    },
    validateFormat: (val) => {
      const cleaned = val.replace(/[\s./-]/g, '');
      return /^\d{14}$/.test(cleaned);
    },
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s./-]/g, '');
      if (cleaned.length !== 14) return false;
      if (/^(\d)\1{13}$/.test(cleaned)) return false;
      
      const digits = cleaned.split('').map(Number);
      const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const dv1 = calculateCNPJCheckDigit(digits.slice(0, 12), w1);
      if (digits[12] !== dv1) return false;
      
      const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const dv2 = calculateCNPJCheckDigit(digits.slice(0, 13), w2);
      return digits[13] === dv2;
    },
    canonicalExample: '12.345.678/0001-95',
    ruleVersion: 'BR-CNPJ-v1',
  },
};

export function getTaxIdentifierRule(countryCode: string | undefined): TaxIdentifierRule | undefined {
  if (!countryCode) return undefined;
  return TAX_IDENTIFIER_RULES[countryCode.toUpperCase().trim()];
}

export type TaxValidationResult = {
  valid: boolean;
  error?: string;
  normalized?: string;
};

export function validateTaxIdentifier(
  value: string | undefined,
  countryCode: string | undefined
): TaxValidationResult {
  if (!value || value.trim().length === 0) {
    return { valid: true };
  }

  if (!countryCode) {
    return {
      valid: false,
      error: 'Debe seleccionar un país para registrar un identificador fiscal.',
    };
  }

  const rule = getTaxIdentifierRule(countryCode);
  if (!rule) {
    return {
      valid: false,
      error: 'La validación del identificador fiscal aún no está configurada para este país.',
    };
  }

  // 0. Verificar caracteres permitidos antes de normalizar
  if (rule.acceptedCharacters && !rule.acceptedCharacters.test(value)) {
    return {
      valid: false,
      error: `El ${rule.label} contiene caracteres no permitidos para ${getCountryNameByCode(countryCode)}.`,
    };
  }

  // 1. Normalizar el valor
  const normalized = rule.normalize(value);

  // 2. Validar formato
  const isFormatValid = rule.validateFormat(normalized);
  if (!isFormatValid) {
    return {
      valid: false,
      error: `El ${rule.label} no tiene el formato esperado para ${getCountryNameByCode(countryCode)}.`,
    };
  }

  // 3. Validar checksum si aplica
  if (rule.validationLevel === 'checksum' && rule.validateChecksum) {
    const isChecksumValid = rule.validateChecksum(normalized);
    if (!isChecksumValid) {
      return {
        valid: false,
        error: `El ${rule.label} no es válido para ${getCountryNameByCode(countryCode)}.`,
      };
    }
  }

  return {
    valid: true,
    normalized,
  };
}

function getCountryNameByCode(code: string): string {
  const names: Record<string, string> = {
    CO: 'Colombia',
    MX: 'México',
    CL: 'Chile',
    PE: 'Perú',
    EC: 'Ecuador',
    AR: 'Argentina',
    BR: 'Brasil',
  };
  return names[code.toUpperCase().trim()] ?? code;
}
