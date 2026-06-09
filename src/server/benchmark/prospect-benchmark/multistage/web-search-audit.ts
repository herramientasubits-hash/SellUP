/**
 * Anthropic Web Search Audit — Types, Extractor & URL Classifier (Hotfix 16AB.23.5)
 *
 * Covers server-side web search blocks returned by the Anthropic API:
 *   server_tool_use        — Claude's search query dispatched to Anthropic servers
 *   web_search_tool_result — URLs and titles returned by Anthropic's search engine
 *   text.citations         — Segments of generated text attributed to specific URLs
 *   usage.server_tool_use.web_search_requests — Official search count (primary source)
 *
 * Important exclusions — never stored:
 *   encrypted_content, encrypted_index, API keys, full HTML, full raw response body.
 *
 * Nothing in this file calls real APIs. All functions are pure.
 */

// ─── Audit schema version ─────────────────────────────────────────────────────

/**
 * Incrementing this version invalidates all per-candidate verification artifacts
 * created before the audit trail was introduced, forcing re-verification.
 * Do NOT bump without also documenting the breaking change.
 */
export const SEARCH_AUDIT_VERSION = 1 as const;

export { EVIDENCE_PROVENANCE_VERSION } from '../url-canonicalizer';
import { areEvidenceUrlsEquivalent } from '../url-canonicalizer';

// ─── Anthropic response block types ──────────────────────────────────────────

export type AnthropicServerToolUseBlock = {
  type: 'server_tool_use';
  id: string;
  name: 'web_search' | string;
  input: {
    query?: string;
    [key: string]: unknown;
  };
};

/** Individual search result item. encrypted_content is intentionally excluded. */
export type AnthropicWebSearchResultItem = {
  type: 'web_search_result';
  url: string;
  title: string;
  page_age?: string;
};

export type AnthropicWebSearchToolResultBlock = {
  type: 'web_search_tool_result';
  tool_use_id: string;
  content:
    | AnthropicWebSearchResultItem[]
    | { type: 'web_search_tool_result_error'; error_code: string };
};

/** Citation attached to a text segment. encrypted_index is intentionally excluded. */
export type AnthropicWebSearchCitation = {
  type: 'web_search_result_location';
  url: string;
  title: string;
  cited_text?: string;
};

/** Text block that may carry web search citations. */
export type AnthropicTextBlock = {
  type: 'text';
  text: string;
  citations?: AnthropicWebSearchCitation[];
};

/** Any content block that may appear in an Anthropic response. */
export type AnthropicResponseContent =
  | AnthropicTextBlock
  | AnthropicServerToolUseBlock
  | AnthropicWebSearchToolResultBlock
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: string; [key: string]: unknown };

// ─── Search count status ──────────────────────────────────────────────────────

export type SearchCountStatus =
  | 'reported_by_provider'  // usage.server_tool_use.web_search_requests present
  | 'inferred_from_blocks'  // counted from server_tool_use blocks — less authoritative
  | 'unavailable';          // no usage field and no blocks; count is unknown

// ─── URL provenance ───────────────────────────────────────────────────────────

export type EvidenceUrlOrigin =
  | 'tool_result_url'            // URL found in a web_search_tool_result block
  | 'citation_url'               // URL found in a text citation
  | 'tool_result_and_citation'   // URL found in both search results and citations
  | 'model_generated_url'        // URL appears in structured output but not in audit trail
  | 'unknown_origin';            // No audit trail available; cannot classify

// ─── Audit result ─────────────────────────────────────────────────────────────

export type AnthropicWebSearchAudit = {
  /** Number of web searches executed. Null when unavailable (see searchCountStatus). */
  searchRequests: number | null;

  searchCountStatus: SearchCountStatus;

  /** Queries sent to the web search engine, in order of appearance. */
  queries: Array<{
    toolUseId: string;
    query: string;
  }>;

  /** URL results returned for each query. Does NOT include encrypted_content. */
  results: Array<{
    toolUseId: string;
    url: string;
    title: string;
    pageAge?: string;
  }>;

  /** Text segments attributed to specific URLs via the citation system. */
  citations: Array<{
    url: string;
    title: string;
    citedText?: string;
    textBlockIndex: number;
  }>;

  /** Errors returned inside web_search_tool_result blocks (HTTP 200, search-level error). */
  errors: Array<{
    toolUseId: string;
    errorCode: string;
  }>;

  stopReason: string | null;
};

// ─── Candidate audit status ───────────────────────────────────────────────────

export type CandidateAuditStatus =
  | 'auditable'            // all evidence URLs in search results or citations
  | 'partially_auditable'  // some evidence URLs traced, others model-generated
  | 'not_auditable';       // no audit trail for this candidate

