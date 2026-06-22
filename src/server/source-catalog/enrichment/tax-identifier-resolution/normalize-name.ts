const LEGAL_SUFFIX_TOKENS = new Set([
  'sas', 'sa', 'ltda', 'srl', 'eu', 'eirl', 'spa', 'inc',
  'corp', 'llc', 'sl',
]);

const GENERIC_TOKENS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'o', 'a',
  'un', 'una', 'con', 'por', 'para', 'su', 'al', 'lo',
]);

function normalizeBase(name: string): string {
  if (!name || name.trim().length === 0) return '';

  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function removePunctuationAndCompact(name: string): string {
  return name
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensWithoutLegalSuffixes(tokens: string[]): string[] {
  const result: string[] = [];
  for (const token of tokens) {
    const cleaned = token.replace(/[^a-z0-9]/g, '');
    if (cleaned && !LEGAL_SUFFIX_TOKENS.has(cleaned)) {
      result.push(cleaned);
    }
  }
  return result;
}

function removeSuffixPatterns(name: string): string {
  const suffixes = [
    /\bs\s*\.?\s*a\s*\.?\s*s\s*\.?\b/gi,
    /\bs\s*\.?\s*a\s*\.?\s*de\s+c\s*\.?\s*v\s*\.?\b/gi,
    /\bs\s*\.?\s*a\s*\.?\b/gi,
    /\bsas\b/gi,
    /\bsa\b/gi,
    /\bltda\s*\.?\b/gi,
    /\bs\s*\.?\s*r\s*\.?\s*l\s*\.?\b/gi,
    /\be\s*\.?\s*u\s*\.?\b/gi,
    /\be\s*\.?\s*i\s*\.?\s*r\s*\.?\s*l\s*\.?\b/gi,
    /\bspa\b/gi,
    /\binc\s*\.?\b/gi,
    /\bcorp\s*\.?\b/gi,
    /\bllc\b/gi,
    /\bs\s*\.?\s*l\s*\.?\b/gi,
  ];

  let result = name;
  for (const re of suffixes) {
    result = result.replace(re, '');
  }
  return result;
}

export function normalizeColombiaCompanyName(name: string): string {
  if (!name || name.trim().length === 0) return '';

  let normalized = normalizeBase(name);

  normalized = removeSuffixPatterns(normalized);
  normalized = removePunctuationAndCompact(normalized);

  const tokens = normalized.split(' ').filter(t => t.length > 0);
  const cleaned = tokensWithoutLegalSuffixes(tokens);
  const filtered = cleaned.filter(t => !GENERIC_TOKENS.has(t));

  return filtered.join(' ');
}

export function normalizeColombiaCompanyNameExact(name: string): string {
  if (!name || name.trim().length === 0) return '';

  let normalized = normalizeBase(name);

  normalized = removeSuffixPatterns(normalized);
  normalized = removePunctuationAndCompact(normalized);

  const tokens = normalized.split(' ').filter(t => t.length > 0);
  const cleaned = tokensWithoutLegalSuffixes(tokens);

  return cleaned.join(' ');
}
