'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Hash, CheckCircle2, ExternalLink, Eye, EyeOff } from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  testSlackConnectionAction,
  createSlackChannelAction,
  sendSlackTestMessageAction,
  disconnectSlack,
  configureSlackOAuthApp,
} from '@/modules/integrations/actions';

// ============================================================
// Connect Modal — recoge Client ID, Client Secret y Redirect URI
// ============================================================

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SlackConnectModal({ open, onOpenChange }: ConnectModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setClientId('');
    setClientSecret('');
    setRedirectUri('');
    setShowSecret(false);
    setError(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await configureSlackOAuthApp(clientId, clientSecret, redirectUri);
        if (!result.success) {
          setError(result.error ?? 'Error al guardar la configuración.');
          return;
        }
        // Credenciales guardadas — iniciar flujo OAuth
        window.location.href = '/api/integrations/slack/oauth/start';
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado. Intenta nuevamente.');
      }
    });
  }

  const canSubmit =
    clientId.trim().length > 0 && clientSecret.trim().length > 0 && redirectUri.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar Slack</DialogTitle>
          <DialogDescription>
            Introduce los datos de tu Slack App. SellUp los guardará de forma segura y abrirá el
            flujo OAuth para autorizar el acceso al workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Client ID */}
          <div className="space-y-1.5">
            <Label htmlFor="slack-client-id">Client ID</Label>
            <Input
              id="slack-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789012.987654321098"
              disabled={isPending}
              autoComplete="off"
              className="font-mono"
            />
          </div>

          {/* Client Secret */}
          <div className="space-y-1.5">
            <Label htmlFor="slack-client-secret">Client Secret</Label>
            <div className="relative">
              <Input
                id="slack-client-secret"
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
                disabled={isPending}
                autoComplete="off"
                className="pr-9 font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showSecret ? 'Ocultar secreto' : 'Mostrar secreto'}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Redirect URI */}
          <div className="space-y-1.5">
            <Label htmlFor="slack-redirect-uri">Redirect URI</Label>
            <Input
              id="slack-redirect-uri"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://tu-dominio.com/api/integrations/slack/oauth/callback"
              disabled={isPending}
              autoComplete="off"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Debe usar HTTPS y estar registrada en tu Slack App → OAuth &amp; Permissions.
            </p>
          </div>

          {/* Permisos requeridos */}
          <div className="rounded-lg border border-border/60 bg-surface-subtle px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              Bot Token Scopes requeridos
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {['channels:manage', 'chat:write'].map((scope) => (
                <Badge key={scope} variant="brand">
                  <CheckCircle2 />
                  {scope}
                </Badge>
              ))}
            </div>
          </div>

          <a
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Crear o gestionar Slack Apps
            <ExternalLink className="size-3" />
          </a>

          {error && <Alert variant="destructive">{error}</Alert>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            Guardar y conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <Button variant="outline" onClick={handleTest} disabled={isPending}>
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

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SlackCreateChannelModal({ open, onOpenChange }: CreateChannelModalProps) {
  const router = useRouter();
  const [channelName, setChannelName] = useState('sellup-alertas');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setChannelName('sellup-alertas');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await createSlackChannelAction(channelName);
      if (result.success) {
        setSuccessMsg(result.message ?? 'Canal creado correctamente.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1500);
      } else {
        setError(result.message ?? result.error ?? 'Error al crear el canal.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear canal oficial de SellUp</DialogTitle>
          <DialogDescription>
            Este canal recibirá alertas y comunicaciones operativas generadas por SellUp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="slack-channel">Nombre del canal</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Hash className="size-4" />
              </span>
              <Input
                id="slack-channel"
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                className="pl-9 font-mono"
                disabled={isPending}
                placeholder="sellup-alertas"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Solo letras minúsculas, números y guiones. Máximo 80 caracteres.
            </p>
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          {successMsg && <Alert variant="success">{successMsg}</Alert>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || channelName.trim().length === 0}>
            {isPending && <Loader2 className="animate-spin" />}
            Crear canal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

interface DisconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SlackDisconnectDialog({ open, onOpenChange }: DisconnectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setError(null);
    onOpenChange(false);
  }

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectSlack();
      if (result.success) {
        handleClose();
        router.refresh();
      } else {
        setError(result.error ?? 'Error al desconectar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desconectar Slack</DialogTitle>
          <DialogDescription>
            SellUp dejará de tener acceso al workspace. El canal creado en Slack no se eliminará.
            Podrás volver a conectar en cualquier momento.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive-solid" onClick={handleDisconnect} disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            Desconectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
