/**
 * BR Receita CNPJ — PUBLISHER-DERIVED NATIONAL INVENTORY for 2026-07 (BR-SOURCE-14B.0K § 3–§ 6, § 14, § 15).
 *
 * BR-SOURCE-14B.0J built the national completeness gate and then had to block on its own honesty: with
 * no authoritative statement of what the Receita actually publishes for a period, the gate returned
 * `indeterminate` every time and named the gap — `no_declared_expected_part_inventory_for_any_period`.
 * This module closes exactly that gap for ONE period, and closes it with the publisher's own listing
 * rather than with a number somebody remembered.
 *
 * ── What "authoritative" means here, mechanically ───────────────────────────────
 * The artifact below is a VERBATIM transcription of the official publisher's directory listing for
 * 2026-07: exact published file names, published sizes, published last-modified stamps. It was retrieved
 * read-only from the Receita's own file host by a metadata listing (WebDAV PROPFIND, `Depth: 1`) — no ZIP
 * was downloaded, no archive was opened, no CSV was parsed, no row was read. § 16's counters are zero as
 * a property of this file: there is no `node:fs`, no `node:http`, no fetch, and no port through which
 * one could arrive.
 *
 * ── Why exact NAMES and not a count (§ 14) ──────────────────────────────────────
 * `expectedEmpresasCount = 10` would be the same claim with the evidence deleted. A count cannot tell an
 * owner WHICH part is missing, cannot survive a publisher that renumbers, and cannot distinguish "ten
 * parts" from "part 0 staged nine times". So the source of truth is the part IDENTITY list, the count is
 * DERIVED from it by `deriveBrazilReceitaExpectedPartCount`, and the 14B.0J gate is fed from the
 * derivation — never from a literal.
 *
 * ── Why 2026-01 and 2025 are not evidence for 2026-07 (§ 2) ─────────────────────
 * Nothing in this module reads, imports, or falls back to another period. A period that is not
 * transcribed here has NO expected inventory, and the gate's `indeterminate` stands. That the Receita
 * happened to publish ten parts per join family in earlier months is context; it is not this month's
 * contract, and a parser that inferred one from the other would be manufacturing the evidence § 6
 * forbids manufacturing.
 *
 * ── Sócios / QSA are transcribed and then EXCLUDED, deliberately ────────────────
 * The publisher's 2026-07 listing contains ten `Socios*` parts. Silently dropping them at transcription
 * time would leave a reader unable to tell an excluded family from a family that was never published, so
 * they are transcribed, classified as person-linked, and refused entry to the derived expected inventory.
 * The derived inventory is what the pipeline compares against, so a person-linked family cannot reach an
 * input by way of this module — see `BRAZIL_RECEITA_PUBLISHER_PERSON_LINKED_FAMILIES` and § 10's
 * distinction between present-on-disk and included-in-input.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens a file, stats a path, performs a request, or imports an I/O module.
 *   - downloads, extracts, copies, moves, renames, deletes or modifies anything.
 *   - reads a data row, a cell, a CNPJ, a CPF, a name or a join key.
 *   - derives an expected inventory for a period it was not given a publisher listing for.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - authorizes a benchmark. It supplies evidence to a gate; it is not the gate and it is not consent.
 */

import {
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
} from './br-receita-cnpj-manifest';
import { BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS } from './br-receita-cnpj-real-manifest-metadata-reader';
import type {
  BrazilReceitaNationalExpectedInventory,
  BrazilReceitaNationalInventoryProvenance,
} from './br-receita-cnpj-national-input-completeness';

// ─── Provenance (§ 15) ────────────────────────────────────────────────────────

/** The publisher. Not a mirror, not a community rebuild, not a documentation page. */
export const BRAZIL_RECEITA_PUBLISHER_SOURCE = 'receita_federal_official_publisher' as const;

/**
 * The only host a listing may come from.
 *
 * Checked rather than trusted: § 6's first verification is `hostname/source esperado`, and a listing
 * transcribed from anywhere else is refused with `publisher_host_unexpected` however well-formed it is.
 */
