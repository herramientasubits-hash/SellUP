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
import { Badge } from '@/components/ui/badge';
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
      <Badge variant="positive">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
        Credencial configurada
      </Badge>
    );
  }
  if (status === 'not_required') {
    return (
      <Badge variant="neutral">
        <Minus aria-hidden="true" />
        No requiere credencial
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
      Sin credencial
    </Badge>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const configs: Record<
    string,
    { label: string; icon: React.ReactNode; variant: 'positive' | 'negative' | 'neutral' }
  > = {
    connected: {
      label: 'Conectado',
      icon: <CheckCircle2 aria-hidden="true" />,
      variant: 'positive',
    },
    error: {
      label: 'Error',
      icon: <XCircle aria-hidden="true" />,
      variant: 'negative',
    },
    not_tested: {
      label: 'Sin probar',
      icon: <Clock aria-hidden="true" />,
      variant: 'neutral',
    },
    not_applicable: {
      label: 'No aplica',
      icon: <WifiOff aria-hidden="true" />,
      variant: 'neutral',
    },
  };

  const config = configs[status] ?? configs.not_tested;

  return (
    <Badge variant={config.variant}>
      {config.icon}
      {config.label}
    </Badge>
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
        <Label htmlFor={`cred-token-${connectionSourceKey}`}>
          {hasCredential ? 'Reemplazar API Key' : 'API Key'}
        </Label>
        <Input
          id={`cred-token-${connectionSourceKey}`}
          type="password"
          placeholder="Pega la API key de la fuente"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono"
          disabled={isPending}
          autoComplete="off"
        />
      </div>

      <Button
        type="button"
        size="sm"
        onClick={handleSubmit}
        disabled={isPending || token.trim().length === 0}
      >
        {isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Guardar credencial
      </Button>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-xs font-medium text-success">
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
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={isPending || disabled}
      >
        {isPending ? (
          <>
            <Loader2 aria-hidden="true" className="animate-spin" />
            Probando…
          </>
        ) : (
          'Probar conexión'
        )}
      </Button>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
            result.ok
              ? 'border-success/20 bg-success/10 text-success'
              : 'border-destructive/20 bg-destructive/10 text-destructive'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{result.message}</span>
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
        <div className="mb-5 flex items-start gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
            <KeyRound className="h-4 w-4" />
          </span>
          <SurfaceCardHeader
            title="Credencial de API"
            description="Configuración de autenticación para esta fuente."
            className="mb-0 min-w-0 flex-1 flex-wrap"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Requiere credencial:</span>
          <CredentialStatusBadge status="not_required" />
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
          <KeyRound className="h-4 w-4" />
        </span>
        <SurfaceCardHeader
          title="Credencial de API"
          description="Configura y prueba la autenticación para esta fuente estructurada."
          className="mb-0 min-w-0 flex-1 flex-wrap"
        />
      </div>

      <div className="space-y-5">
        {/* Status summary */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="mb-1 text-xs font-medium text-muted-foreground">
              Requiere credencial
            </dt>
            <dd className="text-foreground">Sí</dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1 text-xs font-medium text-muted-foreground">
              Tipo
            </dt>
            <dd className="break-words font-mono text-xs text-foreground">
              {record.auth_type === 'api_key' ? 'API Key' : record.auth_type}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1 text-xs font-medium text-muted-foreground">
              Credencial
            </dt>
            <dd>
              <CredentialStatusBadge status={credStatus} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1 text-xs font-medium text-muted-foreground">
              Conexión
            </dt>
            <dd>
              <ConnectionStatusBadge status={connStatus} />
            </dd>
          </div>
        </dl>

        {/* Last test info */}
        {(record.last_tested_at || record.last_connection_error) && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-muted-foreground">
                Última prueba
              </span>
              <span className="text-right text-xs tabular-nums text-foreground">{formatDate(record.last_tested_at)}</span>
            </div>
            {record.last_test_response_time_ms != null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">Tiempo de respuesta</span>
                <span className="text-xs font-medium text-foreground tabular-nums">
                  {record.last_test_response_time_ms} ms
                </span>
              </div>
            )}
            {record.last_test_http_status != null && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">HTTP status</span>
                <span className="text-xs font-medium text-foreground tabular-nums">
                  {record.last_test_http_status}
                </span>
              </div>
            )}
            {record.last_connection_error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
                <p className="text-xs font-medium text-destructive mb-0.5">Último error</p>
                <p className="text-xs text-destructive break-words">
                  {record.last_connection_error}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Admin-only actions */}
        {isAdmin ? (
          <div className="space-y-5 border-t border-border/50 pt-5">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
                <KeyRound aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
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
                <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
                  <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
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
          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Solo administradores pueden configurar credenciales de fuentes.
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}
