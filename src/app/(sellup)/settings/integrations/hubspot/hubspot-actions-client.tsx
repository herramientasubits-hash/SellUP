'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  connectHubSpot,
  updateHubSpotCredential,
  testHubSpotConnectionAction,
  disconnectHubSpot,
} from '@/modules/integrations/actions';

// ============================================================
// Connect Modal
// ============================================================

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HubSpotConnectModal({ open, onOpenChange }: ConnectModalProps) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setToken('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await connectHubSpot(token);
      if (result.success) {
        setSuccessMsg(result.message ?? 'Conectado correctamente.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al guardar la credencial.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Conectar HubSpot</DialogTitle>
          <DialogDescription>
            Ingresa el access token de una Private App de HubSpot. Esta credencial
            se almacenará de forma segura y no volverá a mostrarse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="hs-token">Access token</Label>
            <div className="relative">
              <Input
                id="hs-token"
                type={showToken ? 'text' : 'password'}
                placeholder="pat-xx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="pr-10 font-mono text-sm"
                disabled={isPending}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowToken((v) => !v)}
                tabIndex={-1}
                aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Genera tu token en HubSpot → Configuración → Integraciones → Private Apps.
            </p>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          {successMsg && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
              {successMsg}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || token.trim().length < 10}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar y probar conexión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Update Credential Modal
// ============================================================

interface UpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HubSpotUpdateModal({ open, onOpenChange }: UpdateModalProps) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setToken('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await updateHubSpotCredential(token);
      if (result.success) {
        setSuccessMsg(result.message ?? 'Credencial actualizada.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al actualizar la credencial.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Actualizar credencial de HubSpot</DialogTitle>
          <DialogDescription>
            La nueva credencial reemplazará a la anterior. Después de actualizarla,
            deberás probar nuevamente la conexión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="hs-new-token">Nuevo access token</Label>
            <div className="relative">
              <Input
                id="hs-new-token"
                type={showToken ? 'text' : 'password'}
                placeholder="pat-xx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="pr-10 font-mono text-sm"
                disabled={isPending}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowToken((v) => !v)}
                tabIndex={-1}
                aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          {successMsg && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
              {successMsg}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || token.trim().length < 10}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Actualizar credencial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null);

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
      <Button
        variant="outline"
        onClick={handleTest}
        disabled={isPending || disabled}
      >
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Probar conexión
      </Button>

      {result && (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            result.success
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {result.message ?? (result.success ? 'Conexión exitosa.' : 'Error de conexión.')}
        </p>
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

export function HubSpotDisconnectDialog({ open, onOpenChange }: DisconnectDialogProps) {
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
      const result = await disconnectHubSpot();
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
          <DialogTitle className="">Desconectar HubSpot</DialogTitle>
          <DialogDescription>
            SellUp dejará de considerar HubSpot disponible. Podrás volver a conectarlo
            en cualquier momento ingresando una nueva credencial.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Desconectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Main Actions Panel (orchestrates all modals)
// ============================================================

interface HubSpotActionsPanelProps {
  hasCredential: boolean;
}

export function HubSpotActionsPanel({
  hasCredential,
}: HubSpotActionsPanelProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hasCredential ? (
        <Button onClick={() => setConnectOpen(true)}>
          Conectar HubSpot
        </Button>
      ) : (
        <>
          <HubSpotTestConnectionButton />
          <Button variant="outline" onClick={() => setUpdateOpen(true)}>
            Actualizar credencial
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDisconnectOpen(true)}
          >
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
