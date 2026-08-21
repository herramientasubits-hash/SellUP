/**
 * BR Receita CNPJ — Offline local/sample parser (snapshot builder).
 *
 * Hito: BR-SOURCE-2 — Receita CNPJ local/sample parser.
 *
 * Converts raw EMPRESAS + ESTABELECIMENTOS (+ SIMPLES + reference lookups) rows
 * into sanitized rows shaped for `source_company_snapshots`, in a later,
 * separately-approved writer milestone. This hito does NOT persist:
 *   - NO Supabase / DB writes, NO migrations.
 *   - NO dataset download / import (fixtures are synthetic).
 *   - NO runtime enrichment, NO Agent 1 integration, NO providers.
 *   - NO HubSpot / Slack.
 * It is a PURE in-memory transform (mirrors the EC SCVS offline builder).
 *
 * Identity (data-contract § 3): family = TAX_GRAIN. The physical grain is one
 * row per establishment = one full 14-position CNPJ; record identity is
 * `tax:<normalized_14>`, normalized_tax_id = normalized full CNPJ.
 *
 * Fail-closed rules (§ 3.4 / § 6):
 *   - CNPJ that fails DV validation → rejected (never relax the validator).
 *   - duplicate full CNPJ within the input → rejected.
 *   - establishment with no matching EMPRESAS root → rejected.
 *   - incompatible duplicate EMPRESAS root → its establishments rejected.
 *   - SOCIOS / QSA / CPF anywhere in the input → hard error (never processed).
 *   - contact fields / fine address are never mapped into output (§ 5.3).
 */

import {
  normalizeBrazilCnpj,
  buildBrazilCnpjRecordIdentityKey,
  stripBrazilCnpjPunctuationAndUpper,
} from './br-cnpj';
// 🔴 BR-SOURCE-GATE-ROUND-1 — the CANONICAL alphanumeric-aware, DV-validated CNPJ detector. Reused,
// never re-implemented: a second definition of "CNPJ-shaped" here would drift from the one the
// classifier, the dry-run guard, the report sanitizer and the metric channel already share.
import { containsBrazilCnpjLikeIdentifier } from './br-receita-cnpj-identifier-shape';
import {
  BR_RECEITA_CNPJ_SOURCE_KEY,
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_PARSER_VERSION,
  type BrReceitaCnpjParserInput,
  type BrReceitaCnpjParserResult,
  type BrReceitaCnpjSnapshotRow,
  type BrReceitaCnpjSnapshotRawData,
  type BrReceitaCnpjRejectedRow,
  type BrReceitaEmpresaRow,
  type BrReceitaLookupRow,
  type BrReceitaSimplesRow,
} from './br-receita-cnpj-types';
import type { RecordIdentityKey } from '../../record-identity';

/** Raised when a categorically forbidden source (SOCIOS/QSA/CPF) is supplied. */
export class BrReceitaCnpjForbiddenSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrReceitaCnpjForbiddenSourceError';
  }
}

/** Keys that indicate personal-data sources — never accepted as input. */
const FORBIDDEN_SOURCE_KEY_TOKENS = ['socio', 'qsa', 'cpf', 'representante', 'faixa_etaria'];
/** Tokens that must never appear as a built raw_data output key (§ 5.3). */
const FORBIDDEN_OUTPUT_KEY_TOKENS = [
  'socio',
  'qsa',
  'cpf',
  'representante',
  'telefone',
  'fax',
  'correio',
  'ddd',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cep',
];

