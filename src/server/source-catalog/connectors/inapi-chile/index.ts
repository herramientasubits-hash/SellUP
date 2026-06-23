export { runInapiChileDryRun } from './run-inapi-dry-run';
export { fetchInapiResourceIds, fetchInapiRecords, queryInapiByName } from './inapi-client';
export {
  normalizeName,
  removeCompanySuffix,
  parseApplicant,
  normalizeApplicantName,
  extractApplicantCountryCode,
  normalizeTrademarkRawRecord,
  normalizePatentRawRecord,
  removeAccents,
  removePunctuation,
} from './normalizers';
export { matchByName, computeTokenSimilarity, isStrongMatch, isWeakMatch, isPossibleMatch } from './name-matcher';

export type {
  InapiDatasetKey,
  InapiSignalType,
  MatchMethod,
  InapiTrademarkRawRecord,
  InapiPatentRawRecord,
  InapiRawRecord,
  InapiCkanResponse,
  ApplicantParsed,
  InapiDatasetConfig,
  NameMatchResult,
  InapiNormalizedSignal,
  InapiDryRunInput,
  InapiDryRunSummary,
  InapiDryRunOutput,
} from './types';
