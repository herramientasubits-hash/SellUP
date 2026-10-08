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

/**
 * Dígito verificador del RNC dominicano (DGII): pesos 7,9,8,6,5,4,3,2 sobre los
 * primeros 8 dígitos; resto 0 → 2, resto 1 → 1, si no 11 − resto. Verificado
 * contra el padrón DGII cargado (493.542 de 493.548 RNC jurídicos lo cumplen;
 * las 6 excepciones son RNC antiguos de entidades del Estado).
 */
export function calculateDominicanRncCheckDigit(rncBody: string): number | null {
  if (!/^\d{8}$/.test(rncBody)) return null;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += parseInt(rncBody[i], 10) * weights[i];
  }
  const remainder = sum % 11;
  if (remainder === 0) return 2;
  if (remainder === 1) return 1;
  return 11 - remainder;
}

/**
 * Dígito verificador del RUC paraguayo (SET/DNIT): módulo 11 con pesos 2, 3, 4…
 * de derecha a izquierda (con 8 dígitos como máximo, el peso no pasa de 9);
 * resto 0 o 1 → 0. SOURCES-PY-RUC-BY-NAME-1: comprobado sobre
 * 200.923 RUC del padrón público de septiembre de 2026, sin un solo fallo.
 */
export function calculateParaguayRucCheckDigit(rucBody: string): number | null {
  if (!/^\d{1,8}$/.test(rucBody)) return null;
  let total = 0;
  let weight = 2;
  for (let i = rucBody.length - 1; i >= 0; i--) {
    total += parseInt(rucBody[i], 10) * weight;
    weight += 1;
  }
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Dígito verificador del RUT uruguayo (DGI): módulo 11 sobre los 11 primeros
 * dígitos con pesos 4,3,2,9,8,7,6,5,4,3,2; 11 → 0 y 10 → RUT inválido.
 * SOURCES-UY-RUT-BY-NAME-1: comprobado sobre 105.743 RUT del RUPE de agosto de
 * 2026 (1 solo fallo, un RUT mal cargado en el registro).
 */
export function calculateUruguayRutCheckDigit(rutBody: string): number | null {
  if (!/^\d{11}$/.test(rutBody)) return null;
  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < 11; i++) total += parseInt(rutBody[i], 10) * weights[i];
  const dv = 11 - (total % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null;
  return dv;
}

/**
 * Control del NIF de una SOCIEDAD española (antiguo CIF): letra + 7 dígitos +
 * control. Posiciones impares ×2 (sumando sus cifras) + pares; control =
 * (10 − suma mod 10) mod 10, como dígito o como letra «JABCDEFGHI»[control].
 * SOURCES-ES-NIF-BY-NAME-1: comprobado sobre 11.404 NIF de adjudicatarias de la
 * Plataforma de Contratación (septiembre de 2026), 1 solo fallo del propio registro.
 */
export function calculateSpainCompanyNifControl(body7: string): { digit: string; letter: string } | null {
  if (!/^\d{7}$/.test(body7)) return null;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    let value = parseInt(body7[i], 10);
    if (i % 2 === 0) {
      value *= 2;
      value = Math.floor(value / 10) + (value % 10);
    }
    total += value;
  }
  const control = (10 - (total % 10)) % 10;
  return { digit: String(control), letter: 'JABCDEFGHI'[control] };
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

/** RUC panameño sin espacios ni DV («280-319-61818 D.V.53» → «280-319-61818»). */
function normalizePanamaRuc(val: string): string {
  const compact = val.toUpperCase().replace(/D\.?\s*V\.?\s*\d{1,2}\s*$/, '').replace(/\s+/g, '').replace(/-+$/, '');
  // «983932-1-532761-43»: el cuarto tramo de una persona jurídica es el DV.
  const withDv = /^(\d{3,}-\d{1,4}-\d{1,7})-\d{1,2}$/.exec(compact);
  if (withDv) return withDv[1];
  // SOURCES-PA-CLOSE-1 — entidad pública «8-NT-1-12541-40»: sin DV y sin ceros a la
  // izquierda en el tomo («8-NT-01-12761» = «8-NT-1-12761»), como en pa_ruc_registry.
  const entity = /^(\d{1,2})-NT-(\d{1,4})-(\d{1,7})(?:-\d{1,2})?$/.exec(compact);
  return entity ? `${Number(entity[1])}-NT-${Number(entity[2])}-${entity[3]}` : compact;
}

export const TAX_IDENTIFIER_RULES: Record<string, TaxIdentifierRule> = {
  CO: {
    countryCode: 'CO',
    label: 'NIT',
    placeholder: 'Ej. 900123456-8',
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
    canonicalExample: '900123456-8',
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
    placeholder: 'Ej. 76.123.456-0',
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
    canonicalExample: '76123456-0',
    ruleVersion: 'CL-RUT-v1',
  },
  PE: {
    countryCode: 'PE',
    label: 'RUC',
    placeholder: 'Ej. 20123456786',
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
    canonicalExample: '20123456786',
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
    placeholder: 'Ej. 30-12345678-1',
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
    canonicalExample: '30-12345678-1',
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
  DO: {
    countryCode: 'DO',
    label: 'RNC',
    placeholder: 'Ej. 131735444',
    helpText: 'Ingrese el RNC de 9 dígitos de la empresa.',
    minLength: 9,
    maxLength: 13,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^\d{9}$/,
    validationLevel: 'checksum',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^\d{9}$/.test(val.replace(/[\s.-]/g, '')),
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      if (cleaned.length !== 9) return false;
      return parseInt(cleaned[8], 10) === calculateDominicanRncCheckDigit(cleaned.slice(0, 8));
    },
    canonicalExample: '131735444',
    ruleVersion: 'DO-RNC-v1',
  },
  PY: {
    countryCode: 'PY',
    label: 'RUC',
    placeholder: 'Ej. 80000108-7',
    helpText: 'Ingrese el RUC con guion y dígito verificador.',
    minLength: 6,
    maxLength: 12,
    inputMode: 'text',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^\d{5,8}-\d$/,
    validationLevel: 'checksum',
    normalize: (val) => {
      const trimmed = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-');
      if (/^\d{5,8}-\d$/.test(trimmed)) return trimmed;
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 6 && digits.length <= 9) return `${digits.slice(0, -1)}-${digits.slice(-1)}`;
      return trimmed;
    },
    validateFormat: (val) => /^\d{5,8}-\d$/.test(val.replace(/[\s.]/g, '').replace(/[–—]/g, '-')),
    validateChecksum: (val) => {
      const [body, dv] = val.replace(/[\s.]/g, '').replace(/[–—]/g, '-').split('-');
      if (!body || !dv) return false;
      return parseInt(dv, 10) === calculateParaguayRucCheckDigit(body);
    },
    canonicalExample: '80000108-7',
    ruleVersion: 'PY-RUC-v1',
  },
  UY: {
    countryCode: 'UY',
    label: 'RUT',
    placeholder: 'Ej. 216569480018',
    helpText: 'Ingrese el RUT de 12 dígitos.',
    minLength: 12,
    maxLength: 16,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^\d{12}$/,
    validationLevel: 'checksum',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^\d{12}$/.test(val.replace(/[\s.-]/g, '')),
    validateChecksum: (val) => {
      const cleaned = val.replace(/[\s.-]/g, '');
      if (cleaned.length !== 12) return false;
      return parseInt(cleaned[11], 10) === calculateUruguayRutCheckDigit(cleaned.slice(0, 11));
    },
    canonicalExample: '216569480018',
    ruleVersion: 'UY-RUT-v1',
  },
  US: {
    countryCode: 'US',
    label: 'EIN',
    placeholder: 'Ej. 36-0698440',
    helpText: 'Ingrese el EIN de 9 dígitos (con o sin guion).',
    minLength: 9,
    maxLength: 12,
    inputMode: 'text',
    acceptedCharacters: /^[\d\s-]*$/,
    formatPattern: /^\d{2}-\d{7}$/,
    // El EIN no tiene dígito verificador: sólo se valida la forma.
    validationLevel: 'format_only',
    normalize: (val) => {
      const digits = val.replace(/\D/g, '');
      return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : val.trim();
    },
    validateFormat: (val) => /^\d{9}$/.test(val.replace(/[\s-]/g, '')),
    canonicalExample: '36-0698440',
    ruleVersion: 'US-EIN-v1',
  },
  ES: {
    countryCode: 'ES',
    label: 'NIF',
    placeholder: 'Ej. A58710740',
    helpText: 'Ingrese el NIF de la sociedad (letra, 7 dígitos y control).',
    minLength: 9,
    maxLength: 11,
    inputMode: 'text',
    acceptedCharacters: /^[a-zA-Z\d\s-]*$/,
    formatPattern: /^[A-HJNPQRSUVW]\d{7}[0-9A-J]$/,
    validationLevel: 'checksum',
    normalize: (val) => val.toUpperCase().replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^[A-HJNPQRSUVW]\d{7}[0-9A-J]$/.test(val.toUpperCase().replace(/[\s.-]/g, '')),
    validateChecksum: (val) => {
      const cleaned = val.toUpperCase().replace(/[\s.-]/g, '');
      const control = calculateSpainCompanyNifControl(cleaned.slice(1, 8));
      return control !== null && (cleaned[8] === control.digit || cleaned[8] === control.letter);
    },
    canonicalExample: 'A58710740',
    ruleVersion: 'ES-NIF-v1',
  },
  CR: {
    countryCode: 'CR',
    label: 'Cédula jurídica',
    placeholder: 'Ej. 3-101-052623',
    helpText: 'Ingrese la cédula jurídica de 10 dígitos (con o sin guiones).',
    minLength: 10,
    maxLength: 12,
    inputMode: 'text',
    acceptedCharacters: /^[\d\s-]*$/,
    formatPattern: /^\d{10}$/,
    // SOURCES-CR-CEDULA-BY-NAME-1: no hay dígito verificador documentado para la
    // cédula jurídica; sólo se valida la forma.
    validationLevel: 'format_only',
    normalize: (val) => val.replace(/[\s-]/g, ''),
    validateFormat: (val) => /^[234]\d{9}$/.test(val.replace(/[\s-]/g, '')),
    canonicalExample: '3101052623',
    ruleVersion: 'CR-CEDJUR-v1',
  },
  BO: {
    countryCode: 'BO',
    label: 'NIT',
    placeholder: 'Ej. 1020229024',
    helpText: 'Ingrese el NIT (sólo dígitos).',
    minLength: 7,
    maxLength: 13,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^\d{7,13}$/,
    // SOURCES-BO-NIT-BY-NAME-LIVE-1: no hay dígito verificador público del NIT
    // boliviano; sólo se valida la forma.
    validationLevel: 'format_only',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^\d{7,13}$/.test(val.replace(/[\s.-]/g, '')),
    canonicalExample: '1020229024',
    ruleVersion: 'BO-NIT-v1',
  },
  // SOURCES-TAX-RULES-GT-HN-PA-1 — sin regla, el número de estos tres países no se
  // podía escribir, corregir ni importar a mano (las corridas sí lo guardan).
  GT: {
    countryCode: 'GT',
    label: 'NIT',
    placeholder: 'Ej. 1234567K',
    helpText: 'Ingrese el NIT con su dígito verificador (0-9 o K), con o sin guion.',
    minLength: 5,
    maxLength: 15,
    inputMode: 'text',
    acceptedCharacters: /^[\dkK\s.-]*$/,
    formatPattern: /^\d{4,12}K?$/,
    // Igual que lo guarda el RGAE en cada corrida: dígitos y, si aplica, la K final.
    validationLevel: 'format_only',
    normalize: (val) => val.toUpperCase().replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^\d{4,12}K?$/.test(val.toUpperCase().replace(/[\s.-]/g, '')),
    canonicalExample: '1234567K',
    ruleVersion: 'GT-NIT-v1',
  },
  HN: {
    countryCode: 'HN',
    label: 'RTN',
    placeholder: 'Ej. 08019001210297',
    helpText: 'Ingrese el RTN de 14 dígitos, con o sin guiones.',
    minLength: 14,
    maxLength: 18,
    inputMode: 'numeric',
    acceptedCharacters: /^[\d\s.-]*$/,
    formatPattern: /^\d{14}$/,
    validationLevel: 'format_only',
    normalize: (val) => val.replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^\d{14}$/.test(val.replace(/[\s.-]/g, '')),
    canonicalExample: '08019001210297',
    ruleVersion: 'HN-RTN-v1',
  },
  PA: {
    countryCode: 'PA',
    label: 'RUC',
    placeholder: 'Ej. 998592-1-535732',
    helpText:
      'Ingrese el RUC: tomo-folio-asiento para empresas (por ejemplo 998592-1-535732), el de entidades públicas (8-NT-2-4249) o la cédula para personas (8-123-456, E-8-12345, PE-9-1606). El DV se puede omitir.',
    minLength: 5,
    maxLength: 30,
    inputMode: 'text',
    acceptedCharacters: /^[\dA-Za-z\s.-]*$/,
    formatPattern: /^(?:(?:\d{3,}|\d{1,2}(?:AV|PI)?|PE|E|N)-\d{1,4}-\d{1,7}|\d{1,2}-NT-\d{1,4}-\d{1,7})$/,
    // Se guarda sin el DV, igual que pa_panamacompra_ruc_registry.
    validationLevel: 'format_only',
    normalize: normalizePanamaRuc,
    validateFormat: (val) => /^(?:(?:\d{3,}|\d{1,2}(?:AV|PI)?|PE|E|N)-\d{1,4}-\d{1,7}|\d{1,2}-NT-\d{1,4}-\d{1,7})$/.test(normalizePanamaRuc(val)),
    canonicalExample: '998592-1-535732',
    ruleVersion: 'PA-RUC-v1',
  },
  // SOURCES-NI-CLOSE-2 — formatos medidos en la lista de Grandes Contribuyentes de la
  // DGI y en las licencias sanitarias del MINSA (07-10-2026).
  NI: {
    countryCode: 'NI',
    label: 'RUC',
    placeholder: 'Ej. J0310000003750',
    helpText:
      'Ingrese el RUC: «J» y 13 dígitos para empresas e instituciones (J0310000003750), o la cédula para personas (0010101800001A). Con o sin espacios ni guiones.',
    minLength: 14,
    maxLength: 20,
    inputMode: 'text',
    acceptedCharacters: /^[\dA-Za-z\s.-]*$/,
    formatPattern: /^(?:[JR]\d{13}|\d{13}[A-Z])$/,
    validationLevel: 'format_only',
    normalize: (val) => val.toUpperCase().replace(/[\s.-]/g, ''),
    validateFormat: (val) => /^(?:[JR]\d{13}|\d{13}[A-Z])$/.test(val.toUpperCase().replace(/[\s.-]/g, '')),
    canonicalExample: 'J0310000003750',
    ruleVersion: 'NI-RUC-v1',
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
    DO: 'República Dominicana',
    PY: 'Paraguay',
    UY: 'Uruguay',
    US: 'Estados Unidos',
    ES: 'España',
    CR: 'Costa Rica',
    BO: 'Bolivia',
    GT: 'Guatemala',
    HN: 'Honduras',
    PA: 'Panamá',
    NI: 'Nicaragua',
  };
  return names[code.toUpperCase().trim()] ?? code;
}