function keyHasToken(key: string, tokens: string[]): boolean {
  const lower = key.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

function assertValidSourceYear(sourceYear: unknown): asserts sourceYear is number {
  if (typeof sourceYear !== 'number' || !Number.isInteger(sourceYear) || sourceYear <= 0) {
    throw new BrReceitaCnpjForbiddenSourceError(
      `BR Receita CNPJ parser: sourceYear must be a positive integer, received: ${String(sourceYear)}`,
    );
  }
}

/**
 * Fail-closed guard: rejects any input carrying SOCIOS/QSA/CPF data, whether as
 * a top-level file field or as keys on any supplied row.
 */
function assertNoForbiddenPersonalDataSource(input: BrReceitaCnpjParserInput): void {
  const record = input as unknown as Record<string, unknown>;
  for (const topKey of Object.keys(record)) {
    if (keyHasToken(topKey, FORBIDDEN_SOURCE_KEY_TOKENS)) {
      throw new BrReceitaCnpjForbiddenSourceError(
        `BR Receita CNPJ parser: forbidden personal-data source field "${topKey}" (SOCIOS/QSA/CPF are never processed)`,
      );
    }
  }
  const rowGroups: Array<Array<Record<string, unknown>>> = [
    input.empresasRows as unknown as Array<Record<string, unknown>>,
    input.estabelecimentosRows as unknown as Array<Record<string, unknown>>,
    (input.simplesRows ?? []) as unknown as Array<Record<string, unknown>>,
  ];
  for (const rows of rowGroups) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (keyHasToken(key, FORBIDDEN_SOURCE_KEY_TOKENS)) {
          throw new BrReceitaCnpjForbiddenSourceError(
            `BR Receita CNPJ parser: forbidden personal-data field "${key}" detected on a source row`,
          );
        }
      }
    }
  }
}

/**
 * The identifier material of the row being built, in canonical comparison form.
 *
 * Held per row and never across rows: the question this sanitizer answers is "did THIS row's own
 * CNPJ leak into THIS row's output?", and a cross-row set would turn one row's identifier into a
 * reason to reject a different row's benign value.
 */
type RowIdentifierMaterial = {
  /** The full 14-position CNPJ, normalized. */
  readonly full: string;
  /** The CNPJ básico (raiz, 8 positions), normalized. */
  readonly basico: string;
};

/**
 * 🔴 BR-SOURCE-GATE-ROUND-1 — the sanitizer now inspects KEYS **and** VALUES.
 *
 * Key-only was the defect. `FORBIDDEN_OUTPUT_KEY_TOKENS` never contained `cnpj_root`, so the block
 * that called itself "allowlist only" emitted the CNPJ básico under a permitted key and its own
 * guard reported no violation. Renaming the key would have been enough to defeat it.
 *
 * Three checks, in the order a reader should think about them:
 *
 *   1. the forbidden KEY tokens, unchanged;
 *   2. any value carrying a DV-valid CNPJ-shaped substring — via the canonical detector, so
 *      alphanumeric CNPJs (official from July 2026) are caught too;
 *   3. any value carrying THIS row's own full CNPJ or its básico, compared in canonical form.
 *
 * ── 🔴 Why check 3 is derivation-based and not shape-based ───────────────────
 *
 * A blunt "eight continuous digits is a básico" rule — which the public REPORT sanitizer can afford,
 * because a report carries aggregates — would be wrong here and would fire constantly. Receita's
 * `data_inicio_atividade` is `YYYYMMDD`: exactly eight digits. `capital_social` can normalize to
 * eight or more. Those are the benign business values this output exists to carry, and rejecting
 * them would make the guard useless in the only place it runs.
 *
 * So the básico is matched against the ONE value that is actually forbidden for this row: the básico
 * of the record being built. A date is not that value, unless it coincidentally equals it — in which
 * case fail-closed is the correct outcome and the row is rejected rather than published.
 *
 * ── What is deliberately NOT checked ────────────────────────────────────────
 *
 * The 4-position `cnpj_ordem` and the 2-position DV are NOT matched by containment. Four digits
 * occur inside legitimate values constantly — a municipality code, a CNAE code, a year, part of a
 * capital figure — and matching them would reject nearly every real row. They are removed
 * STRUCTURALLY instead: no field carries them, and neither is reconstructable from what remains.
 */
