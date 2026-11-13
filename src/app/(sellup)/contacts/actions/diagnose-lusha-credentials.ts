'use server';

import { resolveCurrentActor } from '@/modules/contact-enrichment/current-actor.server';
import {
  diagnoseLushaCredentialResolution,
  diagnoseLushaExecutionPreflight,
  type LushaCredentialDiagnosticResult,
  type LushaExecutionPreflightResult,
} from '@/server/services/lusha-credential-diagnostics';

export type DiagnoseLushaCredentialsActionResult =
  | { ok: true; diagnostic: LushaCredentialDiagnosticResult }
  | { ok: false; error: string };

const ADMIN_ONLY_ERROR = 'Sólo un administrador puede usar el diagnóstico de Lusha.';

/** Administrador ACTIVO (respeta «Ver como…»). `null` si no lo es. */
async function requireActiveAdminId(): Promise<string | null> {
  const actor = await resolveCurrentActor();
  return actor && actor.active && actor.isAdmin ? actor.internalUserId : null;
}

/**
 * Server action controlada para diagnóstico seguro de credenciales Lusha.
 * Requiere administrador activo. No llama Lusha. No crea candidatos ni contactos.
 */
export async function diagnoseLushaCredentialsAction(): Promise<DiagnoseLushaCredentialsActionResult> {
  const internalUserId = await requireActiveAdminId();
  if (!internalUserId) return { ok: false, error: ADMIN_ONLY_ERROR };

  try {
    const diagnostic = await diagnoseLushaCredentialResolution({
      // El id INTERNO (internal_users.id), no el de autenticación.
      triggeredBy: internalUserId,
      source: 'manual_debug',
    });

    // Log seguro en server console — sin secretos
    console.warn('[lusha-credential-diagnostics]', {
      ok: diagnostic.ok,
      stage: diagnostic.stage,
      checks: diagnostic.checks,
      safeDetails: diagnostic.safeDetails,
      recommendation: diagnostic.recommendation,
    });

    return { ok: true, diagnostic };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg.slice(0, 200) };
  }
}

// ── Execution preflight ───────────────────────────────────────────────────────

export type DiagnoseLushaPreflightActionResult =
  | { ok: true; preflight: LushaExecutionPreflightResult }
  | { ok: false; error: string };

/**
 * Server action para validar el preflight del runner Lusha.
 * Ejecuta exactamente las mismas condiciones previas que el runner
 * y se detiene ANTES de llamar a Lusha.
 * No consume créditos. No crea runs. No crea candidatos. No crea usage logs.
 */
export async function diagnoseLushaExecutionPreflightAction(): Promise<DiagnoseLushaPreflightActionResult> {
  if (!(await requireActiveAdminId())) return { ok: false, error: ADMIN_ONLY_ERROR };

  try {
    const preflight = await diagnoseLushaExecutionPreflight();
    return { ok: true, preflight };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg.slice(0, 200) };
  }
}
