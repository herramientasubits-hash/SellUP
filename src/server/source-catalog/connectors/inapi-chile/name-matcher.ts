import type { NameMatchResult, MatchMethod } from './types';
import { normalizeName, removeCompanySuffix } from './normalizers';

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !/^\d+$/.test(t));
}

export function computeTokenSimilarity(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const setA = new Set(aTokens);
  const setB = new Set(bTokens);

  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

export function matchByName(
  companyName: string,
  applicantName: string,
): NameMatchResult {
  const normalizedCompany = normalizeName(companyName);
  const normalizedApplicant = normalizeName(applicantName);

  if (normalizedCompany.length === 0 || normalizedApplicant.length === 0) {
    return { matchedName: applicantName, matchMethod: 'no_match', confidenceScore: 0 };
  }

  const strippedCompany = removeCompanySuffix(normalizedCompany);
  const strippedApplicant = removeCompanySuffix(normalizedApplicant);

  if (strippedApplicant.length === 0 || strippedCompany.length === 0) {
    return { matchedName: applicantName, matchMethod: 'no_match', confidenceScore: 0 };
  }

  if (strippedApplicant === strippedCompany) {
    return { matchedName: applicantName, matchMethod: 'exact_normalized', confidenceScore: 0.95 };
  }

  const longer = strippedCompany.length >= strippedApplicant.length ? strippedCompany : strippedApplicant;
  const shorter = strippedCompany.length >= strippedApplicant.length ? strippedApplicant : strippedCompany;

  const containsRatio = shorter.length / longer.length;
  if (longer.includes(shorter) && containsRatio >= 0.50) {
    return { matchedName: applicantName, matchMethod: 'contains_normalized', confidenceScore: 0.80 };
  }

  const companyTokens = tokenize(strippedCompany);
  const applicantTokens = tokenize(strippedApplicant);

  if (companyTokens.length === 0 || applicantTokens.length === 0) {
    return { matchedName: applicantName, matchMethod: 'no_match', confidenceScore: 0 };
  }

  const similarity = computeTokenSimilarity(companyTokens, applicantTokens);

  if (similarity >= 0.70) {
    return { matchedName: applicantName, matchMethod: 'token_similarity', confidenceScore: 0.70 };
  }

  if (similarity >= 0.40) {
    return { matchedName: applicantName, matchMethod: 'token_similarity', confidenceScore: 0.55 };
  }

  return { matchedName: applicantName, matchMethod: 'no_match', confidenceScore: 0 };
}

export function isStrongMatch(confidenceScore: number): boolean {
  return confidenceScore >= 0.80;
}

export function isWeakMatch(confidenceScore: number): boolean {
  return confidenceScore > 0 && confidenceScore < 0.80;
}

export function isPossibleMatch(confidenceScore: number): boolean {
  return confidenceScore > 0 && confidenceScore < 0.60;
}