function assertSanitizedRawData(
  rawData: BrReceitaCnpjSnapshotRawData,
  identifier: RowIdentifierMaterial,
): void {
  for (const key of Object.keys(rawData)) {
    if (keyHasToken(key, FORBIDDEN_OUTPUT_KEY_TOKENS)) {
      throw new BrReceitaCnpjForbiddenSourceError(
        `BR Receita CNPJ parser: raw_data sanitization violation — forbidden key "${key}"`,
      );
    }
  }

  for (const [key, value] of Object.entries(rawData as unknown as Record<string, unknown>)) {
    for (const leaf of Array.isArray(value) ? value : [value]) {
      if (typeof leaf !== 'string' || leaf.length === 0) continue;
      assertValueCarriesNoCnpjMaterial(key, leaf, identifier);
    }
  }
}

/**
 * Rejects one leaf value that carries CNPJ material. The message names the KEY and the KIND of
 * violation, never the value: a guard that printed what it caught would be the leak it prevents.
 */
function assertValueCarriesNoCnpjMaterial(
  key: string,
  value: string,
  identifier: RowIdentifierMaterial,
): void {
  if (containsBrazilCnpjLikeIdentifier(value)) {
    throw new BrReceitaCnpjForbiddenSourceError(
      `BR Receita CNPJ parser: raw_data sanitization violation — key "${key}" carries a CNPJ-shaped, DV-valid value`,
    );
  }

  const canonical = stripBrazilCnpjPunctuationAndUpper(value);
  if (canonical.length === 0) return;

  if (identifier.full.length > 0 && canonical.includes(identifier.full)) {
    throw new BrReceitaCnpjForbiddenSourceError(
      `BR Receita CNPJ parser: raw_data sanitization violation — key "${key}" carries the row's full CNPJ`,
    );
  }
  if (identifier.basico.length > 0 && canonical.includes(identifier.basico)) {
    throw new BrReceitaCnpjForbiddenSourceError(
      `BR Receita CNPJ parser: raw_data sanitization violation — key "${key}" carries the row's CNPJ básico`,
    );
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function parseSimNao(value: unknown): boolean | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  if (v === 'S') return true;
  if (v === 'N') return false;
  return null;
}

function splitCnaeSecondary(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[^A-Za-z0-9]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function buildLookup(rows: BrReceitaLookupRow[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    const code = normalizeText(row.codigo);
    const label = normalizeText(row.descricao);
    if (code !== null && label !== null && !map.has(code)) {
      map.set(code, label);
    }
  }
  return map;
}

/**
 * Indexes EMPRESAS by cnpj_basico. A basico that appears twice with
 * incompatible content is flagged (fail-closed): its establishments are later
 * rejected instead of guessing which root is authoritative.
 */
function indexEmpresas(rows: BrReceitaEmpresaRow[]): {
  byBasico: Map<string, BrReceitaEmpresaRow>;
  conflicted: Set<string>;
} {
  const byBasico = new Map<string, BrReceitaEmpresaRow>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    const basico = normalizeText(row.cnpj_basico);
    if (basico === null) continue;
    const existing = byBasico.get(basico);
    if (existing === undefined) {
      byBasico.set(basico, row);
      continue;
    }
    // Same basico seen again: allow only if strictly identical company content.
    const identical =
      normalizeText(existing.razao_social) === normalizeText(row.razao_social) &&
      normalizeText(existing.natureza_juridica) === normalizeText(row.natureza_juridica) &&
      normalizeText(existing.porte_empresa) === normalizeText(row.porte_empresa) &&
      normalizeText(existing.capital_social) === normalizeText(row.capital_social);
    if (!identical) conflicted.add(basico);
  }
  return { byBasico, conflicted };
}

function indexSimples(rows: BrReceitaSimplesRow[] | undefined): Map<string, BrReceitaSimplesRow> {
  const map = new Map<string, BrReceitaSimplesRow>();
  for (const row of rows ?? []) {
    const basico = normalizeText(row.cnpj_basico);
    if (basico !== null && !map.has(basico)) map.set(basico, row);
  }
  return map;
}

/**
 * Builds sanitized BR Receita CNPJ snapshot rows from raw local/sample rows.
 * Pure: no Supabase, no disk, no network, no providers.
 *
 * @throws {BrReceitaCnpjForbiddenSourceError} if sourceYear is invalid or a
 * SOCIOS/QSA/CPF source is supplied.
 */
export function buildBrReceitaCnpjSnapshotRows(
  input: BrReceitaCnpjParserInput,
): BrReceitaCnpjParserResult {
  assertValidSourceYear(input.sourceYear);
  assertNoForbiddenPersonalDataSource(input);

  const empresas = indexEmpresas(input.empresasRows);
  const simples = indexSimples(input.simplesRows);
  const cnaeLabels = buildLookup(input.cnaesRows);
  const municipioLabels = buildLookup(input.municipiosRows);
  const naturezaLabels = buildLookup(input.naturezasRows);

  const snapshots: BrReceitaCnpjSnapshotRow[] = [];
  const rejected: BrReceitaCnpjRejectedRow[] = [];
  const seenIdentityKeys = new Set<string>();
  const sourceFile = input.sourceFileName ?? null;

  // RB-2 (BR-SOURCE-GATE-ROUND-1, closed): `safeIdentifier` used to be a truncated SHA-256 of the
  // CNPJ. GATE-1 R4 forbids a hash, truncation or fingerprint of the CNPJ anywhere, so a rejection
  // diagnostic built from one was itself a violation of the gate it was trying to respect. It carries
  // no CNPJ-derived material now: `sourceRowIndex` is already a unique, non-invertible,
  // execution-local ordinal — the row's position in this run's input — and `reasonCode` already
  // names the rejection category, so the pair fully identifies a rejection without a second,
  // CNPJ-shaped identifier alongside it.
  const reject = (
    sourceRowIndex: number,
    reasonCode: BrReceitaCnpjRejectedRow['reasonCode'],
  ): void => {
    rejected.push({
      sourceRowIndex,
      reasonCode,
      safeIdentifier: `row-${sourceRowIndex}`,
      sourceFile,
    });
  };

  for (let i = 0; i < input.estabelecimentosRows.length; i++) {
    const row = input.estabelecimentosRows[i]!;
    const rawBasico = typeof row.cnpj_basico === 'string' ? row.cnpj_basico : '';
    const rawOrdem = typeof row.cnpj_ordem === 'string' ? row.cnpj_ordem : '';
    const rawDv = typeof row.cnpj_dv === 'string' ? row.cnpj_dv : '';
    const rawFullCnpj = `${rawBasico}${rawOrdem}${rawDv}`;

    const normalization = normalizeBrazilCnpj(rawFullCnpj);
    if (normalization.status !== 'valid' || normalization.normalized === null) {
      reject(i, 'invalid_cnpj');
      continue;
    }
    const normalizedTaxId = normalization.normalized;

    const recordIdentityKey = buildBrazilCnpjRecordIdentityKey(normalizedTaxId) as RecordIdentityKey;
    if (seenIdentityKeys.has(recordIdentityKey)) {
      reject(i, 'duplicate_record_identity_key');
      continue;
    }

    const basicoKey = normalizeText(rawBasico);
    if (basicoKey === null || !empresas.byBasico.has(basicoKey)) {
      reject(i, 'missing_root_company');
      continue;
    }
    if (empresas.conflicted.has(basicoKey)) {
      reject(i, 'incompatible_root_company');
      continue;
    }

    seenIdentityKeys.add(recordIdentityKey);
    const empresa = empresas.byBasico.get(basicoKey)!;
    const simplesRow = simples.get(basicoKey);

    const naturezaCode = normalizeText(empresa.natureza_juridica);
    const statusCode = normalizeText(row.situacao_cadastral);
    const cnaeMainCode = normalizeText(row.cnae_fiscal_principal);
    const municipioCode = normalizeText(row.municipio);
    const simplesOptIn = parseSimNao(simplesRow?.opcao_simples);
    const meiOptIn = parseSimNao(simplesRow?.opcao_mei);

    const rawData: BrReceitaCnpjSnapshotRawData = {
      source_type: 'official_registry',
      human_review_required: true,
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
      source_period: normalizeText(input.sourcePeriod),
      source_row_index: i,

      // 🔴 GATE-ROUND-1 — no `cnpj_root`, no `cnpj_order`, no `cnpj_dv`. See the type.
      matrix_branch_flag: normalizeText(row.identificador_matriz_filial),

      legal_nature_code: naturezaCode,
      legal_nature_label: naturezaCode !== null ? (naturezaLabels.get(naturezaCode) ?? null) : null,
      company_size_code: normalizeText(empresa.porte_empresa),
      capital_social_value: normalizeText(empresa.capital_social),

      registration_status_code: statusCode,
      registration_status_label: null, // status labels not supplied by SIMPLES/lookups here

      cnae_main_code: cnaeMainCode,
      cnae_main_label: cnaeMainCode !== null ? (cnaeLabels.get(cnaeMainCode) ?? null) : null,
      cnae_secondary_codes: splitCnaeSecondary(row.cnae_fiscal_secundaria),

      municipality_code: municipioCode,
      municipality_name: municipioCode !== null ? (municipioLabels.get(municipioCode) ?? null) : null,
      uf: normalizeText(row.uf),

      start_date: normalizeText(row.data_inicio_atividade),

      simples_opt_in: simplesOptIn,
      simei_opt_in: meiOptIn,
      mei_flag: meiOptIn === true,
    };

    if (input.sourceFileName !== undefined) rawData.source_file_name = input.sourceFileName;
    if (input.sourceDownloadedAt !== undefined) rawData.source_downloaded_at = input.sourceDownloadedAt;
    if (input.importBatchId !== undefined) rawData.import_batch_id = input.importBatchId;

    // The row's own identifier material, in canonical form, for the value checks. The básico is
    // taken from the NORMALIZED full CNPJ rather than from `rawBasico`: a source row whose raiz
    // carried punctuation would otherwise be compared in a form the output never uses.
    assertSanitizedRawData(rawData, {
      full: stripBrazilCnpjPunctuationAndUpper(normalizedTaxId),
      basico: stripBrazilCnpjPunctuationAndUpper(normalizedTaxId).slice(0, 8),
    });

    snapshots.push({
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_year: input.sourceYear,
      tax_id: rawFullCnpj,
      normalized_tax_id: normalizedTaxId,
      legal_name: normalizeText(empresa.razao_social),
      raw_data: rawData,
      record_identity_key: recordIdentityKey,
    });
  }

  const countReason = (reason: BrReceitaCnpjRejectedRow['reasonCode']): number =>
    rejected.filter((r) => r.reasonCode === reason).length;

  return {
    snapshots,
    rejected,
    summary: {
      totalEstablishmentRows: input.estabelecimentosRows.length,
      acceptedRows: snapshots.length,
      rejectedRows: rejected.length,
      rejectedInvalidCnpj: countReason('invalid_cnpj'),
      rejectedDuplicateRecordIdentity: countReason('duplicate_record_identity_key'),
      rejectedMissingRootCompany: countReason('missing_root_company'),
      rejectedIncompatibleRootCompany: countReason('incompatible_root_company'),
      distinctRecordIdentityKeys: seenIdentityKeys.size,
      meiFlaggedRows: snapshots.filter((s) => s.raw_data.mei_flag).length,
      db_writes: 0,
      snapshot_writes: 0,
      dataset_downloads: 0,
    },
  };
}
