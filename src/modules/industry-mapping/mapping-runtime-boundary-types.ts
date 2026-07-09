// mapping-runtime-boundary-types.ts — Provider Industry Mapping Server-Only
// Runtime Boundary (Q3F-5AN.1). Error taxonomy for trusted actor resolution.
//
// These are application-boundary/authentication failures — distinct from
// MappingDraftErrorCode (DRAFT mutation / publication lifecycle) and
// MappingSnapshotLoadErrorCode (LOAD1/LOAD2) — so they are not folded into
// either existing union.

export type IndustryMappingRuntimeBoundaryErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INTERNAL_USER_NOT_FOUND'
  | 'INTERNAL_USER_ACCESS_DENIED';

/**
 * Stable error for the industry-mapping server-only application boundary.
 * Never carries the service-role key, raw connection details, or Supabase
 * auth session content — `cause` holds the original infrastructure error (if
 * any) for server-side logging only, same convention as MappingDraftError.
 */
export class IndustryMappingRuntimeBoundaryError extends Error {
  constructor(
    public readonly code: IndustryMappingRuntimeBoundaryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IndustryMappingRuntimeBoundaryError';
  }
}
