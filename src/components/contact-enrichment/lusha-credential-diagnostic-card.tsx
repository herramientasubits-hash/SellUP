'use client';

/**
 * LushaCredentialDiagnosticCard — Agente 2A · 17B.4Q
 *
 * Diagnóstico seguro de credenciales Lusha en runtime Vercel.
 * No llama API Lusha. No crea candidatos ni contactos. No expone secretos.
 */

import * as React from 'react';
import { AlertCircle, CheckCircle2, CircleDot, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { diagnoseLushaCredentialsAction } from '@/app/(sellup)/contacts/actions/diagnose-lusha-credentials';
import type { LushaCredentialDiagnosticResult, LushaCredentialStage } from '@/server/services/lusha-credential-diagnostics';

// ── Constants (exported for tests) ────────────────────────────────────────────

export const LUSHA_DIAG_DISCLAIMER =
  'Este diagnóstico valida acceso server-side a la configuración de Lusha. No ejecuta búsquedas, no consume créditos del proveedor y no expone credenciales.';

// ── Types ──────────────────────────────────────────────────────────────────────

type DiagState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: LushaCredentialDiagnosticResult }
  | { status: 'error'; message: string };

// ── Helpers (exported for tests) ──────────────────────────────────────────────

export function stageColor(stage: LushaCredentialStage): 'green' | 'amber' | 'red' {
  if (stage === 'resolved_from_vault') return 'green';
  if (stage === 'resolved_from_env_fallback') return 'amber';
  return 'red';
}

export function stageLabel(stage: LushaCredentialStage): string {
  switch (stage) {
    case 'resolved_from_vault': return 'Credencial resuelta desde Supabase Vault';
    case 'resolved_from_env_fallback': return 'Credencial resuelta desde variable de entorno (fallback)';
    case 'env_check': return 'Variables de entorno incompletas';
    case 'admin_client': return 'No se pudo crear cliente admin de Supabase';
    case 'vault_rpc': return 'El runtime no pudo ejecutar get_vault_secret_decrypted';
    case 'secret_missing': return 'Secret Lusha no encontrado en Vault';
    case 'secret_empty': return 'Secret Lusha existe pero está vacío';
    case 'failed': return 'Diagnóstico fallido';
  }
}

function CheckRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value ? (
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Disponible
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden /> No disponible
        </span>
      )}
    </div>
  );
}

