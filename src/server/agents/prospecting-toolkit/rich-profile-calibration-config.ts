/**
 * Pure helpers — resolve dry-run calibration and write-smoke config from env vars.
 * Extracted for testability; no side effects on import.
 *
 * Shared env vars (all optional — Sofka defaults):
 *   RICH_PROFILE_CANDIDATE_NAME
 *   RICH_PROFILE_DOMAIN
 *   RICH_PROFILE_WEBSITE
 *   RICH_PROFILE_COUNTRY
 *   RICH_PROFILE_COUNTRY_CODE
 *   RICH_PROFILE_INDUSTRY
 *   RICH_PROFILE_MAX_RESULTS
 *   RICH_PROFILE_SEARCH_DEPTH
 *
 * Additional env vars for write smoke (resolveWriteSmokeConfig):
 *   RICH_PROFILE_SMOKE_TYPE   — batch metadata smoke_type (default: rich_profile_flow_v1_16f)
 *   RICH_PROFILE_SCRIPT_NAME  — batch metadata created_by_script (default: v1_16f_rich_profile_flow_write_smoke)
 */

export interface CandidateCalibrationConfig {
  candidateName: string;
  domain: string;
  website: string;
  country: string;
  countryCode: string;
  industry: string;
  maxResults: number;
  searchDepth: 'basic' | 'advanced';
}

export function resolveCalibrationConfig(env: Record<string, string | undefined>): CandidateCalibrationConfig {
  const rawDepth = env['RICH_PROFILE_SEARCH_DEPTH'] ?? 'basic';
  const resolvedDepth: 'basic' | 'advanced' = rawDepth === 'advanced' ? 'advanced' : 'basic';

  const rawMaxResults = env['RICH_PROFILE_MAX_RESULTS'];
  const resolvedMaxResults =
    rawMaxResults && /^\d+$/.test(rawMaxResults) ? parseInt(rawMaxResults, 10) : 5;

  return {
    candidateName: env['RICH_PROFILE_CANDIDATE_NAME'] ?? 'Sofka',
    domain: env['RICH_PROFILE_DOMAIN'] ?? 'sofka.com.co',
    website: env['RICH_PROFILE_WEBSITE'] ?? 'https://www.sofka.com.co',
    country: env['RICH_PROFILE_COUNTRY'] ?? 'Colombia',
    countryCode: env['RICH_PROFILE_COUNTRY_CODE'] ?? 'CO',
    industry: env['RICH_PROFILE_INDUSTRY'] ?? 'Tecnología',
    maxResults: resolvedMaxResults,
    searchDepth: resolvedDepth,
  };
}

// ── Write smoke config ────────────────────────────────────────────────────────

const DEFAULT_SMOKE_TYPE = 'rich_profile_flow_v1_16f';
const DEFAULT_SCRIPT_NAME = 'v1_16f_rich_profile_flow_write_smoke';

export interface WriteSmokeConfig extends CandidateCalibrationConfig {
  smokeType: string;
  scriptName: string;
}

export function resolveWriteSmokeConfig(env: Record<string, string | undefined>): WriteSmokeConfig {
  return {
    ...resolveCalibrationConfig(env),
    smokeType: env['RICH_PROFILE_SMOKE_TYPE'] ?? DEFAULT_SMOKE_TYPE,
    scriptName: env['RICH_PROFILE_SCRIPT_NAME'] ?? DEFAULT_SCRIPT_NAME,
  };
}
