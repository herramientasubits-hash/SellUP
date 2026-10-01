'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { KeyRound, RefreshCw, Unplug, type LucideIcon } from '@/icons';
import { formatAppDateTime } from '@/lib/format-date';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import { Field } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ModalShell } from '@/components/shared/modal-shell';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import type { ProspectingProviderConnection } from '@/modules/prospecting-config/types';

// ============================================================
// Contrato
// ============================================================

/** Lo que devuelve cualquiera de las acciones de servidor de un proveedor. */
export interface ProspectingProviderActionResult {
  success: boolean;
  error?: string;
  message?: string;
}

/**
 * Las cuatro acciones de servidor del proveedor. Llegan por props (y no por
 * import) para que la misma tarjeta sirva a Apollo y a Lusha, y para que se
 * pueda probar sin tocar el servidor.
 */
export interface ProspectingProviderActions {
  connect: (apiKey: string) => Promise<ProspectingProviderActionResult>;
  updateApiKey: (apiKey: string) => Promise<ProspectingProviderActionResult>;
  testConnection: () => Promise<ProspectingProviderActionResult>;
  disconnect: () => Promise<ProspectingProviderActionResult>;
}

export interface ProspectingProviderCardProps {
  /** Identificador corto, sin espacios: da el `id` del campo de la clave. */
  providerId: string;
  /** Nombre completo, como se titula la tarjeta («Apollo.io»). */
  name: string;
  /** Nombre corto para los botones («Apollo»). Por defecto, `name`. */
  shortName?: string;
  icon: LucideIcon;
  /** Para qué se usa el proveedor, en una línea. */
  purpose: string;
  /** Qué pasa con la clave al guardarla: descripción del diálogo. */
  credentialDescription: string;
  /** Ayuda bajo el campo de la clave. */
  credentialHint: string;
  connection: ProspectingProviderConnection | null;
  description: string | null;
  actions: ProspectingProviderActions;
}

type CredentialMode = 'connect' | 'update' | null;

/** Las claves de estos proveedores nunca son más cortas (lo valida el servidor). */
const MIN_API_KEY_LENGTH = 10;

// ============================================================
// Helpers de presentación
// ============================================================

function isConfigured(connection: ProspectingProviderConnection | null): boolean {
  return (
    connection !== null &&
    connection.credentials_status === 'stored' &&
    connection.connection_status !== 'not_connected' &&
    connection.connection_status !== 'disconnected'
  );
}

function getStatus(
  connection: ProspectingProviderConnection | null,
): { status: StatusType; label: string } {
  if (!isConfigured(connection)) return { status: 'neutral', label: 'No configurado' };
  switch (connection?.connection_status) {
    case 'not_tested':
      return { status: 'pending', label: 'Credencial guardada' };
    case 'connected':
      return { status: 'active', label: 'Conectado' };
    case 'error':
      return { status: 'error', label: 'Error de conexión' };
    default:
      return { status: 'neutral', label: 'No configurado' };
  }
}

// ============================================================
// Componente
// ============================================================

/**
 * La tarjeta de un proveedor de prospección que se conecta con una API Key:
 * estado, última prueba y las acciones de conectar, probar, cambiar la clave y
 * desconectar. Desconectar borra la credencial, así que siempre pregunta antes.
 */