/** Artifacts created before SEARCH_AUDIT_VERSION was introduced. */
export type LegacyAuditStatus = 'legacy_unverifiable';

// ─── Candidate evidence provenance ───────────────────────────────────────────

export type CandidateEvidenceProvenance = {
  websiteOrigin: EvidenceUrlOrigin;
  linkedinOrigin: EvidenceUrlOrigin;
  primaryEvidenceOrigin: EvidenceUrlOrigin;

  searchedUrls: string[];
  citedUrls: string[];

  supportedFields: Array<{
    field: string;
    sourceUrls: string[];
    supportStatus:
      | 'cited'
      | 'search_result_only'
      | 'model_claim_only'
      | 'unsupported';
  }>;

  auditStatus: CandidateAuditStatus;
};

// ─── Extractor ────────────────────────────────────────────────────────────────

type AuditableResponse = {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
};

/**
 * Extract an auditable trace of Anthropic Web Search activity from a raw response.
 *
 * - Does NOT store encrypted_content, encrypted_index, API keys, or full HTML.
 * - A search returned with an HTTP 200 that contains a web_search_tool_result_error
 *   is counted as a search execution error, not a successful search.
 * - The official search count comes from usage.server_tool_use.web_search_requests;
 *   block-based inference is a secondary fallback only.
 */
export function extractAnthropicWebSearchAudit(response: AuditableResponse): AnthropicWebSearchAudit {
  const queries: AnthropicWebSearchAudit['queries'] = [];
  const results: AnthropicWebSearchAudit['results'] = [];
  const citations: AnthropicWebSearchAudit['citations'] = [];
  const errors: AnthropicWebSearchAudit['errors'] = [];

  for (let i = 0; i < response.content.length; i++) {
    const block = response.content[i];

    if (block['type'] === 'server_tool_use') {
      const b = block as { type: 'server_tool_use'; id: string; name: string; input?: { query?: string } };
      const query = b.input?.query;
      if (typeof query === 'string' && query.length > 0) {
        queries.push({ toolUseId: b.id ?? '', query });
      }
    }

    if (block['type'] === 'web_search_tool_result') {
      const b = block as {
        type: 'web_search_tool_result';
        tool_use_id: string;
        content: unknown;
      };
      const content = b.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          const r = item as { type?: string; url?: string; title?: string; page_age?: string };
          if (r.type === 'web_search_result' && typeof r.url === 'string' && typeof r.title === 'string') {
            results.push({
              toolUseId: b.tool_use_id ?? '',
              url: r.url,
              title: r.title,
              ...(typeof r.page_age === 'string' ? { pageAge: r.page_age } : {}),
            });
          }
        }
      } else if (typeof content === 'object' && content !== null) {
        const err = content as { type?: string; error_code?: string };
        if (err.type === 'web_search_tool_result_error' && typeof err.error_code === 'string') {
          errors.push({ toolUseId: b.tool_use_id ?? '', errorCode: err.error_code });
        }
      }
    }

    if (block['type'] === 'text') {
      const b = block as { type: 'text'; text: string; citations?: unknown[] };
      if (Array.isArray(b.citations)) {
        for (const c of b.citations) {
          const cit = c as { type?: string; url?: string; title?: string; cited_text?: string };
          if (
            cit.type === 'web_search_result_location' &&
            typeof cit.url === 'string' &&
            typeof cit.title === 'string'
          ) {
            citations.push({
              url: cit.url,
              title: cit.title,
              ...(typeof cit.cited_text === 'string' && cit.cited_text.length > 0
                ? { citedText: cit.cited_text }
                : {}),
              textBlockIndex: i,
            });
          }
        }
      }
    }
  }

  // Primary: official count from usage field
  const reportedCount = response.usage?.server_tool_use?.web_search_requests;

  let searchRequests: number | null;
  let searchCountStatus: SearchCountStatus;

  if (typeof reportedCount === 'number') {
    searchRequests = reportedCount;
    searchCountStatus = 'reported_by_provider';
  } else {
    // Secondary: count server_tool_use blocks named 'web_search'
    const blocksCount = response.content.filter(
      (b) => b['type'] === 'server_tool_use' && b['name'] === 'web_search'
    ).length;

    if (blocksCount > 0) {
      searchRequests = blocksCount;
      searchCountStatus = 'inferred_from_blocks';
    } else if (queries.length > 0) {
      // Fallback: queries found in server_tool_use blocks with any name
      searchRequests = queries.length;
      searchCountStatus = 'inferred_from_blocks';
    } else {
      searchRequests = null;
      searchCountStatus = 'unavailable';
    }
  }

  return {
    searchRequests,
    searchCountStatus,
    queries,
    results,
    citations,
    errors,
    stopReason: response.stop_reason ?? null,
  };
}