export const BRAZIL_RECEITA_PUBLISHER_HOST = 'arquivos.receitafederal.gov.br' as const;

/** Retrieval route, recorded so the transcription can be reproduced exactly. */
export const BRAZIL_RECEITA_PUBLISHER_RETRIEVAL_METHOD = 'read_only_webdav_propfind_depth_1' as const;

/** `official`, and there is no other accepted value. A secondary source is not a fallback (§ 6). */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_SOURCE = 'official' as const;

/** The transform from listing to artifact: transcription only, no inference (§ 15). */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_TRANSFORM = 'deterministic' as const;

/** The provenance label the 14B.0J gate recognizes as evidential. */
export const BRAZIL_RECEITA_PUBLISHER_DERIVED_PROVENANCE: BrazilReceitaNationalInventoryProvenance =
  'official_publisher_manifest';

// ─── Family vocabulary ────────────────────────────────────────────────────────

/** Families a full join REQUIRES. Both are multi-part. */
export const BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES: readonly string[] = [
  ...BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
];

/** Lookup/regime families the pipeline contract recognizes as OPTIONAL. */
export const BRAZIL_RECEITA_PUBLISHER_LOOKUP_FAMILIES: readonly string[] = [
  ...BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES,
];

/**
 * Person-linked families. Transcribed, classified, and never derived into an expected inventory.
 *
 * Token-matched against the metadata reader's denylist rather than name-matched, so a future
 * `SociosNovos.zip` is caught by the same rule that catches `Socios0.zip`.
 */
export const BRAZIL_RECEITA_PUBLISHER_PERSON_LINKED_FAMILY_TOKENS: readonly string[] = [
  ...BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS,
];

/** The part key given to a family the publisher ships as a single unnumbered file. */
export const BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY = 'single' as const;

// ─── The document shape a listing is transcribed into ─────────────────────────

/** One published entry, exactly as the publisher listed it. */
export interface BrazilReceitaPublisherInventoryEntry {
  /** The published file name, verbatim. `Empresas0.zip`, not `empresas` and not a path. */
  readonly name: string;
  /** Published size in bytes when the listing exposes one, else `null` (§ 3, § 15). */
  readonly publishedSizeBytes: number | null;
  /** Published last-modified stamp when the listing exposes one, else `null`. */
  readonly lastModified: string | null;
}

/**
 * A transcribed publisher listing for ONE period.
 *
 * `entries` may be empty — that is what an unavailable publisher looks like, and the parser reports it
 * as `unavailable` rather than as "nothing missing".
 */
export interface BrazilReceitaPublisherInventoryDocument {
  readonly publisher: unknown;
  readonly publisherHost: unknown;
  readonly sourceKey: unknown;
  readonly period: unknown;
  readonly retrievedAt: unknown;
  readonly retrievalMethod: unknown;
  readonly inventorySource: unknown;
  readonly inventoryTransform: unknown;
  readonly entries: readonly BrazilReceitaPublisherInventoryEntry[] | unknown;
}

// ─── The artifact: Receita Federal, 2026-07, transcribed verbatim ─────────────

/**
 * When the listing below was retrieved. Fixed, because the artifact is a snapshot and a snapshot with a
 * moving timestamp is not reproducible.
 */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_RETRIEVED_AT = '2026-08-11T14:43:57Z' as const;

