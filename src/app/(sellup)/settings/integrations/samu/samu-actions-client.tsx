'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/forms/field';
import { IntegrationCredentialModal } from '@/components/settings/integration-credential-modal';
import { IntegrationDisconnectDialog } from '@/components/settings/integration-disconnect-dialog';
import { SecretInput } from '@/components/settings/secret-input';
import {
  connectSamu,
  updateSamuApiKey,
  testSamuConnectionAction,
  disconnectSamu,
} from '@/modules/integrations/actions';

const API_KEY_MIN_LENGTH = 8;
const API_KEY_PLACEHOLDER = '••••••••••••••••••••';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Connect Modal
// ============================================================

export function SamuConnectModal({ open, onOpenChange }: ModalProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar Samu IA"
      description="La API Key se guarda de forma segura y permite validar la conexión con Samu IA."
      submitLabel="Guardar credencial"
      canSubmit={apiKey.trim().length >= API_KEY_MIN_LENGTH}
      onSubmit={() => connectSamu(apiKey)}
      onReset={() => setApiKey('')}
      successFallback="API Key guardada correctamente."
      errorFallback="No se pudo guardar la API Key."
    >
      {({ isPending }) => (
        <>
          <Field
            label="API Key"
            description="La obtienes en Samu IA → Configuración → Integraciones → API. Requiere plan Enterprise."
            disabled={isPending}
          >
            <SecretInput
              value={apiKey}
              onValueChange={setApiKey}
              secretName="API Key"
              placeholder={API_KEY_PLACEHOLDER}
            />
          </Field>

          <Alert variant="info">
            Qué reuniones, transcripciones y participantes verás depende de los permisos y del
            entorno de esta API Key.
          </Alert>
        </>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Update API Key Modal
// ============================================================

export function SamuUpdateModal({ open, onOpenChange }: ModalProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Actualizar API Key de Samu IA"
      description="La nueva API Key reemplaza a la anterior. Después de actualizarla, vuelve a probar la conexión."
      submitLabel="Actualizar API Key"
      canSubmit={apiKey.trim().length >= API_KEY_MIN_LENGTH}
      onSubmit={() => updateSamuApiKey(apiKey)}
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
// ============================================================

interface TestConnectionProps {
  disabled?: boolean;
}

export function SamuTestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  function handleTest() {
    setResult(null);

    startTransition(async () => {
      const res = await testSamuConnectionAction();
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleTest} disabled={isPending || disabled}>
        {isPending && <Loader2 className="animate-spin" />}
        Probar conexión
      </Button>

      {result && (
        <Alert variant={result.success ? 'success' : 'destructive'}>
          {result.message ?? (result.success ? 'Conexión exitosa.' : 'Error de conexión.')}
        </Alert>
      )}
    </div>
  );
}

// ============================================================
// Disconnect Dialog
// ============================================================

export function SamuDisconnectDialog({ open, onOpenChange }: ModalProps) {
  return (
    <IntegrationDisconnectDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desconectar Samu IA"
      description="SellUp eliminará la API Key guardada. Puedes volver a conectar Samu IA cuando quieras con una credencial nueva."
      onDisconnect={disconnectSamu}
    />
  );
}

// ============================================================
// Main Actions Panel
// ============================================================

interface SamuActionsPanelProps {
  hasCredential: boolean;
}

export function SamuActionsPanel({ hasCredential }: SamuActionsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hasCredential ? (
        <Button onClick={() => setConnectOpen(true)}>Conectar Samu IA</Button>
      ) : (
        <>
          <SamuTestConnectionButton />
          <Button variant="outline" onClick={() => setUpdateOpen(true)}>
            Actualizar API Key
          </Button>
          <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
            Desconectar
          </Button>
        </>
      )}

      <SamuConnectModal open={connectOpen} onOpenChange={setConnectOpen} />
      <SamuUpdateModal open={updateOpen} onOpenChange={setUpdateOpen} />
      <SamuDisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} />
    </div>
  );
}
