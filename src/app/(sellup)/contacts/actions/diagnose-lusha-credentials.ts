'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import {
  diagnoseLushaCredentialResolution,
  diagnoseLushaExecutionPreflight,
  type LushaCredentialDiagnosticResult,
  type LushaExecutionPreflightResult,
} from '@/server/services/lusha-credential-diagnostics';

export type DiagnoseLushaCredentialsActionResult =
  | { ok: true; diagnostic: LushaCredentialDiagnosticResult }
  | { ok: false; error: string };

/**
 * Server action controlada para diagnóstico seguro de credenciales Lusha.
 * Requiere usuario autenticado. No llama Lusha. No crea candidatos ni contactos.
 */
export async function diagnoseLushaCredentialsAction(): Promise<DiagnoseLushaCredentialsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  try {
    const diagnostic = await diagnoseLushaCredentialResolution({
      triggeredBy: user.id,
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  try {
    const preflight = await diagnoseLushaExecutionPreflight();
    return { ok: true, preflight };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg.slice(0, 200) };
  }
}
