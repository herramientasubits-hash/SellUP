/**
 * BR Receita CNPJ — NATIONAL INVENTORY RESOLUTION: operator CLI (BR-SOURCE-14B.0K § 7–§ 13).
 *
 * Answers one question and refuses to do anything else: is the local 2026-07 input the national
 * collection, or the staged calibration subset attempt #1 already spent its authorization on?
 *
 * The expected inventory is NOT a flag. It comes from the versioned, publisher-derived artifact compiled
 * into the connector, so an operator cannot assert completeness into existence by passing a number — § 6
 * only recognizes a publisher listing as evidential, and an operator assertion resolves to
 * `indeterminate` by construction.
 *
 * ── What it reads ───────────────────────────────────────────────────────────────
 * Directory METADATA for one or two directories, one level deep, via the dedicated adapter: names,
 * regular-file flags, symlink flags, sizes. No ZIP is opened, no CSV is parsed, no row is read, nothing
 * is downloaded, extracted, copied, moved, renamed, chmod-ed or deleted. `REAL_DATA_ROWS_OPENED = 0` is
 * a property of the code path, not a mode this CLI is running in.
 *
 * ── What it prints ──────────────────────────────────────────────────────────────
 * Family labels, opaque part keys (`0`…`9`, `single`), counts, statuses and a verdict. Never a path,
 * never a directory, never a file name, never a row, never a CNPJ. Paths arrive as arguments, are used,
 * and are not echoed — including in error messages, which carry fixed codes only.
 *
 * ── What it cannot do ───────────────────────────────────────────────────────────
 * Acquire a missing part, authorize attempt #2, run a benchmark, touch the engine or the ledger, or write
 * anywhere. A `complete` verdict prints an owner AUTHORIZATION request; it does not become one.
 *
 * Usage:
 *   npm run br-source:14b0k-resolve-national-inventory -- \
 *     --period 2026-07 \
 *     --input-dir /absolute/path/to/prepared/input \
 *     [--archive-dir /absolute/path/to/staged/archives] \
 *     --declared-source-key br_receita_cnpj_dados_abertos \
 *     --declared-encoding latin1 --declared-delimiter ';' \
 *     --declared-layout-mode official_headerless
 */

