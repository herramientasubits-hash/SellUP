'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { IntegrationCredentialModal } from '@/components/settings/integration-credential-modal';
import { IntegrationDisconnectDialog } from '@/components/settings/integration-disconnect-dialog';
import { SecretInput } from '@/components/settings/secret-input';
import {
  connectTavily,
  updateTavilyApiKey,
  testTavilyConnectionAction,
  disconnectTavily,
} from '@/modules/integrations/actions';

const API_KEY_MIN_LENGTH = 16;
const API_KEY_PLACEHOLDER = 'tvly-••••••••••••••••••••';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Connect Modal
// ============================================================

export function TavilyConnectModal({ open, onOpenChange }: ModalProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar Tavily"
      description="La API Key se guarda de forma segura y permite que el Agente 1 haga búsquedas web controladas."
      submitLabel="Guardar credencial"
      canSubmit={apiKey.trim().length >= API_KEY_MIN_LENGTH}
      onSubmit={() => connectTavily(apiKey)}
      onReset={() => setApiKey('')}
      successFallback="API Key guardada correctamente."
      errorFallback="No se pudo guardar la API Key."
    >
      {({ isPending }) => (
        <>
          <Field
            label="API Key"
            description="La obtienes en app.tavily.com → Dashboard → API Keys. Las claves empiezan por «tvly-»."
            disabled={isPending}
          >
            <SecretInput
              value={apiKey}
              onValueChange={setApiKey}
              secretName="API Key"
              placeholder={API_KEY_PLACEHOLDER}
            />
          </Field>

          <Alert variant="warning">
            Después de guardar podrás probar la conexión. Cada prueba gasta 1 crédito de Tavily:
            úsala solo cuando haga falta.
          </Alert>
        </>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Update API Key Modal
// ============================================================

export function TavilyUpdateModal({ open, onOpenChange }: ModalProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Actualizar API Key de Tavily"
      description="La nueva API Key reemplaza a la anterior. Después de actualizarla, vuelve a probar la conexión."
      submitLabel="Actualizar API Key"
      canSubmit={apiKey.trim().length >= API_KEY_MIN_LENGTH}
      onSubmit={() => updateTavilyApiKey(apiKey)}
      onReset={() => setApiKey('')}
      successFallback="API Key actualizada."
      errorFallback="No se pudo actualizar la API Key."
    >
      {({ isPending }) => (
        <Field label="Nueva API Key" disabled={isPending}>
          <SecretInput
            value={apiKey}
            onValueChange={setApiKey}
            secretName="API Key"
            placeholder={API_KEY_PLACEHOLDER}
          />
        </Field>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Test Connection Button
// Probar gasta cuota del proveedor: se pregunta antes de ejecutar.
// ============================================================

interface TestConnectionProps {
  disabled?: boolean;
}

export function TavilyTestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  function handleConfirm() {
    setShowConfirm(false);
    setResult(null);

    startTransition(async () => {
      const res = await testTavilyConnectionAction();
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        onClick={() => setShowConfirm(true)}
        disabled={isPending || disabled}
      >
        {isPending && <Loader2 className="animate-spin" />}
        Probar conexión
      </Button>

      {result && (
        <Alert variant={result.success ? 'success' : 'destructive'}>
          {result.message ?? (result.success ? 'La conexión funciona.' : 'No se pudo conectar. Revisa la credencial e inténtalo de nuevo.')}
        </Alert>
      )}

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        variant="warning"
        title="¿Probar la conexión con Tavily?"
        description={
          <>
            Esta prueba gasta <strong>1 crédito</strong> de tu plan de Tavily.
          </>
        }
        confirmLabel="Sí, probar conexión"
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// ============================================================
// Disconnect Dialog
// ============================================================

export function TavilyDisconnectDialog({ open, onOpenChange }: ModalProps) {
  return (
    <IntegrationDisconnectDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desconectar Tavily"
      description="SellUp eliminará la API Key guardada y el Agente 1 volverá a usar el proveedor de prueba por defecto. Puedes volver a conectar Tavily cuando quieras."
      onDisconnect={disconnectTavily}
    />
  );
}

// ============================================================
// Main Actions Panel
// ============================================================

interface TavilyActionsPanelProps {
  hasCredential: boolean;
}

export function TavilyActionsPanel({ hasCredential }: TavilyActionsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hasCredential ? (
        <Button onClick={() => setConnectOpen(true)}>Conectar Tavily</Button>
      ) : (
        <>
          <TavilyTestConnectionButton />
          <Button variant="outline" onClick={() => setUpdateOpen(true)}>
            Actualizar API Key
          </Button>
          <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
            Desconectar
          </Button>
        </>
      )}

      <TavilyConnectModal open={connectOpen} onOpenChange={setConnectOpen} />
      <TavilyUpdateModal open={updateOpen} onOpenChange={setUpdateOpen} />
      <TavilyDisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} />
    </div>
  );
}
