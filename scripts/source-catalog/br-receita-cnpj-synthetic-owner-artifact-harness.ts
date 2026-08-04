/**
 * BR Receita CNPJ — synthetic owner artifact harness (BR-SOURCE-13C).
 *
 * Runs the SYNTHETIC end-to-end flow of the Brazil owner decision chain and prints the result as
 * JSON:
 *
 *   synthetic owner artifact  →  13A owner decision validator
 *                             →  13B controlled execution preflight evaluator
 *                             →  JSON report on stdout
 *
 * 13A and 13B are pure functions with no runner, so until now the only way to see the chain execute
 * was to read a test file. This harness is that runner. It has exactly one input — a fixture NAME —
 * and it has no code path that accepts a location: there is no `--manifest`, no `--input`, no
 * `--output`, and no way to point it at a byte of the real dataset.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   This harness demonstrates the synthetic flow.
 *   It does not authorize real execution, does not read real data, does not read the manifest,
 *   does not import, and does not activate Brazil.
 *
 *   Synthetic GO is not real-data execution authorization.
 *
 * ── This harness NEVER (fail-closed by construction) ─────────────────────────
 *   - reads or writes a file: no fs, no path module, no module-directory resolution, and no
 *     location argument of any kind.
 *   - spawns a process, opens a socket, or reads an environment variable.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *
 * Its only inputs are `process.argv`; its only outputs are stdout (the report) and stderr (a usage
 * error). The report carries a STATIC timestamp, so two runs of the same fixture are byte-identical.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-synthetic-owner-artifact-harness.ts --fixture synthetic-ready
 *   node --import tsx scripts/source-catalog/br-receita-cnpj-synthetic-owner-artifact-harness.ts --fixture synthetic-ready --pretty
 */

import {
  evaluateBrazilReceitaControlledExecutionPreflight,
  type BrazilReceitaControlledExecutionPreflightResult,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-preflight-evaluator';
import {
  BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES,
  buildBrazilReceitaSyntheticOwnerArtifactFixture,
  type BrazilReceitaSyntheticOwnerArtifactFixtureName,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Stable identity of this harness, printed in every report. */
export const HARNESS_NAME = 'br-receita-cnpj-synthetic-owner-artifact-harness' as const;

/** Report schema version. Bump only on a breaking change to the printed shape. */
export const HARNESS_REPORT_VERSION = 1 as const;

/**
 * A fixed literal instead of a clock reading. The harness must be deterministic — a caller
 * comparing two runs of the same fixture is comparing the chain's behaviour, not the time.
 */
export const HARNESS_STATIC_TIMESTAMP = 'STATIC_SYNTHETIC_TIMESTAMP' as const;

/** The only flags this harness accepts. */
export const ALLOWED_FLAGS = ['--fixture', '--pretty'] as const;

/**
 * Flags that would turn this into a real-data tool. Their mere presence is a fail-closed usage
 * error — the harness has NO code path for a location, a payload, or a real-data run.
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
  '--import',
  '--supabase',
  '--production',
  '--runtime',
  '--agent1',
] as const;

/** Usage error codes, so a caller can branch on the reason instead of parsing prose. */
export const HARNESS_USAGE_ERROR_CODES = {
  forbiddenFlag: 'BRSOURCE13C_FORBIDDEN_ARGUMENT',
  unknownFlag: 'BRSOURCE13C_UNKNOWN_ARGUMENT',
  fixtureMissing: 'BRSOURCE13C_FIXTURE_REQUIRED',
  fixtureUnknown: 'BRSOURCE13C_FIXTURE_UNKNOWN',
} as const;

/**
 * The safety facts every report restates. They are literal `false` because this harness has no
 * implementation of any of them; nothing in the code path could set one to `true`.
 */
export const HARNESS_SAFETY = {
  syntheticOnly: true,
  realDataAccessed: false,
  manifestRead: false,
  csvRead: false,
  zipRead: false,
  rowReads: false,
  joinExecuted: false,
  coverageExecuted: false,
  importExecuted: false,
  supabaseWrites: false,
  runtimeActivated: false,
  agent1Activated: false,
} as const;

/** The sentence that must accompany every GO this harness prints. */
export const HARNESS_DISCLAIMER = 'Synthetic GO is not real-data execution authorization.' as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type HarnessOptions = {
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly pretty: boolean;
};

export type HarnessReport = {
  readonly harness: typeof HARNESS_NAME;
  readonly version: typeof HARNESS_REPORT_VERSION;
  readonly fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly generatedAt: typeof HARNESS_STATIC_TIMESTAMP;
  readonly result: BrazilReceitaControlledExecutionPreflightResult;
  readonly safety: typeof HARNESS_SAFETY;
  readonly disclaimer: typeof HARNESS_DISCLAIMER;
};

/** A usage error carrying its own code, so `main` never has to classify a message. */
export class HarnessUsageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'HarnessUsageError';
    this.code = code;
  }
}

