'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Key, MoreHorizontal, RefreshCcw, RefreshCw, Settings, Unplug, X } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Field } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ModalShell } from '@/components/shared/modal-shell';
import {
  updateAIProviderStatus,
  setActiveConfig,
  connectAiProvider,
  updateAiProviderCredential,
  disconnectAiProvider,
  testAiProviderConnectionWithVault,
  syncAnthropicModels,
} from '@/modules/ai-config/actions';
import type { AIProvider, AIModel } from '@/modules/ai-config/types';
import { ApiKeyField } from './api-key-field';

interface AIProviderControlsProps {
  provider: AIProvider;
  models: AIModel[];
}

type CredentialMode = 'connect' | 'update' | null;

/** Margen para que el aviso se alcance a leer antes de recargar la pantalla. */
const RELOAD_DELAY_MS = 1500;
const SYNC_RELOAD_DELAY_MS = 2000;

const reloadSoon = (delay: number = RELOAD_DELAY_MS) => setTimeout(() => window.location.reload(), delay);

/** El menú de un proveedor de IA y los diálogos que abre. */
export function AIProviderControls({ provider, models }: AIProviderControlsProps) {
  const [showActiveDialog, setShowActiveDialog] = useState(false);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);

  const providerModels = models.filter((m) => m.provider_id === provider.id);
  const hasCredential =
    provider.credentials_status === 'configured' || provider.connection_status === 'connected';

  const closeCredentialDialog = () => {
    setCredentialMode(null);
    setApiKey('');
  };

  const handleStatusChange = async (newStatus: string) => {
    setLoading(true);
    await updateAIProviderStatus(provider.id, newStatus);
    setLoading(false);
    window.location.reload();
  };

  const handleSetActive = async () => {
    if (!selectedModelId) return;
    setLoading(true);
    const result = await setActiveConfig(provider.id, selectedModelId);
    setLoading(false);
    if (result.success) {
      setShowActiveDialog(false);
      window.location.reload();
    }
  };

  const handleConnect = async () => {
    if (!apiKey) return;
    setLoading(true);
    let result;
    try {
      result = await connectAiProvider(provider.key, apiKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error de conexión: ${msg}`);
      setLoading(false);
      return;
    }
    setLoading(false);
    if (!result) {
      toast.error('No se recibió respuesta del servidor');
      return;
    }
    if (result.success) {
      closeCredentialDialog();
      toast.success(result.message || 'Proveedor conectado correctamente');
      reloadSoon();
    } else {
      toast.error(result.message || 'Error al conectar');
    }
  };

  const handleUpdateCredential = async () => {
    if (!apiKey) return;
    setLoading(true);
    const result = await updateAiProviderCredential(provider.key, apiKey);
    setLoading(false);
    if (result.success) {
      closeCredentialDialog();
      toast.success(result.message || 'Credencial actualizada correctamente');
      reloadSoon();
    } else {
      toast.error(result.message || 'Error al actualizar');
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setDisconnectError(null);
    const result = await disconnectAiProvider(provider.key);
    setLoading(false);
    if (result.success) {
      setShowDisconnectDialog(false);
      toast.success(result.message || 'Proveedor desconectado correctamente');
      reloadSoon();
    } else {
      setDisconnectError(result.message || 'No se pudo desconectar. Inténtalo de nuevo.');
    }
  };

  const handleSyncAnthropicModels = async () => {
    if (provider.key !== 'anthropic') return;
    setSyncingModels(true);
    try {
      const result = await syncAnthropicModels();
      if (result.success) {
        const executableCount = result.models_checked.filter((m) => m.is_executable).length;
        const total = result.models_checked.length;
        const summary = `Modelos sincronizados: ${executableCount}/${total} ejecutables. Nuevos: ${result.models_added.length}.`;
        if (executableCount > 0) toast.success(summary);
        else toast.error(summary);
      } else {
        toast.error(result.error || 'Error al sincronizar modelos');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Error inesperado: ${msg}`);
    }
    setSyncingModels(false);
    reloadSoon(SYNC_RELOAD_DELAY_MS);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    const result = await testAiProviderConnectionWithVault(provider.key);
    setTestingConnection(false);
    // Traza de diagnóstico que devuelve el servidor: se conserva tal cual estaba.
    if (result.success) {
      toast.success(result.message || 'Conexión exitosa');
    } else {
      toast.error(result.message || 'Error de conexión');
    }
    reloadSoon();
  };

  const isUpdate = credentialMode === 'update';
  const saveCredential = isUpdate ? handleUpdateCredential : handleConnect;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Abrir acciones de ${provider.name}`}
              className="text-muted-foreground"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasCredential ? (
            <>
              <DropdownMenuItem
                onClick={() => setShowActiveDialog(true)}
                disabled={provider.connection_status !== 'connected'}
              >
                <Settings className="mr-2 h-4 w-4" />
                Configurar como activo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleTestConnection} disabled={testingConnection}>
                <RefreshCw className={`mr-2 h-4 w-4 ${testingConnection ? 'animate-spin' : ''}`} />
                {testingConnection ? 'Probando...' : 'Probar conexión'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCredentialMode('update')}>
                <Key className="mr-2 h-4 w-4" />
                Actualizar credencial
              </DropdownMenuItem>
              {provider.key === 'anthropic' && (
                <DropdownMenuItem onClick={handleSyncAnthropicModels} disabled={syncingModels}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  {syncingModels ? 'Sincronizando...' : 'Actualizar modelos disponibles'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setDisconnectError(null);
                  setShowDisconnectDialog(true);
                }}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar proveedor
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setCredentialMode('connect')}>
                <Key className="mr-2 h-4 w-4" />
                Conectar proveedor
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {provider.status === 'inactive' && (
            <DropdownMenuItem onClick={() => handleStatusChange('active')}>
              <Check className="mr-2 h-4 w-4" />
              Activar proveedor
            </DropdownMenuItem>
          )}
          {provider.status === 'active' && (
            <DropdownMenuItem onClick={() => handleStatusChange('inactive')}>
              <X className="mr-2 h-4 w-4" />
              Desactivar proveedor
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ModalShell
        open={showActiveDialog}
        onOpenChange={setShowActiveDialog}
        title="Configurar proveedor activo"
        description={`Elige el modelo con el que SellUp ejecutará la IA usando ${provider.name}.`}
        size="md"
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowActiveDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSetActive} disabled={!selectedModelId || loading}>
              Guardar configuración
            </Button>
          </>
        }
      >
        <Field label="Modelo base" required>
          <Select value={selectedModelId} onValueChange={(value) => setSelectedModelId(value || '')}>
            <SelectTrigger className="w-full">
              {selectedModelId ? (
                <span className="truncate">{providerModels.find((m) => m.id === selectedModelId)?.name}</span>
              ) : (
                <span className="text-muted-foreground">Seleccionar modelo</span>
              )}
            </SelectTrigger>
            <SelectContent>
              {providerModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </ModalShell>

      <ModalShell
        open={credentialMode !== null}
        onOpenChange={(open) => {
          if (!open) closeCredentialDialog();
        }}
        title={isUpdate ? `Actualizar credencial de ${provider.name}` : `Conectar ${provider.name}`}
        description={
          isUpdate
            ? 'La nueva API key reemplaza a la anterior. Después de guardarla tendrás que probar la conexión otra vez.'
            : 'Pega la API key del proveedor. Se guarda cifrada y no se vuelve a mostrar.'
        }
        size="md"
        actions={
          <>
            <Button type="button" variant="outline" onClick={closeCredentialDialog}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveCredential} disabled={!apiKey || loading}>
              {isUpdate ? 'Actualizar y probar' : 'Guardar credencial'}
            </Button>
          </>
        }
      >
        <ApiKeyField
          // Un campo nuevo por apertura: la clave vuelve a quedar oculta.
          key={credentialMode ?? 'closed'}
          id={isUpdate ? 'update-api-key' : 'api-key'}
          label={isUpdate ? 'Nueva API key' : 'API key'}
          placeholder={isUpdate ? 'Pegar nueva API key...' : 'Pegar API key...'}
          description="La clave se cifra y se guarda de forma segura en el servidor."
          value={apiKey}
          onChange={setApiKey}
        />
      </ModalShell>

      <ConfirmDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
        variant="destructive"
        icon={Unplug}
        title={`¿Desconectar ${provider.name}?`}
        description={
          <>
            Se elimina la credencial y este proveedor deja de poder usarse como activo. No se puede
            deshacer: para volver a conectarlo tendrás que pegar una API key nueva.
            {disconnectError && (
              <Alert variant="destructive" className="mt-3 text-left">
                <AlertDescription>{disconnectError}</AlertDescription>
              </Alert>
            )}
          </>
        }
        confirmLabel="Desconectar proveedor"
        loading={loading}
        onConfirm={handleDisconnect}
      />
    </>
  );
}