export function ProspectingProviderCard({
  providerId,
  name,
  shortName = name,
  icon: Icon,
  purpose,
  credentialDescription,
  credentialHint,
  connection: initialConnection,
  description,
  actions,
}: ProspectingProviderCardProps) {
  const [connection, setConnection] = useState(initialConnection);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const status = getStatus(connection);
  const configured = isConfigured(connection);
  const trimmedKey = apiKeyInput.trim();
  const canSaveCredential = !isPending && trimmedKey.length >= MIN_API_KEY_LENGTH;

  function openCredentialDialog(mode: Exclude<CredentialMode, null>) {
    setApiKeyInput('');
    setCredentialError(null);
    setCredentialMode(mode);
  }

  function closeCredentialDialog() {
    setCredentialMode(null);
    setApiKeyInput('');
    setCredentialError(null);
  }

  // ── Guardar credencial (conectar o actualizar) ──────────────

  function handleSaveCredential() {
    if (!canSaveCredential) return;
    const save = credentialMode === 'connect' ? actions.connect : actions.updateApiKey;

    startTransition(async () => {
      const result = await save(trimmedKey);

      if (!result.success) {
        setCredentialError(result.error ?? 'No se pudo guardar la clave. Inténtalo de nuevo.');
        return;
      }

      const now = new Date().toISOString();
      setConnection((prev) => ({
        id: prev?.id ?? '',
        provider_id: prev?.provider_id ?? '',
        vault_secret_id: null,
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_tested_at: null,
        last_connected_at: prev?.last_connected_at ?? null,
        last_connection_error: null,
        configured_by: null,
        created_at: prev?.created_at ?? now,
        updated_at: now,
      }));
      toast.success(result.message ?? 'API Key guardada correctamente.');
      closeCredentialDialog();
    });
  }

  // ── Probar conexión ─────────────────────────────────────────

  function handleTestConnection() {
    startTransition(async () => {
      const result = await actions.testConnection();
      const now = new Date().toISOString();

      if (result.success) {
        setConnection((prev) =>
          prev
            ? {
                ...prev,
                connection_status: 'connected',
                last_tested_at: now,
                last_connected_at: now,
                last_connection_error: null,
              }
            : prev,
        );
        toast.success(result.message ?? 'Conexión verificada correctamente.');
        return;
      }

      setConnection((prev) =>
        prev
          ? {
              ...prev,
              connection_status: 'error',
              last_tested_at: now,
              last_connection_error: result.message ?? 'Error desconocido',
            }
          : prev,
      );
      toast.error(result.message ?? 'La prueba de conexión falló.');
    });
  }

  // ── Desconectar (solo tras confirmar) ───────────────────────

  function handleDisconnect() {
    startTransition(async () => {
      const result = await actions.disconnect();

      if (!result.success) {
        setDisconnectError(result.error ?? 'No se pudo desconectar. Inténtalo de nuevo.');
        return;
      }

      setConnection((prev) =>
        prev
          ? {
              ...prev,
              credentials_status: 'missing',
              connection_status: 'disconnected',
              vault_secret_id: null,
              last_connection_error: null,
            }
          : null,
      );
      setIsConfirmingDisconnect(false);
      toast.success(`${name} desconectado correctamente.`);
    });
  }

  return (
    <>
      <SurfaceCard>
        <SurfaceCardHeader
          title={name}
          description={description ?? undefined}
          actions={<StatusBadge status={status.status} label={status.label} />}
        />

        <div className="space-y-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 text-xs text-muted-foreground">{purpose}</span>
          </div>

          {connection?.connection_status === 'error' && connection.last_connection_error && (
            <Alert variant="destructive">
              <AlertTitle>La última prueba de conexión falló</AlertTitle>
              <AlertDescription className="break-words">
                {connection.last_connection_error}
              </AlertDescription>
            </Alert>
          )}

          {configured && connection?.connection_status === 'not_tested' && (
            <Alert variant="warning">
              <AlertTitle>Falta probar la conexión</AlertTitle>
              <AlertDescription>
                La clave está guardada, pero {shortName} no se usará hasta que la prueba salga bien.
              </AlertDescription>
            </Alert>
          )}

          {connection?.last_tested_at && (
            <p className="text-xs tabular-nums text-muted-foreground">
              Última prueba: {formatAppDateTime(connection.last_tested_at)}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!configured ? (
              <Button
                type="button"
                size="sm"
                onClick={() => openCredentialDialog('connect')}
                disabled={isPending}
              >
                Conectar {shortName}
              </Button>
            ) : (
              <>
                <Button type="button" size="sm" onClick={handleTestConnection} disabled={isPending}>
                  <RefreshCw className={isPending ? 'animate-spin' : undefined} aria-hidden="true" />
                  Probar conexión
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openCredentialDialog('update')}
                  disabled={isPending}
                >
                  <KeyRound aria-hidden="true" />
                  Actualizar API Key
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setDisconnectError(null);
                    setIsConfirmingDisconnect(true);
                  }}
                  disabled={isPending}
                >
                  <Unplug aria-hidden="true" />
                  Desconectar
                </Button>
              </>
            )}
          </div>
        </div>
      </SurfaceCard>

      <ModalShell
        open={credentialMode !== null}
        onOpenChange={(open) => {
          if (!open) closeCredentialDialog();
        }}
        title={credentialMode === 'update' ? `Actualizar API Key de ${shortName}` : `Conectar ${name}`}
        description={credentialDescription}
        size="md"
        actions={
          <>
            <Button type="button" variant="outline" onClick={closeCredentialDialog} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSaveCredential} disabled={!canSaveCredential}>
              {isPending ? 'Guardando...' : 'Guardar credencial'}
            </Button>
          </>
        }
      >
        <Field
          label="API Key"
          description={credentialHint}
          error={credentialError ?? undefined}
          required
        >
          <Input
            id={`${providerId}-api-key`}
            type="password"
            placeholder={`Tu API Key de ${name}`}
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSaveCredential();
            }}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
      </ModalShell>

      <ConfirmDialog
        open={isConfirmingDisconnect}
        onOpenChange={(open) => {
          if (!open) setIsConfirmingDisconnect(false);
        }}
        variant="destructive"
        icon={Unplug}
        title={`¿Desconectar ${name}?`}
        description={
          <>
            Se borra la clave guardada y SellUp deja de usar {shortName}. Para volver a conectarlo
            tendrás que pegar la API Key otra vez.
            {disconnectError && (
              <Alert variant="destructive" className="mt-3 text-left">
                <AlertDescription>{disconnectError}</AlertDescription>
              </Alert>
            )}
          </>
        }
        confirmLabel="Desconectar"
        loading={isPending}
        onConfirm={handleDisconnect}
      />
    </>
  );
}