/**
 * The official 2026-07 listing. 37 entries: 10 Empresas parts, 10 Estabelecimentos parts, 10 Socios
 * parts (excluded), and 7 single-file lookup/regime families.
 *
 * Ordinals are `0`–`9` because that is what the publisher published for THIS period — not because
 * earlier months looked the same (§ 4).
 */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07: BrazilReceitaPublisherInventoryDocument = {
  publisher: BRAZIL_RECEITA_PUBLISHER_SOURCE,
  publisherHost: BRAZIL_RECEITA_PUBLISHER_HOST,
  sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  period: '2026-07',
  retrievedAt: BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_RETRIEVED_AT,
  retrievalMethod: BRAZIL_RECEITA_PUBLISHER_RETRIEVAL_METHOD,
  inventorySource: BRAZIL_RECEITA_PUBLISHER_INVENTORY_SOURCE,
  inventoryTransform: BRAZIL_RECEITA_PUBLISHER_INVENTORY_TRANSFORM,
  entries: [
    { name: 'Cnaes.zip', publishedSizeBytes: 22078, lastModified: 'Sun, 12 Jul 2026 18:20:08 GMT' },
    { name: 'Empresas0.zip', publishedSizeBytes: 544290225, lastModified: 'Sun, 12 Jul 2026 18:20:48 GMT' },
    { name: 'Empresas1.zip', publishedSizeBytes: 77888891, lastModified: 'Sun, 12 Jul 2026 18:20:56 GMT' },
    { name: 'Empresas2.zip', publishedSizeBytes: 79116294, lastModified: 'Sun, 12 Jul 2026 18:21:04 GMT' },
    { name: 'Empresas3.zip', publishedSizeBytes: 85108747, lastModified: 'Sun, 12 Jul 2026 18:21:11 GMT' },
    { name: 'Empresas4.zip', publishedSizeBytes: 90243240, lastModified: 'Sun, 12 Jul 2026 18:21:20 GMT' },
    { name: 'Empresas5.zip', publishedSizeBytes: 97345876, lastModified: 'Sun, 12 Jul 2026 18:21:28 GMT' },
    { name: 'Empresas6.zip', publishedSizeBytes: 94246070, lastModified: 'Sun, 12 Jul 2026 18:21:36 GMT' },
    { name: 'Empresas7.zip', publishedSizeBytes: 98748860, lastModified: 'Sun, 12 Jul 2026 18:21:45 GMT' },
    { name: 'Empresas8.zip', publishedSizeBytes: 98830257, lastModified: 'Sun, 12 Jul 2026 18:21:54 GMT' },
    { name: 'Empresas9.zip', publishedSizeBytes: 94399229, lastModified: 'Sun, 12 Jul 2026 18:22:02 GMT' },
    { name: 'Estabelecimentos0.zip', publishedSizeBytes: 2164567397, lastModified: 'Sun, 12 Jul 2026 18:24:40 GMT' },
    { name: 'Estabelecimentos1.zip', publishedSizeBytes: 341578424, lastModified: 'Sun, 12 Jul 2026 18:25:11 GMT' },
    { name: 'Estabelecimentos2.zip', publishedSizeBytes: 336376100, lastModified: 'Sun, 12 Jul 2026 18:25:38 GMT' },
    { name: 'Estabelecimentos3.zip', publishedSizeBytes: 367052398, lastModified: 'Sun, 12 Jul 2026 18:26:07 GMT' },
    { name: 'Estabelecimentos4.zip', publishedSizeBytes: 340421684, lastModified: 'Sun, 12 Jul 2026 18:26:33 GMT' },
    { name: 'Estabelecimentos5.zip', publishedSizeBytes: 336378631, lastModified: 'Sun, 12 Jul 2026 18:26:59 GMT' },
    { name: 'Estabelecimentos6.zip', publishedSizeBytes: 368109911, lastModified: 'Sun, 12 Jul 2026 18:27:28 GMT' },
    { name: 'Estabelecimentos7.zip', publishedSizeBytes: 340694903, lastModified: 'Sun, 12 Jul 2026 18:27:53 GMT' },
    { name: 'Estabelecimentos8.zip', publishedSizeBytes: 334764377, lastModified: 'Sun, 12 Jul 2026 18:28:19 GMT' },
    { name: 'Estabelecimentos9.zip', publishedSizeBytes: 368970563, lastModified: 'Sun, 12 Jul 2026 18:28:47 GMT' },
    { name: 'Motivos.zip', publishedSizeBytes: 1180, lastModified: 'Sun, 12 Jul 2026 18:28:48 GMT' },
    { name: 'Municipios.zip', publishedSizeBytes: 43443, lastModified: 'Sun, 12 Jul 2026 18:28:49 GMT' },
    { name: 'Naturezas.zip', publishedSizeBytes: 1563, lastModified: 'Sun, 12 Jul 2026 18:28:50 GMT' },
    { name: 'Paises.zip', publishedSizeBytes: 2745, lastModified: 'Sun, 12 Jul 2026 18:28:51 GMT' },
    { name: 'Qualificacoes.zip', publishedSizeBytes: 980, lastModified: 'Sun, 12 Jul 2026 18:28:52 GMT' },
    { name: 'Simples.zip', publishedSizeBytes: 299744806, lastModified: 'Sun, 12 Jul 2026 18:29:17 GMT' },
    { name: 'Socios0.zip', publishedSizeBytes: 239973433, lastModified: 'Sun, 12 Jul 2026 18:29:34 GMT' },
    { name: 'Socios1.zip', publishedSizeBytes: 49645387, lastModified: 'Sun, 12 Jul 2026 18:29:39 GMT' },
    { name: 'Socios2.zip', publishedSizeBytes: 49205177, lastModified: 'Sun, 12 Jul 2026 18:29:45 GMT' },
    { name: 'Socios3.zip', publishedSizeBytes: 49224762, lastModified: 'Sun, 12 Jul 2026 18:29:50 GMT' },
    { name: 'Socios4.zip', publishedSizeBytes: 49588399, lastModified: 'Sun, 12 Jul 2026 18:29:55 GMT' },
    { name: 'Socios5.zip', publishedSizeBytes: 49481449, lastModified: 'Sun, 12 Jul 2026 18:30:00 GMT' },
    { name: 'Socios6.zip', publishedSizeBytes: 49250249, lastModified: 'Sun, 12 Jul 2026 18:30:05 GMT' },
    { name: 'Socios7.zip', publishedSizeBytes: 49148909, lastModified: 'Sun, 12 Jul 2026 18:30:10 GMT' },
    { name: 'Socios8.zip', publishedSizeBytes: 49787076, lastModified: 'Sun, 12 Jul 2026 18:30:16 GMT' },
    { name: 'Socios9.zip', publishedSizeBytes: 49109391, lastModified: 'Sun, 12 Jul 2026 18:30:21 GMT' },
  ],
};