// ─── Argument parsing ────────────────────────────────────────────────────────

function isKnownFixtureName(
  value: string,
): value is BrazilReceitaSyntheticOwnerArtifactFixtureName {
  return (BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES as readonly string[]).includes(
    value,
  );
}

/** Renders the fixture list once, for every usage message that needs it. */
function fixtureList(): string {
  return BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES.join(', ');
}

/**
 * Parses `--fixture <name>` and the optional `--pretty`. Everything else is rejected: a forbidden
 * flag first (with the reason it can never be supported), then any unrecognized argument.
 *
 * @throws HarnessUsageError on any input this harness does not accept.
 */
export function parseHarnessArgs(argv: readonly string[]): HarnessOptions {
  let fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName | undefined;
  let pretty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    // `--flag=value` is normalized so a forbidden flag cannot slip through in that form.
    const equalsAt = arg.indexOf('=');
    const flag = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);

    if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new HarnessUsageError(
        HARNESS_USAGE_ERROR_CODES.forbiddenFlag,
        `${flag} is not supported and never will be. This harness runs synthetic fixtures only: it accepts no path, no payload, no manifest and no real-data mode. Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
      );
    }

    if (flag === '--pretty') {
      pretty = true;
      continue;
    }

    if (flag === '--fixture') {
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;

      if (value === undefined || value.startsWith('--')) {
        throw new HarnessUsageError(
          HARNESS_USAGE_ERROR_CODES.fixtureMissing,
          `--fixture requires a fixture name. Known fixtures: ${fixtureList()}.`,
        );
      }

      if (!isKnownFixtureName(value)) {
        throw new HarnessUsageError(
          HARNESS_USAGE_ERROR_CODES.fixtureUnknown,
          `unknown fixture "${value}". Known fixtures: ${fixtureList()}.`,
        );
      }

      fixture = value;
      continue;
    }

    throw new HarnessUsageError(
      HARNESS_USAGE_ERROR_CODES.unknownFlag,
      `unrecognized argument "${arg}". Accepted flags: ${ALLOWED_FLAGS.join(', ')}.`,
    );
  }

  if (fixture === undefined) {
    throw new HarnessUsageError(
      HARNESS_USAGE_ERROR_CODES.fixtureMissing,
      `--fixture is required. Known fixtures: ${fixtureList()}.`,
    );
  }

  return { fixture, pretty };
}

// ─── Report ──────────────────────────────────────────────────────────────────

/**
 * Builds the synthetic fixture, runs it through 13B (which delegates the artifact to 13A), and wraps
 * the verdict in a report. Pure: no I/O, no clock, no randomness.
 */
export function buildHarnessReport(
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName,
): HarnessReport {
  const request = buildBrazilReceitaSyntheticOwnerArtifactFixture(fixture);
  const result = evaluateBrazilReceitaControlledExecutionPreflight(request);

  return {
    harness: HARNESS_NAME,
    version: HARNESS_REPORT_VERSION,
    fixture,
    generatedAt: HARNESS_STATIC_TIMESTAMP,
    result,
    safety: HARNESS_SAFETY,
    disclaimer: HARNESS_DISCLAIMER,
  };
}

export function formatHarnessReport(report: HarnessReport, pretty: boolean): string {
  return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * Exit code 0 means the harness ran a known fixture — including a fixture whose verdict is
 * `blocked`, because a refusal is a correct outcome for this tool. Exit code 1 means the ARGUMENTS
 * were unusable and nothing ran.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): void {
  let options: HarnessOptions;
  try {
    options = parseHarnessArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const report = buildHarnessReport(options.fixture);
  process.stdout.write(`${formatHarnessReport(report, options.pretty)}\n`);
}

// Only auto-run when executed directly, never when imported by the test file (whose path ends with
// ".test.ts", not with this filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('br-receita-cnpj-synthetic-owner-artifact-harness.ts')) {
  main();
}
