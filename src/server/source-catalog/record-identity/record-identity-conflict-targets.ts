/**
 * Universal conflict target constants for source_company_snapshots upserts.
 * Hito: EC4D5.B — Shared record identity module
 *
 * There are exactly two conflict targets: the legacy tax grain and the new
 * record identity grain. No source-specific onConflict value belongs here.
 */

export const OLD_TAX_GRAIN_ON_CONFLICT = 'source_key,country_code,source_year,normalized_tax_id';

export const RECORD_IDENTITY_ON_CONFLICT = 'source_key,country_code,source_year,record_identity_key';