// ─── URL provenance classifier ────────────────────────────────────────────────

/**
 * Classify the origin of a URL relative to a given search audit.
 *
 * A URL written by the model (e.g. in the candidate's JSON output) but absent
 * from both search results and citations cannot be considered evidence that was
 * actually searched — it is classified as model_generated_url.
 *
 * URL comparison uses canonical normalization (see url-canonicalizer.ts) so
 * that semantically equivalent URLs — trailing slash, www prefix, tracking
 * parameters, http/https, LinkedIn regional subdomains — are recognized as
 * the same resource.
 */
export function classifyUrlOrigin(
  url: string | null | undefined,
  audit: AnthropicWebSearchAudit | null | undefined
): EvidenceUrlOrigin {
  if (!url) return 'unknown_origin';
  if (!audit) return 'unknown_origin';

  const inResults = audit.results.some((r) => areEvidenceUrlsEquivalent(url, r.url));
  const inCitations = audit.citations.some((c) => areEvidenceUrlsEquivalent(url, c.url));

  if (inResults && inCitations) return 'tool_result_and_citation';
  if (inResults) return 'tool_result_url';
  if (inCitations) return 'citation_url';
  return 'model_generated_url';
}

// ─── Aggregate helpers ────────────────────────────────────────────────────────

/** Merge multiple per-call audits from a single agentic turn into one. */
export function mergeWebSearchAudits(audits: AnthropicWebSearchAudit[]): AnthropicWebSearchAudit {
  const queries = audits.flatMap((a) => a.queries);
  const results = audits.flatMap((a) => a.results);
  const citations = audits.flatMap((a) => a.citations);
  const errors = audits.flatMap((a) => a.errors);

  // Sum reported counts when available; degrade to inferred or unavailable otherwise
  let totalReported = 0;
  let anyUnavailable = false;
  let anyInferred = false;

  for (const a of audits) {
    if (a.searchCountStatus === 'reported_by_provider' && a.searchRequests !== null) {
      totalReported += a.searchRequests;
    } else if (a.searchCountStatus === 'inferred_from_blocks') {
      anyInferred = true;
    } else {
      anyUnavailable = true;
    }
  }

  const hasAnySearch = queries.length > 0 || results.length > 0;

  let searchRequests: number | null;
  let searchCountStatus: SearchCountStatus;

  if (!anyUnavailable && !anyInferred) {
    searchRequests = totalReported;
    searchCountStatus = 'reported_by_provider';
  } else if (!anyUnavailable && hasAnySearch) {
    searchRequests = totalReported + (anyInferred ? queries.length : 0);
    searchCountStatus = 'inferred_from_blocks';
  } else {
    searchRequests = hasAnySearch ? totalReported || queries.length || null : null;
    searchCountStatus = hasAnySearch ? 'inferred_from_blocks' : 'unavailable';
  }

  const lastAudit = audits[audits.length - 1];
  return {
    searchRequests,
    searchCountStatus,
    queries,
    results,
    citations,
    errors,
    stopReason: lastAudit?.stopReason ?? null,
  };
}

/**
 * Determine the worst-case SearchCountStatus across all status values seen.
 * reported_by_provider > inferred_from_blocks > unavailable
 */
export function degradeSearchCountStatus(statuses: SearchCountStatus[]): SearchCountStatus {
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('inferred_from_blocks')) return 'inferred_from_blocks';
  return 'reported_by_provider';
}

/**
 * Derive audit status for a candidate from an audit trail.
 * If no audit is available, returns 'not_auditable'.
 */
export function deriveCandidateAuditStatus(
  website: string | null | undefined,
  linkedin: string | null | undefined,
  evidenceUrl: string | null | undefined,
  audit: AnthropicWebSearchAudit | null | undefined
): CandidateAuditStatus {
  if (!audit) return 'not_auditable';
  if (audit.results.length === 0 && audit.citations.length === 0) return 'not_auditable';

  const urls = [website, linkedin, evidenceUrl].filter((u): u is string => Boolean(u));
  if (urls.length === 0) return 'partially_auditable';

  const origins = urls.map((u) => classifyUrlOrigin(u, audit));
  const allSearched = origins.every((o) => o !== 'model_generated_url' && o !== 'unknown_origin');
  const anySearched = origins.some((o) => o === 'tool_result_url' || o === 'tool_result_and_citation' || o === 'citation_url');

  if (allSearched) return 'auditable';
  if (anySearched) return 'partially_auditable';
  return 'not_auditable';
}
