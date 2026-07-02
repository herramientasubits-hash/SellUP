/**
 * Guardrail preventivo para importaciones masivas de fuentes estructuradas.
 *
 * Contexto: En julio 2026, una importación de rd_dgii_bulk (~493k filas, ~343 MB
 * raw_data) y pe_sunat_bulk (~978 MB) llevaron Supabase Free a Unhealthy por
 * superar el límite de database size.
 *
 * Este módulo debe ser llamado ANTES de cualquier upsert a source_company_snapshots
 * o peru_sunat_ruc_snapshot cuando `apply=true`. En dry-run siempre pasa.
 *
 * Para habilitar una importación bloqueada de forma intencional:
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true
 *   SELLUP_CONFIRMED_SOURCE_KEY=<source_key_exacto>
 *
 * Ambas variables deben estar presentes. Una sola no basta.
 *
 * Hito: 17A.6F — Guardrail anti-importaciones masivas de fuentes
 */

// ── Configuración ──────────────────────────────────────────────────────────────

/**
 * Fuentes explícitamente bloqueadas, independientemente del row count.
 * Son fuentes que ya causaron un incidente o que se sabe son masivas (P3+).
 */
export const BLOCKED_SOURCE_KEYS = ['rd_dgii_bulk', 'pe_sunat_bulk'] as const;
export type BlockedSourceKey = (typeof BLOCKED_SOURCE_KEYS)[number];

/**
 * Fuentes P1/MVP que están dentro del umbral de filas seguro.
 * Se permiten sin confirmación aunque el umbral general se active.
 */
export const SAFE_SOURCE_KEYS = ['co_siis', 'cl_chilecompra_ocds', 'co_fedesoft', 'do_dgcp', 'cr_sicop'] as const;
export type SafeSourceKey = (typeof SAFE_SOURCE_KEYS)[number];

/** Máximo de filas permitidas sin confirmación explícita. */
export const LARGE_IMPORT_ROW_THRESHOLD = 25_000;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type GuardrailInput = {
  sourceKey: string;
  countryCode: string;
  /** Filas que se van a escribir. null = desconocido / sin límite. */
  estimatedRows: number | null;
  /** Si es dry-run, el guardrail siempre permite. */
  isDryRun: boolean;
};

export type GuardrailAllowed = { allowed: true };

export type GuardrailBlocked = {
  allowed: false;
  sourceKey: string;
  countryCode: string;
  estimatedRows: number | null;
  reason: string;
  howToOverride: string;
};

export type GuardrailResult = GuardrailAllowed | GuardrailBlocked;

// ── Lógica principal ───────────────────────────────────────────────────────────

/**
 * Evalúa si una importación está permitida.
 *
 * Reglas (en orden de evaluación):
 * 1. Dry-run → siempre permitido.
 * 2. SAFE_SOURCE_KEYS con filas <= umbral → permitido.
 * 3. BLOCKED_SOURCE_KEYS → requiere override explícito.
 * 4. estimatedRows > LARGE_IMPORT_ROW_THRESHOLD o null (ilimitado) → requiere override.
 * 5. Resto → permitido.
 */
