'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Hash, CheckCircle2, ExternalLink } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Field, FieldDescription, FieldLabel } from '@/components/forms/field';
import { Text } from '@/components/typography';
import { ModalShell } from '@/components/shared/modal-shell';
import { IntegrationCredentialModal } from '@/components/settings/integration-credential-modal';
import { IntegrationDisconnectDialog } from '@/components/settings/integration-disconnect-dialog';
import { SecretInput } from '@/components/settings/secret-input';
import {
  testSlackConnectionAction,
  createSlackChannelAction,
  sendSlackTestMessageAction,
  disconnectSlack,
  configureSlackOAuthApp,
} from '@/modules/integrations/actions';

const REQUIRED_BOT_SCOPES = ['channels:manage', 'chat:write'] as const;
const DEFAULT_CHANNEL_NAME = 'sellup-alertas';
const CHANNEL_CREATED_CLOSE_DELAY_MS = 1500;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================
// Connect Modal — recoge Client ID, Client Secret y Redirect URI
// ============================================================

function SlackConnectModal({ open, onOpenChange }: ModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return;
    if (!nextOpen) {
      setClientId('');
      setClientSecret('');
      setRedirectUri('');
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await configureSlackOAuthApp(clientId, clientSecret, redirectUri);
        if (!result.success) {
          setError(result.error ?? 'No se pudo guardar la configuración.');
          return;
        }
        // Credenciales guardadas — iniciar flujo OAuth
        window.location.href = '/api/integrations/slack/oauth/start';
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Algo salió mal. Inténtalo de nuevo.');
      }
    });
  }

  const canSubmit =
    clientId.trim().length > 0 && clientSecret.trim().length > 0 && redirectUri.trim().length > 0;

  return (
    <ModalShell
      open={open}
      onOpenChange={handleOpenChange}
      size="lg"
      title="Conectar Slack"
      description="Escribe los datos de tu Slack App. SellUp los guarda de forma segura y te lleva a Slack para autorizar el acceso al workspace."
      actions={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            Guardar y conectar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Client ID" disabled={isPending}>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789012.987654321098"
            autoComplete="off"
            className="font-mono"
          />
        </Field>

        <Field label="Client Secret" disabled={isPending}>
          <SecretInput
            value={clientSecret}
            onValueChange={setClientSecret}
            secretName="secreto"
            placeholder="••••••••••••••••••••••••••••••••"
          />
        </Field>

        <Field
          label="Redirect URI"
          description="Debe usar HTTPS y estar registrada en tu Slack App → OAuth & Permissions."
          disabled={isPending}
        >
          <Input
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder="https://tu-dominio.com/api/integrations/slack/oauth/callback"
            autoComplete="off"
            className="font-mono"
          />
        </Field>

        {/* Permisos requeridos */}
        <div className="space-y-1.5">
          <Text size="xs" weight="semibold" tone="muted">
            Permisos que debe tener el bot (Bot Token Scopes)
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {REQUIRED_BOT_SCOPES.map((scope) => (
              <Badge key={scope} variant="brand">
                <CheckCircle2 />
                {scope}
              </Badge>
            ))}
          </div>
        </div>

        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
            Crear o gestionar Slack Apps
            <ExternalLink />
          </a>
        </Button>

        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </ModalShell>
  );
}

// ============================================================
// Connect Button — abre el modal de configuración OAuth
// ============================================================

export function SlackConnectButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Conectar Slack</Button>
      <SlackConnectModal open={open} onOpenChange={setOpen} />
    </>
  );
}

// ============================================================
// Test Connection Button
// ============================================================

export function SlackTestConnectionButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  function handleTest() {
    setResult(null);
    startTransition(async () => {
      const res = await testSlackConnectionAction();
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleTest} disabled={isPending}>
        {isPending && <Loader2 className="animate-spin" />}
        Probar conexión
      </Button>

      {result && (
        <Alert variant={result.success ? 'success' : 'destructive'}>
          {result.message ?? (result.success ? 'Conexión verificada.' : 'Error de conexión.')}
        </Alert>
      )}
    </div>
  );
}

// ============================================================
// Create Channel Modal
// ============================================================

export function SlackCreateChannelModal({ open, onOpenChange }: ModalProps) {
  const [channelName, setChannelName] = useState(DEFAULT_CHANNEL_NAME);

  return (
    <IntegrationCredentialModal
      open={open}
      onOpenChange={onOpenChange}
      title="Crear canal oficial de SellUp"
      description="Este canal recibirá las alertas y los avisos operativos que genere SellUp."
      submitLabel="Crear canal"
      canSubmit={channelName.trim().length > 0}
      onSubmit={async () => {
        const result = await createSlackChannelAction(channelName);
        // Esta acción explica su fallo en `message`; el diálogo lo espera en `error`.
        return { ...result, error: result.message ?? result.error };
      }}
      onReset={() => setChannelName(DEFAULT_CHANNEL_NAME)}
      successFallback="Canal creado correctamente."
      errorFallback="No se pudo crear el canal."
      closeDelayMs={CHANNEL_CREATED_CLOSE_DELAY_MS}
    >
      {({ isPending }) => (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="slack-channel">Nombre del canal</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <Hash />
            </InputGroupAddon>
            <InputGroupInput
              id="slack-channel"
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="font-mono"
              disabled={isPending}
              placeholder={DEFAULT_CHANNEL_NAME}
              autoComplete="off"
              aria-describedby="slack-channel-description"
            />
          </InputGroup>
          <FieldDescription id="slack-channel-description">
            Solo letras minúsculas, números y guiones. Máximo 80 caracteres.
          </FieldDescription>
        </div>
      )}
    </IntegrationCredentialModal>
  );
}

// ============================================================
// Send Test Message Button
// ============================================================

export function SlackSendTestMessageButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  function handleSend() {
    setResult(null);
    startTransition(async () => {
      const res = await sendSlackTestMessageAction();
      setResult(res);
    });
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={handleSend} disabled={isPending}>
        {isPending && <Loader2 className="animate-spin" />}
        Enviar mensaje de prueba
      </Button>

      {result && (
        <Alert variant={result.success ? 'success' : 'destructive'}>
          {result.message ?? (result.success ? 'Mensaje enviado.' : 'Error al enviar.')}
        </Alert>
      )}
    </div>
  );
}

// ============================================================
// Disconnect Dialog
// ============================================================

export function SlackDisconnectDialog({ open, onOpenChange }: ModalProps) {
  return (
    <IntegrationDisconnectDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Desconectar Slack"
      description="SellUp dejará de tener acceso al workspace. El canal creado en Slack no se elimina y puedes volver a conectar cuando quieras."
      onDisconnect={disconnectSlack}
    />
  );
}

// ============================================================
// Main Actions Panel
// ============================================================

interface SlackActionsPanelProps {
  isConnected: boolean;
}

export function SlackActionsPanel({ isConnected }: SlackActionsPanelProps) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  if (!isConnected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SlackConnectButton />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <SlackTestConnectionButton />

      <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
        Desconectar
      </Button>

      <SlackDisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} />
    </div>
  );
}
