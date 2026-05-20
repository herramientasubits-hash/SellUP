'use client';

import { useState, useTransition } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  RefreshCw,
  KeyRound,
  Unplug,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  connectApollo,
  testApolloConnectionAction,
  updateApolloApiKey,
  disconnectApollo,
} from '@/modules/prospecting-config/actions';
import type { ProspectingProviderConnection } from '@/modules/prospecting-config/types';

// ============================================================
// Tipos
// ============================================================

type DialogMode = 'connect' | 'update' | null;

interface ApolloStatusConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
  icon: React.ReactNode;
}

// ============================================================
// Helpers de presentación
// ============================================================

function getStatusConfig(
  connection: ProspectingProviderConnection | null
): ApolloStatusConfig {
  if (!connection || connection.connection_status === 'not_connected') {
    return {
      label: 'No configurado',
      badgeClass: 'border-border/40 bg-muted/30 text-muted-foreground/60',
      dotClass: 'bg-muted-foreground/25',
      icon: <XCircle className="h-4 w-4 text-muted-foreground/50" />,
    };
  }

  if (
    connection.connection_status === 'disconnected' ||
    connection.credentials_status === 'missing'
  ) {
    return {
      label: 'No configurado',
      badgeClass: 'border-border/40 bg-muted/30 text-muted-foreground/60',
      dotClass: 'bg-muted-foreground/25',
      icon: <XCircle className="h-4 w-4 text-muted-foreground/50" />,
    };
  }

  if (connection.connection_status === 'not_tested') {
    return {
      label: 'Credencial guardada',
      badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
      dotClass: 'bg-amber-500',
      icon: <Clock className="h-4 w-4 text-amber-500" />,
    };
  }

  if (connection.connection_status === 'connected') {
    return {
      label: 'Conectado',
      badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
      dotClass: 'bg-emerald-500',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    };
  }

  if (connection.connection_status === 'error') {
    return {
      label: 'Error de conexión',
      badgeClass: 'border-destructive/30 bg-destructive/10 text-destructive',
      dotClass: 'bg-destructive',
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
    };
  }

  return {
    label: 'No configurado',
    badgeClass: 'border-border/40 bg-muted/30 text-muted-foreground/60',
    dotClass: 'bg-muted-foreground/25',
    icon: <XCircle className="h-4 w-4 text-muted-foreground/50" />,
  };
}

function isConfigured(connection: ProspectingProviderConnection | null): boolean {
  return (
    connection !== null &&
    connection.credentials_status === 'stored' &&
    connection.connection_status !== 'not_connected' &&
    connection.connection_status !== 'disconnected'
  );
}

// ============================================================
// Toast ligero interno
// ============================================================

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

// ============================================================
// Componente principal
// ============================================================

interface ApolloProviderCardProps {
  connection: ProspectingProviderConnection | null;
  description: string | null;
}

export function ApolloProviderCard({ connection: initialConnection, description }: ApolloProviderCardProps) {
  const [connection, setConnection] = useState(initialConnection);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isPending, startTransition] = useTransition();

  const status = getStatusConfig(connection);
  const configured = isConfigured(connection);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function openDialog(mode: DialogMode) {
    setApiKeyInput('');
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogMode(null);
    setApiKeyInput('');
  }

  // ── Guardar credencial (conectar o actualizar) ──────────────

  function handleSaveCredential() {
    if (!apiKeyInput.trim()) return;

    startTransition(async () => {
      const action = dialogMode === 'connect' ? connectApollo : updateApolloApiKey;
      const result = await action(apiKeyInput.trim());

      if (result.success) {
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
          created_at: prev?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        showToast(result.message ?? 'API Key guardada correctamente.', 'success');
        closeDialog();
      } else {
        showToast(result.error ?? 'Error al guardar la credencial.', 'error');
      }
    });
  }

  // ── Probar conexión ─────────────────────────────────────────

  function handleTestConnection() {
    startTransition(async () => {
      const result = await testApolloConnectionAction();

      if (result.success) {
        setConnection((prev) =>
          prev
            ? {
                ...prev,
                connection_status: 'connected',
                last_tested_at: new Date().toISOString(),
                last_connected_at: new Date().toISOString(),
                last_connection_error: null,
              }
            : prev
        );
        showToast(result.message ?? 'Conexión verificada correctamente.', 'success');
      } else {
        setConnection((prev) =>
          prev
            ? {
                ...prev,
                connection_status: 'error',
                last_tested_at: new Date().toISOString(),
                last_connection_error: result.message ?? 'Error desconocido',
              }
            : prev
        );
        showToast(result.message ?? 'La prueba de conexión falló.', 'error');
      }
    });
  }

  // ── Desconectar ─────────────────────────────────────────────

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectApollo();

      if (result.success) {
        setConnection((prev) =>
          prev
            ? {
                ...prev,
                credentials_status: 'missing',
                connection_status: 'disconnected',
                vault_secret_id: null,
                last_connection_error: null,
              }
            : null
        );
        showToast('Apollo.io desconectado correctamente.', 'success');
      } else {
        showToast(result.error ?? 'Error al desconectar.', 'error');
      }
    });
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <>
      <SurfaceCard>
        <SurfaceCardHeader
          title="Apollo.io"
          description={description ?? undefined}
          actions={
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${status.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
              {status.label}
            </span>
          }
        />

        {/* Tipo de proveedor */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/60 text-muted-foreground/50">
            <Search className="h-4 w-4" />
          </div>
          <span className="text-xs text-muted-foreground">
            Prospección y enriquecimiento
          </span>
        </div>

        {/* Error message */}
        {connection?.connection_status === 'error' && connection.last_connection_error && (
          <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
            <p className="text-[11px] text-destructive line-clamp-2">
              {connection.last_connection_error}
            </p>
          </div>
        )}

        {/* Última prueba */}
        {connection?.last_tested_at && (
          <p className="mb-4 text-[11px] text-muted-foreground/60">
            Última prueba:{' '}
            {new Date(connection.last_tested_at).toLocaleString('es-ES', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          {!configured ? (
            <Button
              size="sm"
              onClick={() => openDialog('connect')}
              disabled={isPending}
              className="bg-su-brand text-white hover:bg-su-brand/90"
            >
              Conectar Apollo
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isPending}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
                Probar conexión
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog('update')}
                disabled={isPending}
                className="gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Actualizar API Key
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnect}
                disabled={isPending}
                className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/40"
              >
                <Unplug className="h-3.5 w-3.5" />
                Desconectar
              </Button>
            </>
          )}
        </div>
      </SurfaceCard>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg animate-su-slide-in ${
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-card text-emerald-500'
              : 'border-destructive/30 bg-card text-destructive'
          }`}
        >
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}

      {/* Dialog — Conectar / Actualizar API Key */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'connect' ? 'Conectar Apollo.io' : 'Actualizar API Key'}
            </DialogTitle>
            <DialogDescription>
              La API Key se almacenará de forma segura y permitirá que SellUp use Apollo
              para futuros flujos de prospección y enriquecimiento.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="apollo-api-key" className="text-sm font-medium">
                API Key
              </Label>
              <Input
                id="apollo-api-key"
                type="password"
                placeholder="Tu API Key de Apollo.io"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveCredential()}
                autoComplete="off"
                className="font-mono text-sm"
              />
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              El acceso a endpoints específicos y el consumo de créditos dependen del
              plan de Apollo configurado para esta API Key.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveCredential}
              disabled={isPending || apiKeyInput.trim().length < 10}
              className="bg-su-brand text-white hover:bg-su-brand/90"
            >
              {isPending ? 'Guardando...' : 'Guardar credencial'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
