'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  WifiOff,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  configureSourceCredentialAction,
  testSourceCredentialConnectionAction,
} from '@/modules/source-catalog/source-credential-actions';
import type { SourceConnectionRecord } from '@/modules/source-catalog/queries';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Status badges ────────────────────────────────────────────────────────────

function CredentialStatusBadge({ status }: { status: string }) {
  if (status === 'stored') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Credencial configurada
      </span>
    );
  }
  if (status === 'not_required') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Minus className="h-3 w-3" />
        No requiere credencial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Sin credencial
    </span>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    connected: {
      label: 'Conectado',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    error: {
      label: 'Error',
      icon: <XCircle className="h-3.5 w-3.5" />,
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
    },
    not_tested: {
      label: 'Sin probar',
      icon: <Clock className="h-3.5 w-3.5" />,
      className: 'border-border/40 bg-muted/30 text-muted-foreground',
    },
    not_applicable: {
      label: 'No aplica',
      icon: <WifiOff className="h-3.5 w-3.5" />,
      className: 'border-border/40 bg-muted/30 text-muted-foreground',
    },
  };

  const config = configs[status] ?? configs.not_tested;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

// ─── Credential form ──────────────────────────────────────────────────────────

interface CredentialFormProps {
  connectionSourceKey: string;
  hasCredential: boolean;
  onSuccess: () => void;
}

function CredentialForm({ connectionSourceKey, hasCredential, onSuccess }: CredentialFormProps) {
  const [token, setToken] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleSubmit() {
    if (!token.trim()) return;
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await configureSourceCredentialAction(connectionSourceKey, token.trim());
      if (result.ok) {
        setSuccessMsg(result.message ?? 'Credencial guardada correctamente.');
        setToken('');
        setTimeout(() => {
          setSuccessMsg(null);
          onSuccess();
        }, 1400);
      } else {
        setError(result.error ?? 'Error al guardar la credencial.');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`cred-token-${connectionSourceKey}`} className="text-xs text-muted-foreground">
          {hasCredential ? 'Reemplazar API Key' : 'API Key'}
        </Label>
        <Input
          id={`cred-token-${connectionSourceKey}`}
          type="password"
          placeholder="Pega la API key de la fuente"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono text-sm"
          disabled={isPending}
          autoComplete="off"
        />
      </div>

      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={isPending || token.trim().length === 0}
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Guardar credencial
      </Button>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          {successMsg}
        </div>
      )}
    </div>
  );
}

// ─── Test connection button ────────────────────────────────────────────────────

interface TestConnectionButtonProps {
  connectionSourceKey: string;
  disabled: boolean;
  onSuccess: () => void;
}

function TestConnectionButton({ connectionSourceKey, disabled, onSuccess }: TestConnectionButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    message?: string;
    testStatus?: string;
    httpStatus?: number | null;
    responseTimeMs?: number | null;
  } | null>(null);

  function handleTest() {
    setResult(null);

    startTransition(async () => {
      const res = await testSourceCredentialConnectionAction(connectionSourceKey);
      setResult({
        ok: res.ok,
        message: res.ok ? (res.message ?? 'Conexión verificada.') : (res.error ?? res.message ?? 'Error al probar.'),
        testStatus: res.testStatus,
        httpStatus: res.httpStatus,
        responseTimeMs: res.responseTimeMs,
      });
      if (res.ok) onSuccess();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={isPending || disabled}
      >
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Probando…
          </>
        ) : (
          'Probar conexión'
        )}
      </Button>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{result.message}</span>
          {result.responseTimeMs != null && (
            <span className="ml-auto shrink-0 tabular-nums">{result.responseTimeMs} ms</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  sourceKey: string;
  record: SourceConnectionRecord;
  isAdmin: boolean;
}

export function SourceCredentialPanel({ sourceKey, record, isAdmin }: Props) {
  const router = useRouter();

  function refresh() {
    router.refresh();
  }

  const requiresCredentials = record.requires_credentials;
  const credStatus = record.credentials_status;
  const connStatus = record.connection_status;
  const hasCredential = credStatus === 'stored';
  const canTest = requiresCredentials && hasCredential;

  if (!requiresCredentials) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader
          title="Credencial de API"
          description="Configuración de autenticación para esta fuente."
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Requiere credencial:</span>
          <CredentialStatusBadge status="not_required" />
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Credencial de API"
        description="Configura y prueba la autenticación para esta fuente estructurada."
      />

      <div className="space-y-5">
        {/* Status summary */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Requiere credencial
            </dt>
            <dd className="text-foreground">Sí</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Tipo
            </dt>
            <dd className="text-foreground font-mono text-xs">
              {record.auth_type === 'api_key' ? 'API Key' : record.auth_type}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Credencial
            </dt>
            <dd>
              <CredentialStatusBadge status={credStatus} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Conexión
            </dt>
            <dd>
              <ConnectionStatusBadge status={connStatus} />
            </dd>
          </div>
        </dl>

        {/* Last test info */}
        {(record.last_tested_at || record.last_connection_error) && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Última prueba
              </span>
              <span className="text-xs text-foreground">{formatDate(record.last_tested_at)}</span>
            </div>
            {record.last_test_response_time_ms != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Tiempo de respuesta</span>
                <span className="text-xs font-medium text-foreground tabular-nums">
                  {record.last_test_response_time_ms} ms
                </span>
              </div>
            )}
            {record.last_test_http_status != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">HTTP status</span>
                <span className="text-xs font-medium text-foreground tabular-nums">
                  {record.last_test_http_status}
                </span>
              </div>
            )}
            {record.last_connection_error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2">
                <p className="text-[11px] font-medium text-destructive mb-0.5">Último error</p>
                <p className="text-[11px] text-destructive/80 break-words">
                  {record.last_connection_error}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Admin-only actions */}
        {isAdmin ? (
          <div className="space-y-4 border-t border-border/40 pt-4">
            <div className="space-y-1">
              <p className="text-[0.8125rem] font-semibold text-foreground font-heading flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                {hasCredential ? 'Reemplazar credencial' : 'Configurar credencial'}
              </p>
              <p className="text-xs text-muted-foreground">
                El token se almacena en Vault. Nunca se muestra ni se registra.
              </p>
            </div>

            <CredentialForm
              connectionSourceKey={record.source_key}
              hasCredential={hasCredential}
              onSuccess={refresh}
            />

            {hasCredential && (
              <div className="space-y-1">
                <p className="text-[0.8125rem] font-semibold text-foreground font-heading flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  Probar autenticación
                </p>
                <p className="text-xs text-muted-foreground">
                  Verifica que el token guardado en Vault sea válido. No crea candidatos ni lotes.
                </p>
                <div className="pt-1">
                  <TestConnectionButton
                    connectionSourceKey={record.source_key}
                    disabled={!canTest}
                    onSuccess={refresh}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden configurar credenciales de fuentes.
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}