export function checkLargeImportGuardrail(
  input: GuardrailInput,
  env: Record<string, string | undefined> = process.env,
): GuardrailResult {
  const { sourceKey, countryCode, estimatedRows, isDryRun } = input;

  // Regla 1: dry-run siempre pasa
  if (isDryRun) {
    return { allowed: true };
  }

  // Regla 2: fuentes P1/seguras con filas conocidas dentro del umbral
  const isSafe = (SAFE_SOURCE_KEYS as readonly string[]).includes(sourceKey);
  if (isSafe && estimatedRows !== null && estimatedRows <= LARGE_IMPORT_ROW_THRESHOLD) {
    return { allowed: true };
  }

  // Regla 3: fuentes explícitamente bloqueadas
  const isBlocked = (BLOCKED_SOURCE_KEYS as readonly string[]).includes(sourceKey);
  if (isBlocked) {
    const overrideResult = checkOverride(sourceKey, env);
    if (overrideResult.overrideActive) {
      return { allowed: true };
    }

    return {
      allowed: false,
      sourceKey,
      countryCode,
      estimatedRows,
      reason:
        `source_key '${sourceKey}' está en la lista de fuentes bloqueadas ` +
        `(causó el incidente de Supabase Free en julio 2026). ` +
        `País: ${countryCode}. Filas estimadas: ${estimatedRows ?? 'ilimitadas'}.`,
      howToOverride: overrideInstructions(sourceKey),
    };
  }

  // Regla 4: filas desconocidas o sobre el umbral
  const exceedsThreshold =
    estimatedRows === null || estimatedRows > LARGE_IMPORT_ROW_THRESHOLD;

  if (exceedsThreshold) {
    const overrideResult = checkOverride(sourceKey, env);
    if (overrideResult.overrideActive) {
      return { allowed: true };
    }

    const rowDesc =
      estimatedRows === null
        ? 'ilimitadas (sin --limit)'
        : `${estimatedRows.toLocaleString()}`;

    return {
      allowed: false,
      sourceKey,
      countryCode,
      estimatedRows,
      reason:
        `Importación de ${rowDesc} filas para '${sourceKey}' (${countryCode}) ` +
        `supera el umbral de ${LARGE_IMPORT_ROW_THRESHOLD.toLocaleString()} filas permitidas sin confirmación.`,
      howToOverride: overrideInstructions(sourceKey),
    };
  }

  return { allowed: true };
}

// ── Helpers internos ───────────────────────────────────────────────────────────

function checkOverride(
  sourceKey: string,
  env: Record<string, string | undefined>,
): { overrideActive: boolean } {
  const allowFlag = env['SELLUP_ALLOW_LARGE_SOURCE_IMPORT'] === 'true';
  const confirmedKey = env['SELLUP_CONFIRMED_SOURCE_KEY'] === sourceKey;
  return { overrideActive: allowFlag && confirmedKey };
}

function overrideInstructions(sourceKey: string): string {
  return (
    `Para habilitar esta importación de forma intencional, exporta AMBAS variables:\n` +
    `  export SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true\n` +
    `  export SELLUP_CONFIRMED_SOURCE_KEY=${sourceKey}\n` +
    `Ambas son necesarias. Una sola no es suficiente.\n` +
    `Recuerda eliminarlas o revertirlas inmediatamente después de la importación.`
  );
}

// ── Función de aserción ────────────────────────────────────────────────────────

/**
 * Lanza un error descriptivo si el guardrail bloquea la importación.
 * Usar en el punto de entrada del importer, antes de cualquier upsert.
 */
export function assertLargeImportAllowed(
  input: GuardrailInput,
  env?: Record<string, string | undefined>,
): void {
  const result = checkLargeImportGuardrail(input, env);
  if (!result.allowed) {
    throw new Error(
      `[guardrail:blocked] ${result.reason}\n\n${result.howToOverride}`,
    );
  }
}

/**
 * Imprime el resultado del guardrail a consola (para importers con logging verbose).
 */
export function logGuardrailDecision(
  input: GuardrailInput,
  result: GuardrailResult,
): void {
  if (result.allowed) {
    console.log(
      `[guardrail] ✓ Permitido — sourceKey=${input.sourceKey}, ` +
      `rows=${input.estimatedRows ?? 'N/A'}, dryRun=${input.isDryRun}`,
    );
  } else {
    console.error(`[guardrail] ✗ BLOQUEADO`);
    console.error(`  sourceKey:      ${result.sourceKey}`);
    console.error(`  countryCode:    ${result.countryCode}`);
    console.error(`  estimatedRows:  ${result.estimatedRows ?? 'ilimitadas'}`);
    console.error(`  Razón:          ${result.reason}`);
    console.error(`\n  ${result.howToOverride.replace(/\n/g, '\n  ')}`);
  }
}
