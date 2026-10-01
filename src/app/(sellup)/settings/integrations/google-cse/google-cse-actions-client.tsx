'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/forms/field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { IntegrationCredentialModal } from '@/components/settings/integration-credential-modal';
import { IntegrationDisconnectDialog } from '@/components/settings/integration-disconnect-dialog';
import { SecretInput } from '@/components/settings/secret-input';
import {
  connectGoogleCSE,
  updateGoogleCSECredentials,
  testGoogleCSEConnectionAction,
  disconnectGoogleCSE,
} from '@/modules/integrations/actions';

const API_KEY_MIN_LENGTH = 10;
const CX_MIN_LENGTH = 5;
const API_KEY_PLACEHOLDER = 'AIza••••••••••••••••••••••••••••••••••';
const CX_PLACEHOLDER = '67c93085cfde84a6d';

function canSubmitCredentials(apiKey: string, cx: string): boolean {
  return apiKey.trim().length >= API_KEY_MIN_LENGTH && cx.trim().length >= CX_MIN_LENGTH;
}

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Connect Modal
// ============================================================

export function GoogleCSEConnectModal({ open, onOpenChange }: ModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [cx, setCx] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar Google Custom Search"
      description="Las credenciales se guardan de forma segura y permiten que el Agente 1 haga búsquedas web con Google CSE."
      submitLabel="Guardar credenciales"
      canSubmit={canSubmitCredentials(apiKey, cx)}
      onSubmit={() => connectGoogleCSE(apiKey, cx)}
      onReset={() => {
        setApiKey('');
        setCx('');
      }}
      successFallback="Credenciales guardadas correctamente."
      errorFallback="No se pudieron guardar las credenciales."
    >
      {({ isPending }) => (
        <>
          <Field
            label="API Key de Google Cloud"
            description="La obtienes en console.cloud.google.com → Credenciales. Activa antes «Custom Search API»."
            disabled={isPending}
          >
            <SecretInput
              value={apiKey}
              onValueChange={setApiKey}
              secretName="API Key"
              placeholder={API_KEY_PLACEHOLDER}
            />
          </Field>

          <Field
            label="Search Engine ID (cx)"
            description="Está en programmablesearchengine.google.com → Panel de control → ID del motor de búsqueda."
            disabled={isPending}
          >
            <Input
              type="text"
              placeholder={CX_PLACEHOLDER}
              value={cx}
              onChange={(e) => setCx(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </Field>

          <Alert variant="warning">
            El plan gratuito incluye <strong>100 consultas al día</strong>. Cada prueba de conexión
            gasta 1 de ellas.
          </Alert>
        </>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Update Credentials Modal
// ============================================================

interface UpdateModalProps extends ModalProps {
  cx_masked?: string;
}

export function GoogleCSEUpdateModal({ open, onOpenChange, cx_masked }: UpdateModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [cx, setCx] = useState('');

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Actualizar credenciales de Google CSE"
      description="Las nuevas credenciales reemplazan a las anteriores. Después de actualizarlas, vuelve a probar la conexión."
      submitLabel="Actualizar credenciales"
      canSubmit={canSubmitCredentials(apiKey, cx)}
      onSubmit={() => updateGoogleCSECredentials(apiKey, cx)}
      onReset={() => {
        setApiKey('');
        setCx('');
      }}
      successFallback="Credenciales actualizadas."
      errorFallback="No se pudieron actualizar las credenciales."
    >
      {({ isPending }) => (
        <>
          <Field label="Nueva API Key de Google Cloud" disabled={isPending}>
            <SecretInput
              value={apiKey}
              onValueChange={setApiKey}
              secretName="API Key"
              placeholder={API_KEY_PLACEHOLDER}
            />
          </Field>

          <Field
            label="Nuevo Search Engine ID (cx)"
            description={cx_masked ? `CX actual: ${cx_masked}` : undefined}
            disabled={isPending}
          >
            <Input
              type="text"
              placeholder={cx_masked ?? CX_PLACEHOLDER}
              value={cx}
              onChange={(e) => setCx(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </Field>
        </>
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

export function GoogleCSETestConnectionButton({ disabled }: TestConnectionProps) {
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
      const res = await testGoogleCSEConnectionAction();
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
        title="¿Probar la conexión con Google CSE?"
        description={
          <>
            Esta prueba gasta <strong>1 consulta</strong> de tu cuota diaria de Google CSE (100 gratuitas
            al día).
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

export function GoogleCSEDisconnectDialog({ open, onOpenChange }: ModalProps) {
  return (
    <IntegrationDisconnectDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desconectar Google Custom Search"
      description="SellUp eliminará las dos credenciales guardadas (API Key y Search Engine ID) y el Agente 1 dejará de buscar con Google CSE. Puedes volver a conectarlo cuando quieras."
      onDisconnect={disconnectGoogleCSE}
    />
  );
}

// ============================================================
// Main Actions Panel
// ============================================================

interface GoogleCSEActionsPanelProps {
  hasCredential: boolean;
  cx_masked?: string;
}

export function GoogleCSEActionsPanel({ hasCredential, cx_masked }: GoogleCSEActionsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hasCredential ? (
        <Button onClick={() => setConnectOpen(true)}>Conectar Google CSE</Button>
      ) : (
        <>
          <GoogleCSETestConnectionButton />
          <Button variant="outline" onClick={() => setUpdateOpen(true)}>
            Actualizar credenciales
          </Button>
          <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
            Desconectar
          </Button>
        </>
      )}

      <GoogleCSEConnectModal open={connectOpen} onOpenChange={setConnectOpen} />
      <GoogleCSEUpdateModal open={updateOpen} onOpenChange={setUpdateOpen} cx_masked={cx_masked} />
      <GoogleCSEDisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} />
    </div>
  );
}
