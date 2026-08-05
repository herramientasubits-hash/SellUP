/**
 * BR Receita CNPJ — controlled execution readiness orchestrator CLI (BR-SOURCE-13H).
 *
 * Prints the controlled execution readiness report for a named SYNTHETIC fixture and a synthetic
 * reviewer position:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *                          →  13H controlled execution readiness report
 *                          →  JSON or Markdown on stdout
 *
 * This CLI has exactly three inputs — a fixture NAME, a decision VALUE and a FORMAT — and it has no
 * code path that accepts a location: there is no `--manifest`, no `--input`, no `--output`, no
 * `--path`, no `--real-data`, and no way to point it at a byte of the real dataset. It also has no
 * `--execute`, no `--run`, no `--apply`, no `--force`, no `--import` and no `--activate`, because it has
 * nothing to run and nothing to switch on: despite being named an orchestrator, it prints a `NO_GO`
 * report and exits. It writes to stdout only; it never creates a file.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A readiness report may say "the synthetic chain runs".
 *   A readiness report may NEVER say "ready", and it may never say "authorized".
 *
 *   Readiness report is not execution authorization.
 *
 * ── This CLI NEVER (fail-closed by construction) ─────────────────────────────
 *   - reads or writes a file: no filesystem module, no path module, no module-directory resolution,
 *     and no location argument of any kind.
 *   - spawns a child, opens a socket, or reads an environment variable.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - orchestrates an execution: the only thing it orchestrates is a chain of pure functions that
 *     each refuse.
 *   - approves a gate, authorizes a cap, or marks Brazil ready for import, runtime or Agent 1.
 *
 * Its only inputs are the command-line arguments; its only outputs are stdout (the report) and stderr
 * (a usage error). The report carries a STATIC timestamp, so two identical runs are byte-identical.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format json
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format json --pretty
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format markdown
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision reject --format json
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture missing-owner-artifact --decision approve --format json
 */

import {
  BRAZIL_RECEITA_READINESS_FIXTURE_NAMES,
  BRAZIL_RECEITA_READINESS_FORMATS,
  buildBrazilReceitaControlledExecutionReadinessReport,
  formatBrazilReceitaControlledExecutionReadinessReport,
  type BrazilReceitaControlledExecutionReadinessFormat,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-readiness-orchestrator';
import {
  isBrazilReceitaRequestPacketFixtureName,
  isBrazilReceitaRequestPacketFormat,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator';
import {
  BRAZIL_RECEITA_REVIEW_DECISION_VALUES,
  isBrazilReceitaReviewDecisionValue,
  type BrazilReceitaControlledExecutionReviewDecisionValue,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The only flags this CLI accepts. */
export const ALLOWED_FLAGS = ['--fixture', '--decision', '--format', '--pretty'] as const;

/**
 * Flags that would turn this into a real-data, an executing or an activating tool. Their mere presence
 * is a fail-closed usage error — this orchestrator writes a synthetic `NO_GO` report and nothing else:
 * it accepts no path, no payload, no manifest and no real-data mode, it has no run, execute, apply,
 * import or activate behaviour to reach, and `--force` is listed for the same reason as the rest, since
 * there is no refusal here that a flag could override — the refusal is the output.
 */
export const FORBIDDEN_FLAGS = [
  '--manifest',
  '--input',
  '--input-dir',
  '--output',
  '--output-dir',
  '--path',
  '--dir',
  '--file',
  '--csv',
  '--zip',
  '--real-data',
  '--execute',
  '--run',
  '--apply',
  '--force',
  '--import',
  '--activate',
  '--supabase',
  '--production',
  '--runtime',
  '--agent1',
] as const;

/** Usage error codes, so a caller can branch on the reason instead of parsing prose. */
export const READINESS_USAGE_ERROR_CODES = {
  forbiddenFlag: 'BRSOURCE13H_FORBIDDEN_ARGUMENT',
  unknownFlag: 'BRSOURCE13H_UNKNOWN_ARGUMENT',
  fixtureMissing: 'BRSOURCE13H_FIXTURE_REQUIRED',
  fixtureUnknown: 'BRSOURCE13H_FIXTURE_UNKNOWN',
  decisionMissing: 'BRSOURCE13H_DECISION_REQUIRED',
  decisionUnknown: 'BRSOURCE13H_DECISION_UNKNOWN',
  formatMissing: 'BRSOURCE13H_FORMAT_REQUIRED',
  formatUnknown: 'BRSOURCE13H_FORMAT_UNKNOWN',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReadinessCliOptions = {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly decision: BrazilReceitaControlledExecutionReviewDecisionValue;
  readonly format: BrazilReceitaControlledExecutionReadinessFormat;
  readonly pretty: boolean;
};

/** A usage error carrying its own code, so `main` never has to classify a message. */
export class ReadinessUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ReadinessUsageError';
    this.code = code;
  }
}

// ─── Argument parsing ────────────────────────────────────────────────────────

/** Renders each accepted-value list once, for every usage message that needs it. */
function fixtureList(): string {
  return BRAZIL_RECEITA_READINESS_FIXTURE_NAMES.join(', ');
}

function decisionList(): string {
  return BRAZIL_RECEITA_REVIEW_DECISION_VALUES.join('|');
}

function formatList(): string {
  return BRAZIL_RECEITA_READINESS_FORMATS.join('|');
}

/**
 * Reads the value of a `--flag value` or `--flag=value` pair, or `undefined` when the flag was given
 * without one. Returns the index to continue parsing from.
 */
function readValue(
  argv: readonly string[],
  index: number,
  inlineValue: string | undefined,
): { readonly value: string | undefined; readonly nextIndex: number } {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };

  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index + 1 };

  return { value: next, nextIndex: index + 1 };
}