/**
 * SHA-256 of the canonical normalization of the listing above (`name|size` per line, sorted, LF).
 *
 * Recorded so a future reader can prove the artifact was not edited in place, and computed OUTSIDE this
 * module: hashing here would mean importing a digest and re-deriving the value the constant exists to
 * pin. The dedicated test recomputes it from `canonicalBrazilReceitaPublisherInventoryText`.
 */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07_CANONICAL_SHA256 =
  '6c945a29dc1c59940e248acf0c66dca4ab9941210130636c628d872bcf614c69' as const;

/** The period this milestone resolved. Nothing here speaks for any other period. */
export const BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS: readonly string[] = ['2026-07'];

// ─── Parse results ────────────────────────────────────────────────────────────

/**
 * Why a listing is not authoritative. Fixed codes; none embeds a path, a host string or a figure.
 */
export const BRAZIL_RECEITA_PUBLISHER_INVENTORY_REFUSALS = [
  'publisher_document_absent',
  'publisher_entries_unusable',
  'publisher_entries_empty',
  'publisher_host_unexpected',
  'publisher_source_not_official',
  'publisher_transform_not_deterministic',
  'publisher_source_key_unexpected',
  'publisher_period_absent',
  'publisher_period_mismatch',
  'publisher_retrieval_provenance_incomplete',
  'publisher_entry_name_unparseable',
  'publisher_entry_duplicate',
  'publisher_entry_size_invalid',
  'publisher_family_part_ordinal_gap',
  'publisher_family_part_shape_ambiguous',
  'publisher_required_family_absent',
] as const;

export type BrazilReceitaPublisherInventoryRefusal =
  (typeof BRAZIL_RECEITA_PUBLISHER_INVENTORY_REFUSALS)[number];

/**
 * `verified` is the only status that may support a `complete` verdict downstream.
 *
 * `unavailable` means there was nothing to read; `ambiguous` means there was something and it could not
 * be trusted. Both resolve to `indeterminate` at the gate, and the split is kept because the owner's
 * next action differs: chase the publisher, or reconcile a listing that disagrees with itself.
 */
