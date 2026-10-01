'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/forms/field';
import { IntegrationCredentialModal } from '@/components/settings/integration-credential-modal';
import {
  IntegrationDisconnectDialog,
  type IntegrationDisconnectResult,
} from '@/components/settings/integration-disconnect-dialog';
import { SecretInput } from '@/components/settings/secret-input';
import {
  connectHubSpot,
  updateHubSpotCredential,
  testHubSpotConnectionAction,
  disconnectHubSpot,
} from '@/modules/integrations/actions';

const TOKEN_MIN_LENGTH = 10;
const TOKEN_PLACEHOLDER = 'pat-xx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Connect Modal
// ============================================================

export function HubSpotConnectModal({ open, onOpenChange }: ModalProps) {
  const [token, setToken] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar HubSpot"
      description="Pega el access token de una Private App de HubSpot. Se guarda de forma segura y no vuelve a mostrarse."
      submitLabel="Guardar y probar conexión"
      canSubmit={token.trim().length >= TOKEN_MIN_LENGTH}
      onSubmit={() => connectHubSpot(token)}
      onReset={() => setToken('')}
      successFallback="Conectado correctamente."
      errorFallback="No se pudo guardar la credencial."
    >
      {({ isPending }) => (
        <Field
          label="Access token"
          description="Lo generas en HubSpot → Configuración → Integraciones → Private Apps."
          disabled={isPending}
        >
          <SecretInput
            value={token}
            onValueChange={setToken}
            secretName="token"
            placeholder={TOKEN_PLACEHOLDER}
          />
        </Field>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Update Credential Modal
// ============================================================

export function HubSpotUpdateModal({ open, onOpenChange }: ModalProps) {
  const [token, setToken] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Actualizar credencial de HubSpot"
      description="La nueva credencial reemplaza a la anterior. Después de actualizarla, vuelve a probar la conexión."
      submitLabel="Actualizar credencial"
      canSubmit={token.trim().length >= TOKEN_MIN_LENGTH}
      onSubmit={() => updateHubSpotCredential(token)}
      onReset={() => setToken('')}
      successFallback="Credencial actualizada."
      errorFallback="No se pudo actualizar la credencial."
    >
      {({ isPending }) => (
        <Field label="Nuevo access token" disabled={isPending}>
          <SecretInput
            value={token}
            onValueChange={setToken}
            secretName="token"
            placeholder={TOKEN_PLACEHOLDER}
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

export function HubSpotTestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  function handleTest() {
    setResult(null);

    startTransition(async () => {
      const res = await testHubSpotConnectionAction();
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
          {result.message ?? (result.success ? 'La conexión funciona.' : 'No se pudo conectar. Revisa la credencial e inténtalo de nuevo.')}
        </Alert>
      )}
    </div>
  );
}

// ============================================================
// Disconnect Dialog
// ============================================================

interface DisconnectDialogProps extends ModalProps {
  /**
   * La acción que desconecta. En la app es siempre la de servidor; el parámetro
   * existe para poder probar el diálogo sin tocar HubSpot.
   */
  disconnectAction?: () => Promise<IntegrationDisconnectResult>;
}

export function HubSpotDisconnectDialog({
  open,
  onOpenChange,
  disconnectAction = disconnectHubSpot,
}: DisconnectDialogProps) {
  return (
    <IntegrationDisconnectDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desconectar HubSpot"
      description="SellUp dejará de considerar HubSpot disponible. Puedes volver a conectarlo cuando quieras con una credencial nueva."
      onDisconnect={disconnectAction}
    />
  );
}

// ============================================================
// Main Actions Panel (orchestrates all modals)
// ============================================================

interface HubSpotActionsPanelProps {
  hasCredential: boolean;
}

export function HubSpotActionsPanel({ hasCredential }: HubSpotActionsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-start gap-2">
      {!hasCredential ? (
        <Button onClick={() => setConnectOpen(true)}>Conectar HubSpot</Button>
      ) : (
        <>
          <HubSpotTestConnectionButton />
          <Button variant="outline" onClick={() => setUpdateOpen(true)}>
            Actualizar credencial
          </Button>
          <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
            Desconectar
          </Button>
        </>
      )}

      <HubSpotConnectModal open={connectOpen} onOpenChange={setConnectOpen} />
      <HubSpotUpdateModal open={updateOpen} onOpenChange={setUpdateOpen} />
      <HubSpotDisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} />
    </div>
  );
}