/**
 * Parses `--fixture <name>`, `--decision <approve|reject|defer>`, `--format <json|markdown>` and the
 * optional `--pretty`. Everything else is rejected: a forbidden flag first (with the reason it can
 * never be supported), then any unrecognized argument, positionals included.
 *
 * @throws ReadinessUsageError on any input this CLI does not accept.
 */
export function parseReadinessArgs(argv: readonly string[]): ReadinessCliOptions {
  let fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName | undefined;
  let decision: BrazilReceitaControlledExecutionReviewDecisionValue | undefined;
  let format: BrazilReceitaControlledExecutionReadinessFormat | undefined;
  let pretty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    // `--flag=value` is normalized so a forbidden flag cannot slip through in that form.
    const equalsAt = arg.indexOf('=');
    const flag = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);

    if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new ReadinessUsageError(
        READINESS_USAGE_ERROR_CODES.forbiddenFlag,
        `${flag} is not supported and never will be. This readiness orchestrator writes a synthetic NO_GO report only: it accepts no path, no payload, no manifest and no real-data mode, it cannot run, execute, apply, import, activate or force anything, and it writes to stdout only. Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
      );
    }

    if (flag === '--pretty') {
      pretty = true;
      continue;
    }

    if (flag === '--fixture') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.fixtureMissing,
          `--fixture requires a fixture name. Known fixtures: ${fixtureList()}.`,
        );
      }

      if (!isBrazilReceitaRequestPacketFixtureName(read.value)) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.fixtureUnknown,
          `unknown fixture "${read.value}". Known fixtures: ${fixtureList()}.`,
        );
      }

      fixture = read.value;
      continue;
    }

    if (flag === '--decision') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.decisionMissing,
          `--decision requires a decision value. Accepted decisions: ${decisionList()}.`,
        );
      }

      if (!isBrazilReceitaReviewDecisionValue(read.value)) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.decisionUnknown,
          `unknown decision "${read.value}". Accepted decisions: ${decisionList()}.`,
        );
      }

      decision = read.value;
      continue;
    }

    if (flag === '--format') {
      const read = readValue(argv, index, inlineValue);
      index = read.nextIndex;

      if (read.value === undefined) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.formatMissing,
          `--format requires a format. Accepted formats: ${formatList()}.`,
        );
      }

      if (!isBrazilReceitaRequestPacketFormat(read.value)) {
        throw new ReadinessUsageError(
          READINESS_USAGE_ERROR_CODES.formatUnknown,
          `unknown format "${read.value}". Accepted formats: ${formatList()}.`,
        );
      }

      format = read.value;
      continue;
    }

    throw new ReadinessUsageError(
      READINESS_USAGE_ERROR_CODES.unknownFlag,
      `unrecognized argument "${arg}". Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
    );
  }

  if (fixture === undefined) {
    throw new ReadinessUsageError(
      READINESS_USAGE_ERROR_CODES.fixtureMissing,
      `--fixture is required. Known fixtures: ${fixtureList()}.`,
    );
  }

  if (decision === undefined) {
    throw new ReadinessUsageError(
      READINESS_USAGE_ERROR_CODES.decisionMissing,
      `--decision is required. Accepted decisions: ${decisionList()}.`,
    );
  }

  if (format === undefined) {
    throw new ReadinessUsageError(
      READINESS_USAGE_ERROR_CODES.formatMissing,
      `--format is required. Accepted formats: ${formatList()}.`,
    );
  }

  return { fixture, decision, format, pretty };
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * Exit code 0 means a report was produced — and every report is `NO_GO`, because a refusal to declare
 * readiness is the correct outcome for this tool and the refusal itself is the artefact worth reading.
 * A `NO_GO` report is not an error, so it is never reported as one. Exit code 1 means the ARGUMENTS
 * were unusable and nothing was produced.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): void {
  let options: ReadinessCliOptions;
  try {
    options = parseReadinessArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const report = buildBrazilReceitaControlledExecutionReadinessReport({
    fixtureName: options.fixture,
    reviewDecisionValue: options.decision,
  });
  const rendered = formatBrazilReceitaControlledExecutionReadinessReport(
    report,
    options.format,
    options.pretty,
  );

  process.stdout.write(`${rendered}\n`);
}

// Only auto-run when executed directly, never when imported by the test file (whose path ends with
// ".test.ts", not with this filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('br-receita-cnpj-controlled-execution-readiness-orchestrator.ts')) {
  main();
}
