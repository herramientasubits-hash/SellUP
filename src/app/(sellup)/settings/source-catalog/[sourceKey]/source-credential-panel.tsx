'use client';

import { withAppTimeZone } from '@/lib/format-date';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  Minus,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field } from '@/components/forms/field';
import { Heading } from '@/components/typography';
import {
  configureSourceCredentialAction,
  testSourceCredentialConnectionAction,
} from '@/modules/source-catalog/source-credential-actions';
import type { SourceConnectionRecord } from '@/modules/source-catalog/queries';
import { AdminOnlyNotice, PanelSummary, PanelSummaryItem, SourcePanel } from './source-panel-parts';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', withAppTimeZone({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })).format(new Date(iso));
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
      <Field
        label={hasCredential ? 'Reemplazar API Key' : 'API Key'}
        description="Se guarda en Vault. Nunca se muestra ni se registra."
      >
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
      </Field>

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
        <Alert variant="destructive">
          <span className="min-w-0 break-words">{error}</span>
        </Alert>
      )}
      {successMsg && <Alert variant="success">{successMsg}</Alert>}
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
        <Alert variant={result.ok ? 'success' : 'destructive'}>
          <AlertTitle className="break-words">{result.message}</AlertTitle>
          {result.responseTimeMs != null && (
            <AlertDescription className="text-xs tabular-nums">
              Tiempo de respuesta: {result.responseTimeMs} ms
            </AlertDescription>
          )}
        </Alert>
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
      <SourcePanel
        icon={KeyRound}
        title="Credencial de API"
        description="Configuración de autenticación para esta fuente."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Requiere credencial:</span>
          <CredentialStatusBadge status="not_required" />
        </div>
      </SourcePanel>
    );
  }

  const hasLastTest = Boolean(record.last_tested_at || record.last_connection_error);

  return (
    <SourcePanel
      icon={KeyRound}
      title="Credencial de API"
      description="Configura y prueba la autenticación para esta fuente estructurada."
    >
      {/* Estado de un vistazo */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Requiere credencial</dt>
          <dd className="text-foreground">Sí</dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Tipo</dt>
          <dd className="break-words font-mono text-xs text-foreground">
            {record.auth_type === 'api_key' ? 'API Key' : record.auth_type}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Credencial</dt>
          <dd>
            <CredentialStatusBadge status={credStatus} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Conexión</dt>
          <dd>
            <ConnectionStatusBadge status={connStatus} />
          </dd>
        </div>
      </dl>

      {/* Última prueba */}
      {hasLastTest && (
        <PanelSummary columns={3}>
          <PanelSummaryItem label="Última prueba" value={formatDate(record.last_tested_at)} />
          {record.last_test_response_time_ms != null && (
            <PanelSummaryItem label="Tiempo de respuesta" value={`${record.last_test_response_time_ms} ms`} />
          )}
          {record.last_test_http_status != null && (
            <PanelSummaryItem label="HTTP status" value={record.last_test_http_status} />
          )}
        </PanelSummary>
      )}

      {record.last_connection_error && (
        <Alert variant="destructive">
          <AlertTitle>Último error</AlertTitle>
          <AlertDescription className="break-words text-xs">{record.last_connection_error}</AlertDescription>
        </Alert>
      )}

      {/* Acciones, solo para administradores */}
      {isAdmin ? (
        <div className="space-y-5 border-t border-border/50 pt-5">
          <section className="space-y-3">
            <Heading level={6} as="h3" className="text-sm">
              {hasCredential ? 'Reemplazar credencial' : 'Configurar credencial'}
            </Heading>
            <CredentialForm
              connectionSourceKey={record.source_key}
              hasCredential={hasCredential}
              onSuccess={refresh}
            />
          </section>

          {hasCredential && (
            <section className="space-y-3">
              <div className="space-y-1">
                <Heading level={6} as="h3" className="text-sm">
                  Probar autenticación
                </Heading>
                <p className="text-xs text-muted-foreground">
                  Verifica que el token guardado en Vault sea válido. No crea candidatos ni lotes.
                </p>
              </div>
              <TestConnectionButton
                connectionSourceKey={record.source_key}
                disabled={!canTest}
                onSuccess={refresh}
              />
            </section>
          )}
        </div>
      ) : (
        <AdminOnlyNotice>Solo administradores pueden configurar credenciales de fuentes.</AdminOnlyNotice>
      )}
    </SourcePanel>
  );
}