function SecretStatusRow({ label, found, nonEmpty }: { label: string; found: boolean; nonEmpty: boolean }) {
  const text = !found ? 'No encontrado' : !nonEmpty ? 'Vacío' : 'Encontrado';
  const color = !found || !nonEmpty ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400';
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${color}`}>{text}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LushaCredentialDiagnosticCard() {
  const [diag, setDiag] = React.useState<DiagState>({ status: 'idle' });

  async function runDiagnostic() {
    setDiag({ status: 'loading' });
    try {
      const res = await diagnoseLushaCredentialsAction();
      if (!res.ok) {
        setDiag({ status: 'error', message: res.error });
        return;
      }
      setDiag({ status: 'done', result: res.diagnostic });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : 'Error desconocido';
      setDiag({ status: 'error', message: msg });
    }
  }

  // ── Idle ─────────────────────────────────────────────────────────────────────
  if (diag.status === 'idle') {
    return (
      <div className="rounded-xl border border-border/40 bg-card/50 p-3 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {LUSHA_DIAG_DISCLAIMER}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={runDiagnostic}
          className="w-full text-xs"
          data-testid="lusha-diag-button"
        >
          <ShieldCheck className="mr-2 h-3.5 w-3.5" aria-hidden />
          Diagnosticar conexión Lusha
        </Button>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (diag.status === 'loading') {
    return (
      <div className="rounded-xl border border-border/40 bg-card/50 p-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">
          Diagnosticando acceso seguro a Supabase Vault…
        </span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (diag.status === 'error') {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          <p className="text-xs font-medium text-destructive">Error al ejecutar diagnóstico</p>
        </div>
        <p className="text-xs text-muted-foreground">{diag.message}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDiag({ status: 'idle' })}
          className="text-xs text-muted-foreground"
        >
          Reintentar
        </Button>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  const { result } = diag;
  const color = stageColor(result.stage);
  const { checks, safeDetails } = result;

  const borderColor =
    color === 'green'
      ? 'border-emerald-500/30'
      : color === 'amber'
        ? 'border-amber-500/30'
        : 'border-destructive/30';
  const bgColor =
    color === 'green'
      ? 'bg-emerald-500/5'
      : color === 'amber'
        ? 'bg-amber-500/5'
        : 'bg-destructive/5';

  const stageTextColor =
    color === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : color === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-destructive';

  const StageIcon = color === 'green' ? CheckCircle2 : color === 'amber' ? AlertCircle : AlertCircle;

  // Source resolved
  const sourceResolved =
    result.stage === 'resolved_from_vault'
      ? 'Supabase Vault'
      : result.stage === 'resolved_from_env_fallback'
        ? 'Env fallback'
        : 'Ninguna';

  return (
    <div
      className={`rounded-xl border ${borderColor} ${bgColor} p-4 space-y-3`}
      data-testid="lusha-diag-result"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <StageIcon className={`h-4 w-4 ${stageTextColor}`} aria-hidden />
        <p className="text-xs font-semibold text-foreground">Diagnóstico de conexión Lusha</p>
      </div>

      {/* Stage */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground">Estado</span>
        <span className={`text-xs font-medium text-right ${stageTextColor}`}>
          {stageLabel(result.stage)}
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-border/30" />

      {/* Checks */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Checks
        </p>
        <CheckRow label="Supabase URL" value={checks.hasSupabaseUrl} />
        <CheckRow label="Service role en runtime" value={checks.hasServiceRoleKey} />
        <CheckRow label="Cliente admin Supabase" value={checks.adminClientCreated} />
        {safeDetails.supabaseUrlHost && (
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-xs text-muted-foreground">Host Supabase</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {safeDetails.supabaseUrlHost}
            </span>
          </div>
        )}
        {checks.hasServiceRoleKey && (
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-xs text-muted-foreground">Service role (JWT)</span>
            <span className="text-xs text-muted-foreground">
              {safeDetails.serviceRoleKeyLooksJwt ? 'Formato JWT' : 'Formato inválido'} · {safeDetails.serviceRoleKeyLength ?? '?'} chars
            </span>
          </div>
        )}
      </div>

      {/* Vault */}
      {checks.adminClientCreated && (
        <>
          <div className="border-t border-border/30" />
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Vault
            </p>
            <div className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-muted-foreground">Vault RPC</span>
              <span
                className={`text-xs font-medium ${
                  checks.vaultRpcOk
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : checks.vaultRpcCalled
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }`}
              >
                {checks.vaultRpcOk ? 'Correcto' : checks.vaultRpcCalled ? 'Error' : 'No ejecutado'}
              </span>
            </div>
            {checks.vaultRpcCalled && (
              <SecretStatusRow
                label="Secret Lusha en Vault"
                found={checks.vaultSecretFound}
                nonEmpty={checks.vaultSecretNonEmpty}
              />
            )}
            {safeDetails.vaultSecretFingerprint && (
              <div className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-muted-foreground">Fingerprint (SHA-256)</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {safeDetails.vaultSecretFingerprint}…
                </span>
              </div>
            )}
            {safeDetails.vaultSecretLength && (
              <div className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-muted-foreground">Longitud secret</span>
                <span className="text-xs text-muted-foreground">
                  {safeDetails.vaultSecretLength} chars
                </span>
              </div>
            )}
            {safeDetails.rpcErrorCode && (
              <div className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-muted-foreground">RPC error</span>
                <span className="font-mono text-[10px] text-destructive">
                  {safeDetails.rpcErrorCode}
                </span>
              </div>
            )}
            {safeDetails.rpcErrorMessage && (
              <p className="text-[10px] text-destructive/80 break-words">
                {safeDetails.rpcErrorMessage}
              </p>
            )}
          </div>
        </>
      )}

      {/* Env fallback */}
      <div className="border-t border-border/30" />
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Fallback
        </p>
        <CheckRow label="Fallback LUSHA_API_KEY" value={checks.hasLushaEnvFallback} />
        {checks.hasLushaEnvFallback && safeDetails.lushaEnvFallbackLength != null && (
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-xs text-muted-foreground">Longitud fallback</span>
            <span className="text-xs text-muted-foreground">
              {safeDetails.lushaEnvFallbackLength} chars
            </span>
          </div>
        )}
      </div>

      {/* Source & recommendation */}
      <div className="border-t border-border/30" />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Fuente resuelta</span>
          <span className="flex items-center gap-1 text-xs font-medium text-foreground">
            <CircleDot className="h-3 w-3" aria-hidden />
            {sourceResolved}
          </span>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            Recomendación
          </p>
          <p className="text-xs text-foreground leading-relaxed" data-testid="lusha-diag-recommendation">
            {result.recommendation}
          </p>
        </div>
      </div>

      {/* Exception details if any */}
      {(safeDetails.exceptionName || safeDetails.exceptionMessage) && (
        <>
          <div className="border-t border-border/30" />
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Excepción
            </p>
            {safeDetails.exceptionName && (
              <div className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-muted-foreground">Tipo</span>
                <span className="font-mono text-[10px] text-destructive">{safeDetails.exceptionName}</span>
              </div>
            )}
            {safeDetails.exceptionMessage && (
              <p className="text-[10px] text-destructive/80 break-words">{safeDetails.exceptionMessage}</p>
            )}
          </div>
        </>
      )}

      {/* Disclaimer */}
      <p
        className="text-[10px] text-muted-foreground/70 leading-relaxed pt-1"
        data-testid="lusha-diag-disclaimer"
      >
        {LUSHA_DIAG_DISCLAIMER}
      </p>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDiag({ status: 'idle' })}
        className="w-full text-xs text-muted-foreground"
      >
        Cerrar diagnóstico
      </Button>
    </div>
  );
}
