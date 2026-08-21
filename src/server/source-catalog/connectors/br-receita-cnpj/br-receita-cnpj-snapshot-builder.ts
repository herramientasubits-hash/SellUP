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
 *
 * ── BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING ──────────────────────────────────────
 * Identity resolution above is INTERNAL and unchanged: the builder still assembles
 * the full CNPJ from its parts, DV-validates it, derives `tax:<normalized_14>`, and
 * rejects duplicates on it. What changed is what SURVIVES: no part of the CNPJ —
 * root, order, DV, full, normalized, identity key, or any hash/truncation of them —
 * is carried into a materialized snapshot or rejection row. The GATE-1 owner
 * approval record, R4, makes CNPJ básico and full CNPJ categorically non-printable
 * and non-persistible, "no hash, truncation or fingerprint of either, anywhere".
 *
 * The old `assertSanitizedRawData` guard inspected KEYS ONLY, so it could not see a
 * prohibited VALUE under a permitted key — which is exactly how `cnpj_root` (the
 * CNPJ básico) passed it. Every built row now goes through
 * `br-receita-cnpj-snapshot-output-sanitizer.ts`, which checks KEYS **and** VALUES
 * against a closed typed allowlist and additionally proves no set of surviving
 * fields recombines into a DV-valid CNPJ.
 */

import { normalizeBrazilCnpj, buildBrazilCnpjRecordIdentityKey } from './br-cnpj';
import {
  sanitizeBrReceitaCnpjSnapshotRow,
  sanitizeBrReceitaCnpjRejectionRow,
  type BrReceitaCnpjSnapshotSanitizerResult,
} from './br-receita-cnpj-snapshot-output-sanitizer';
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
 * Fail-closed output guard. Runs the KEY **and** VALUE sanitizer over a built row
 * and throws if anything prohibited survived. The message names the finding KINDS
 * and sanitized key PATHS only — never a value, so the guard itself cannot become
 * the leak it exists to prevent.
 */
function assertSanitizedOutput(
  result: BrReceitaCnpjSnapshotSanitizerResult,
  surface: 'snapshot' | 'rejection',
): void {
  if (result.ok) return;
  const detail = result.findings.map((f) => `${f.kind}@${f.path}`).join(', ');
  throw new BrReceitaCnpjForbiddenSourceError(
    `BR Receita CNPJ parser: ${surface} output sanitization violation — ${detail}`,
  );
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

  const reject = (
    sourceRowIndex: number,
    reasonCode: BrReceitaCnpjRejectedRow['reasonCode'],
  ): void => {
    const row: BrReceitaCnpjRejectedRow = { sourceRowIndex, reasonCode, sourceFile };
    assertSanitizedOutput(sanitizeBrReceitaCnpjRejectionRow(row), 'rejection');
    rejected.push(row);
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

      // GATE-3 hardening: no cnpj_root / cnpj_order / cnpj_dv. `normalizedTaxId`
      // stays a local — it drives dedup below and is never written out.
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

    const snapshot: BrReceitaCnpjSnapshotRow = {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_year: input.sourceYear,
      legal_name: normalizeText(empresa.razao_social),
      raw_data: rawData,
    };
    assertSanitizedOutput(sanitizeBrReceitaCnpjSnapshotRow(snapshot), 'snapshot');
    snapshots.push(snapshot);
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