import {
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
  BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0k-publisher-inventory';
import { createBrazilReceitaLocalInventoryFileSystem } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0k-local-inventory-fs';
import {
  brazilReceitaNationalResolutionNextAction,
  resolveBrazilReceitaNationalInventory,
  type BrazilReceitaLocalInventoryEntry,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0k-national-inventory-resolution';

/** Fixed refusal codes. A code never embeds a path or an operator value. */
export const BRAZIL_RECEITA_14B0K_CLI_REFUSALS = [
  'period_not_declared',
  'period_not_resolved_by_this_milestone',
  'input_dir_not_declared',
  'declaration_incomplete',
] as const;

export type BrazilReceita14B0kCliRefusal = (typeof BRAZIL_RECEITA_14B0K_CLI_REFUSALS)[number];

function readFlag(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return null;
  const value = argv[index + 1];
  return value.startsWith('--') ? null : value;
}

function fail(code: BrazilReceita14B0kCliRefusal): never {
  process.stderr.write(`REFUSED ${code}\n`);
  process.exit(2);
}

function main(argv: readonly string[]): void {
  const period = readFlag(argv, '--period');
  if (period === null) fail('period_not_declared');
  if (!BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS.includes(period)) {
    // No fallback to another period, ever (§ 2). A period without a transcribed listing has no expected
    // inventory, and inventing one from a neighbouring month is the failure this milestone exists to close.
    fail('period_not_resolved_by_this_milestone');
  }

  const inputDir = readFlag(argv, '--input-dir');
  if (inputDir === null) fail('input_dir_not_declared');
  const archiveDir = readFlag(argv, '--archive-dir');

  const declaredSourceKey = readFlag(argv, '--declared-source-key');
  const declaredEncoding = readFlag(argv, '--declared-encoding');
  const declaredDelimiter = readFlag(argv, '--declared-delimiter');
  const declaredLayoutMode = readFlag(argv, '--declared-layout-mode');
  if (
    declaredSourceKey === null ||
    declaredEncoding === null ||
    declaredDelimiter === null ||
    declaredLayoutMode === null
  ) {
    fail('declaration_incomplete');
  }

  const fileSystem = createBrazilReceitaLocalInventoryFileSystem();
  const inputEntries: readonly BrazilReceitaLocalInventoryEntry[] =
    fileSystem.listDirectoryEntries(inputDir);
  const archiveEntries: readonly BrazilReceitaLocalInventoryEntry[] | null =
    archiveDir === null ? null : fileSystem.listDirectoryEntries(archiveDir);

  const resolution = resolveBrazilReceitaNationalInventory({
    period,
    publisherDocument: BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
    inputEntries,
    archiveEntries,
    inputDeclaration: {
      sourceKey: declaredSourceKey,
      period,
      encoding: declaredEncoding,
      delimiter: declaredDelimiter,
      layoutMode: declaredLayoutMode,
    },
  });

  const lines: string[] = [
    'BR-SOURCE-14B.0K — NATIONAL INVENTORY RESOLUTION',
    `period                              ${resolution.period}`,
    `authoritative_inventory_status       ${resolution.authoritativeInventoryStatus}`,
    `publisher_refusals                   ${resolution.publisher.refusals.join(',') || 'none'}`,
    `national_input_completeness          ${resolution.nationalInputCompleteness}`,
    `gate_verdict                         ${resolution.gate.verdict}`,
    `gate_findings                        ${
      resolution.gate.findings.map((finding) => finding.code).join(',') || 'none'
    }`,
  ];

  for (const diff of resolution.requiredFamilyDiffs ?? []) {
    lines.push(
      `required ${diff.family}`,
      `  expected_parts                     ${diff.expected.join(',')}`,
      `  local_parts                        ${diff.local.join(',') || 'none'}`,
      `  missing_parts                      ${diff.missing.join(',') || 'none'}`,
      `  extra_parts                        ${diff.extra.join(',') || 'none'}`,
    );
  }
  if (resolution.requiredFamilyDiffs === null) {
    lines.push('required family comparison           SKIPPED (no authoritative inventory)');
  }

  lines.push(
    `duplicate_parts                      ${resolution.duplicateParts.length}`,
    `local_part_defects                   ${
      resolution.localPartDefects.map((finding) => finding.code).join(',') || 'none'
    }`,
    `unexpected_families                  ${resolution.unexpectedFamilies.join(',') || 'none'}`,
    `prohibited_family_present_on_disk    ${resolution.prohibitedFamilyPresentOnDisk}`,
    `prohibited_family_included_in_input  ${resolution.prohibitedFamilyIncludedInInput}`,
    `attempt_1_input_scope                ${resolution.attempt1InputScope}`,
    `attempt_2_required_input_scope       ${resolution.attempt2RequiredInputScope}`,
    `attempts_consumed                    ${resolution.attemptsConsumed}`,
    `next_real_attempt_number             ${resolution.nextRealAttemptNumber}`,
    `attempt_2_authorized                 ${resolution.attempt2Authorized}`,
    `attempt_2_executed                   ${resolution.attempt2Executed}`,
    `attempt_3_allowed                    ${resolution.attempt3Allowed}`,
    `rows_read                            ${resolution.rowsRead}`,
    `source_read_calls                    ${resolution.sourceReadCalls}`,
    `scan_executed                        ${resolution.scanExecuted}`,
    `join_executed                        ${resolution.joinExecuted}`,
    `second_real_benchmark_executed       ${resolution.secondRealBenchmarkExecuted}`,
    `next_action                          ${brazilReceitaNationalResolutionNextAction(resolution)}`,
  );

  process.stdout.write(`${lines.join('\n')}\n`);
}

main(process.argv.slice(2));
