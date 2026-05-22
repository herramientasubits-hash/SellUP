/**
 * Prospecting Toolkit — Tipos base para deduplicación determinística.
 *
 * Estos tipos son el contrato entre sellup_duplicate_checker,
 * hubspot_duplicate_checker y el orquestador duplicate-checker.
 * No contienen lógica, no importan nada externo.
 */

export type DuplicateStatus =
  | "new_candidate"
  | "existing_in_sellup"
  | "existing_in_hubspot"
  | "possible_duplicate"
  | "insufficient_data"
  | "unchecked"
  | "error";

export type DuplicateCheckInput = {
  name: string;
  legalName?: string | null;
  normalizedName?: string | null;
  website?: string | null;
  domain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  taxIdentifier?: string | null;
};

export type DuplicateMatch = {
  source: "sellup" | "hubspot";
  status: DuplicateStatus;
  confidence: number;
  matchedId?: string | null;
  matchedName?: string | null;
  matchedDomain?: string | null;
  matchedWebsite?: string | null;
  matchedTaxIdentifier?: string | null;
  reason: string;
  raw?: unknown;
};

export type DuplicateCheckResult = {
  status: DuplicateStatus;
  confidence: number;
  input: DuplicateCheckInput;
  matches: DuplicateMatch[];
  summary: string;
  checkedSources: Array<"sellup" | "hubspot">;
  errors?: string[];
};