export type BrazilReceitaPublisherInventoryStatus = 'verified' | 'unavailable' | 'ambiguous';

/** One published part, with its identity preserved (§ 14). */
export interface BrazilReceitaPublisherPart {
  /** Opaque ordinal label — `'0'`…`'9'`, or `'single'`. Never a file name. */
  readonly partKey: string;
  /** The exact published file name. Evidence, and never forwarded to the gate. */
  readonly fileName: string;
  readonly publishedSizeBytes: number | null;
  readonly lastModified: string | null;
}

export interface BrazilReceitaPublisherFamily {
  readonly family: string;
  readonly parts: readonly BrazilReceitaPublisherPart[];
}

export interface BrazilReceitaPublisherInventoryParseResult {
  readonly status: BrazilReceitaPublisherInventoryStatus;
  readonly refusals: readonly BrazilReceitaPublisherInventoryRefusal[];
  readonly period: string | null;
  readonly retrievedAt: string | null;
  /** Required families, in contract order. Empty unless every one of them was published. */
  readonly requiredFamilies: readonly BrazilReceitaPublisherFamily[];
  /** Optional lookup/regime families the pipeline contract recognizes. */
  readonly lookupFamilies: readonly BrazilReceitaPublisherFamily[];
  /** Published families outside the pipeline contract. Recorded, never expected, never input. */
  readonly outOfContractFamilies: readonly BrazilReceitaPublisherFamily[];
  /** Person-linked families. Transcribed and refused (§ 4). */
  readonly excludedPersonLinkedFamilies: readonly BrazilReceitaPublisherFamily[];
  /** Structural assertions. There is no code path that could change them (§ 16). */
  readonly rowsRead: 0;
  readonly filesOpened: 0;
  readonly requestsPerformed: 0;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const PUBLISHED_ENTRY_PATTERN = /^([A-Za-z][A-Za-z_-]*?)(\d*)\.zip$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A family label is person-linked if it contains any denylisted token. */
export function isBrazilReceitaPersonLinkedFamily(family: string): boolean {
  const normalized = family.trim().toLowerCase();
  return BRAZIL_RECEITA_PUBLISHER_PERSON_LINKED_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

/**
 * The canonical normalization a hash is taken over: `name|size` per entry, sorted by name, LF-terminated.
 *
 * Deterministic and total — an entry with no published size contributes an empty size field rather than
 * being dropped, so a listing that stops exposing sizes changes the hash instead of silently matching.
 */
export function canonicalBrazilReceitaPublisherInventoryText(
  document: BrazilReceitaPublisherInventoryDocument,
): string {
  const entries = Array.isArray(document.entries)
    ? (document.entries as readonly BrazilReceitaPublisherInventoryEntry[])
    : [];
  return entries
    .map((entry) => `${entry.name}|${entry.publishedSizeBytes ?? ''}`)
    .sort()
    .map((line) => `${line}\n`)
    .join('');
}

/**
 * Validates a transcribed listing and groups it into families, fail-closed (§ 6).
 *
 * Returns EVERY refusal rather than the first, so an owner reconciling a listing sees the whole problem.
 * A refusal never yields a partial expected inventory: `requiredFamilies` is emptied unless the status is
 * `verified`, because § 12 forbids comparing a local set against a half-trusted list.
 */
export function parseBrazilReceitaPublisherInventory(
  document: BrazilReceitaPublisherInventoryDocument | null | undefined,
  expectedPeriod: string,
): BrazilReceitaPublisherInventoryParseResult {
  const refusals: BrazilReceitaPublisherInventoryRefusal[] = [];
  const add = (code: BrazilReceitaPublisherInventoryRefusal): void => {
    if (!refusals.includes(code)) refusals.push(code);
  };

  const empty = (
    status: BrazilReceitaPublisherInventoryStatus,
    period: string | null,
    retrievedAt: string | null,
  ): BrazilReceitaPublisherInventoryParseResult => ({
    status,
    refusals,
    period,
    retrievedAt,
    requiredFamilies: [],
    lookupFamilies: [],
    outOfContractFamilies: [],
    excludedPersonLinkedFamilies: [],
    rowsRead: 0,
    filesOpened: 0,
    requestsPerformed: 0,
  });

  // ── Absent document: nothing was retrieved. `unavailable`, and it short-circuits: running the
  //    remaining checks against `null` would emit six provenance refusals about a listing nobody has.
  if (document === null || document === undefined) {
    add('publisher_document_absent');
    return empty('unavailable', null, null);
  }

  const period = isNonEmptyString(document.period) ? document.period.trim() : null;
  const retrievedAt = isNonEmptyString(document.retrievedAt) ? document.retrievedAt.trim() : null;

  // ── Provenance, before content. A well-formed listing from the wrong place is still refused.
  if (document.publisherHost !== BRAZIL_RECEITA_PUBLISHER_HOST) add('publisher_host_unexpected');
  if (
    document.publisher !== BRAZIL_RECEITA_PUBLISHER_SOURCE ||
    document.inventorySource !== BRAZIL_RECEITA_PUBLISHER_INVENTORY_SOURCE
  ) {
    add('publisher_source_not_official');
  }
  if (document.inventoryTransform !== BRAZIL_RECEITA_PUBLISHER_INVENTORY_TRANSFORM) {
    add('publisher_transform_not_deterministic');
  }
  if (document.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY) add('publisher_source_key_unexpected');
  if (!isNonEmptyString(document.retrievalMethod) || retrievedAt === null) {
    add('publisher_retrieval_provenance_incomplete');
  }

  // ── Period must be EXACT. Not "close", not "the latest", not another month (§ 2).
  if (period === null) add('publisher_period_absent');
  else if (period !== expectedPeriod) add('publisher_period_mismatch');

  // ── Entries.
  if (!Array.isArray(document.entries)) {
    add('publisher_entries_unusable');
    return empty('ambiguous', period, retrievedAt);
  }
  const entries = document.entries as readonly BrazilReceitaPublisherInventoryEntry[];
  if (entries.length === 0) {
    add('publisher_entries_empty');
    // An empty listing is nothing-was-published, not a malformed listing.
    return empty(refusals.length > 1 ? 'ambiguous' : 'unavailable', period, retrievedAt);
  }

  const seenNames = new Set<string>();
  const grouped = new Map<string, BrazilReceitaPublisherPart[]>();

  for (const entry of entries) {
    if (!isNonEmptyString(entry?.name)) {
      add('publisher_entry_name_unparseable');
      continue;
    }
    const name = entry.name.trim();
    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      add('publisher_entry_duplicate');
      continue;
    }
    seenNames.add(normalizedName);

    const match = PUBLISHED_ENTRY_PATTERN.exec(name);
    if (match === null) {
      add('publisher_entry_name_unparseable');
      continue;
    }
    const size = entry.publishedSizeBytes;
    if (size !== null && !(typeof size === 'number' && Number.isInteger(size) && size >= 0)) {
      add('publisher_entry_size_invalid');
      continue;
    }

    const family = match[1].toLowerCase();
    const ordinal = match[2];
    const parts = grouped.get(family) ?? [];
    parts.push({
      partKey: ordinal === '' ? BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY : ordinal,
      fileName: name,
      publishedSizeBytes: size ?? null,
      lastModified: isNonEmptyString(entry.lastModified) ? entry.lastModified.trim() : null,
    });
    grouped.set(family, parts);
  }

  // ── Per-family shape: contiguous ordinals from 0, or exactly one singleton. Never both.
  const families: BrazilReceitaPublisherFamily[] = [];
  for (const [family, parts] of grouped) {
    const singletons = parts.filter(
      (part) => part.partKey === BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY,
    );
    const numbered = parts.filter(
      (part) => part.partKey !== BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY,
    );
    if (singletons.length > 0 && numbered.length > 0) {
      // `Empresas.zip` alongside `Empresas0.zip` — the publisher's own listing does not say which one
      // the period consists of, and guessing is exactly what § 6 refuses.
      add('publisher_family_part_shape_ambiguous');
      continue;
    }
    if (singletons.length > 1) {
      add('publisher_entry_duplicate');
      continue;
    }
    if (numbered.length > 0) {
      const ordinals = numbered
        .map((part) => Number.parseInt(part.partKey, 10))
        .sort((left, right) => left - right);
      const contiguousFromZero = ordinals.every((value, index) => value === index);
      if (!contiguousFromZero) add('publisher_family_part_ordinal_gap');
    }
    families.push({
      family,
      parts: [...parts].sort((left, right) => left.partKey.localeCompare(right.partKey)),
    });
  }

  const byFamily = new Map(families.map((entry) => [entry.family, entry]));

  const personLinked = families.filter((entry) => isBrazilReceitaPersonLinkedFamily(entry.family));
  const required: BrazilReceitaPublisherFamily[] = [];
  for (const name of BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES) {
    const found = byFamily.get(name);
    if (found === undefined || found.parts.length === 0) {
      add('publisher_required_family_absent');
      continue;
    }
    required.push(found);
  }
  const lookups = BRAZIL_RECEITA_PUBLISHER_LOOKUP_FAMILIES.map((name) => byFamily.get(name)).filter(
    (entry): entry is BrazilReceitaPublisherFamily => entry !== undefined,
  );
  const outOfContract = families.filter(
    (entry) =>
      !BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES.includes(entry.family) &&
      !BRAZIL_RECEITA_PUBLISHER_LOOKUP_FAMILIES.includes(entry.family) &&
      !isBrazilReceitaPersonLinkedFamily(entry.family),
  );

  if (refusals.length > 0) {
    const result = empty('ambiguous', period, retrievedAt);
    // The person-linked classification survives an ambiguous listing: it is the one fact whose meaning
    // does not depend on the rest of the document being trustworthy.
    return { ...result, excludedPersonLinkedFamilies: personLinked };
  }

  return {
    status: 'verified',
    refusals,
    period,
    retrievedAt,
    requiredFamilies: required,
    lookupFamilies: lookups,
    outOfContractFamilies: outOfContract,
    excludedPersonLinkedFamilies: personLinked,
    rowsRead: 0,
    filesOpened: 0,
    requestsPerformed: 0,
  };
}

// ─── Derivation into the 14B.0J gate's input (§ 14) ───────────────────────────

/** The count, DERIVED from the identity list. Never a literal (§ 14). */
export function deriveBrazilReceitaExpectedPartCount(family: BrazilReceitaPublisherFamily): number {
  return family.parts.length;
}

/** Exact expected part identities for one family, sorted. The source of truth for comparison. */
export function deriveBrazilReceitaExpectedPartKeys(
  parsed: BrazilReceitaPublisherInventoryParseResult,
  family: string,
): readonly string[] {
  const found = [...parsed.requiredFamilies, ...parsed.lookupFamilies].find(
    (entry) => entry.family === family,
  );
  if (found === undefined) return [];
  return found.parts.map((part) => part.partKey).sort();
}

/**
 * Builds the 14B.0J gate's expected inventory from a VERIFIED listing, or `null`.
 *
 * `null` on anything short of `verified` is the whole point: the gate handles a null expectation as
 * `indeterminate`, so an unavailable or ambiguous publisher cannot become a completeness claim by
 * passing through this function. Required families only — a lookup family is optional by contract, and
 * an expectation the gate would then enforce as mandatory would invent a requirement.
 */
export function deriveBrazilReceitaNationalExpectedInventory(
  parsed: BrazilReceitaPublisherInventoryParseResult,
): BrazilReceitaNationalExpectedInventory | null {
  if (parsed.status !== 'verified' || parsed.period === null) return null;
  return {
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    period: parsed.period,
    provenance: BRAZIL_RECEITA_PUBLISHER_DERIVED_PROVENANCE,
    families: parsed.requiredFamilies.map((family) => ({
      family: family.family,
      expectedPartCount: deriveBrazilReceitaExpectedPartCount(family),
    })),
  };
}

/** The parse of the artifact this milestone landed, for callers that want the resolved period directly. */
export function parseBrazilReceitaPublisherInventory2026_07(): BrazilReceitaPublisherInventoryParseResult {
  return parseBrazilReceitaPublisherInventory(BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07, '2026-07');
}
