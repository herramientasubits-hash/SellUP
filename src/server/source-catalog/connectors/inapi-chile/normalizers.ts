import type { ApplicantParsed, InapiTrademarkRawRecord, InapiPatentRawRecord, InapiRawRecord } from './types';

const COMPANY_SUFFIXES = [
  'spa',
  's\\.?a\\.?',
  's a',
  'sa',
  'ltda',
  'l t d a',
  'limitada',
  'sociedad anonima',
  'sociedad por acciones',
  'sociedad de responsabilidad limitada',
  'eirl',
  'e\\.?i\\.?r\\.?l\\.?',
  'e i r l',
  's\\.?r\\.?l\\.?',
  's r l',
  'srl',
  'y cia',
  'y compania',
  'y compañia',
  'en reorganizacion',
  'en liquidacion',
];

const ACCENT_MAP: Record<string, string> = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'ü': 'u', 'ñ': 'n',
  'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u',
  'Ü': 'u', 'Ñ': 'n',
};

export function removeAccents(text: string): string {
  return text.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (ch) => ACCENT_MAP[ch] ?? ch);
}

export function removePunctuation(text: string): string {
  return text.replace(/[^a-z0-9\s]/g, ' ');
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeName(text: string): string {
  let result = text.toLowerCase();
  result = removeAccents(result);
  result = removePunctuation(result);
  result = normalizeWhitespace(result);
  return result;
}

export function normalizeNameWithSuffixRemoval(text: string): string {
  const normalized = normalizeName(text);
  return removeCompanySuffix(normalized);
}

export function removeCompanySuffix(text: string): string {
  let normalized = text.toLowerCase().trim();
  const suffixRegex = new RegExp(
    `\\s+(${COMPANY_SUFFIXES.join('|')})\\s*$`,
    'i',
  );
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(suffixRegex, '').trim();
  } while (normalized !== previous);
  return normalized;
}

export function parseApplicant(raw: unknown): ApplicantParsed | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  const trimmed = raw.trim();
  const match = trimmed.match(/^\(([A-Z]{2})\)\s*(.+)/);

  if (match) {
    return {
      countryCode: match[1],
      applicantName: match[2].trim(),
      raw: trimmed,
    };
  }

  return {
    countryCode: null,
    applicantName: trimmed,
    raw: trimmed,
  };
}

export function normalizeApplicantName(raw: unknown): string | null {
  const parsed = parseApplicant(raw);
  if (!parsed) return null;
  return parsed.applicantName;
}

export function extractApplicantCountryCode(raw: unknown): string | null {
  const parsed = parseApplicant(raw);
  return parsed?.countryCode ?? null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function normalizeDate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function normalizeTrademarkRawRecord(
  raw: InapiTrademarkRawRecord,
): {
  applicantRaw: string | null;
  applicantName: string | null;
  brandName: string | null;
  applicationNumber: string | null;
  registrationNumber: string | null;
  status: string | null;
  filingDate: string | null;
  registrationDate: string | null;
  nizaClasses: string | null;
  rawRecordId: string | null;
} {
  const applicantRaw = str(raw.Applicants);
  const applicantName = normalizeApplicantName(raw.Applicants);
  const brandName = str(raw.BrandName);
  const applicationNumber = str(raw.ApplicationNumber);
  const registrationNumber = str(raw.RegistrationNumber);
  const status = str(raw.Status);
  const filingDate = normalizeDate(raw.FilingDate);
  const registrationDate = normalizeDate(raw.RegistrationDate);
  const nizaClasses = str(raw.NizaClasses);
  const rawId = raw._id ? String(raw._id) : null;

  return {
    applicantRaw,
    applicantName,
    brandName,
    applicationNumber,
    registrationNumber,
    status,
    filingDate,
    registrationDate,
    nizaClasses,
    rawRecordId: rawId,
  };
}

export function normalizePatentRawRecord(
  raw: InapiPatentRawRecord,
): {
  applicantRaw: string | null;
  applicantName: string | null;
  patentTitle: string | null;
  applicationNumber: string | null;
  registrationNumber: string | null;
  status: string | null;
  filingDate: string | null;
  registrationDate: string | null;
  ipc: string | null;
  rawRecordId: string | null;
} {
  const applicantRaw = str(raw.Applicants);
  const applicantName = normalizeApplicantName(raw.Applicants);
  const patentTitle = str(raw.Title);
  const applicationNumber = str(raw.ApplicationNumber);
  const registrationNumber = str(raw.RegistrationNumber);
  const status = str(raw.Status);
  const filingDate = normalizeDate(raw.FilingDate);
  const registrationDate = normalizeDate(raw.RegistrationDate);
  const ipc = str(raw.IPC);
  const rawId = raw._id ? String(raw._id) : null;

  return {
    applicantRaw,
    applicantName,
    patentTitle,
    applicationNumber,
    registrationNumber,
    status,
    filingDate,
    registrationDate,
    ipc,
    rawRecordId: rawId,
  };
}

export function detectRecordType(raw: InapiRawRecord): 'trademark' | 'patent' {
  if ('BrandName' in raw) return 'trademark';
  return 'patent';
}
