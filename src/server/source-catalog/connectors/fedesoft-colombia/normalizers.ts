const LEGAL_SUFFIXES = [
  /\bS\.A\.S\.?\s*$/i,
  /\bSAS\s*$/i,
  /\bS\.A\.?\s*$/i,
  /\bLTDA\s*$/i,
  /\bLIMITADA\s*$/i,
  /\bS\s+EN\s+C\s*$/i,
  /\bS\s*\.?\s*E\s*\.?\s*N\s*\.?\s*C\s*\.?\s*$/i,
  /\bSCA\s*$/i,
  /\bS\.C\.A\.?\s*$/i,
  /\bINC\s*$/i,
  /\bCORP\s*$/i,
  /\bE\.U\.?\s*$/i,
  /\bEURL\s*$/i,
  /\bE\.I\.C\.E\.?\s*$/i,
];

export function normalizeFedesoftCompanyName(name: string): string {
  let result = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const suffix of LEGAL_SUFFIXES) {
    result = result.replace(suffix, '');
  }

  result = result.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  return result;
}

export function normalizeFedesoftNit(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = String(value).replace(/[\s\-\.]/g, '').trim();

  if (cleaned.length === 0) return null;
  if (!/^\d+$/.test(cleaned)) return null;

  return cleaned;
}
