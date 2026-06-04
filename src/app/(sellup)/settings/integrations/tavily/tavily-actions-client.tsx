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
  connectTavily,
  updateTavilyApiKey,
  testTavilyConnectionAction,
  disconnectTavily,
} from '@/modules/integrations/actions';

// ============================================================
// Connect Modal
// ============================================================

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TavilyConnectModal({ open, onOpenChange }: ConnectModalProps) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setApiKey('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await connectTavily(apiKey);
      if (result.success) {
        setSuccessMsg(result.message ?? 'API Key guardada correctamente.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al guardar la API Key.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Conectar Tavily</DialogTitle>
          <DialogDescription>
            La API Key se almacenará de forma segura en Vault y permitirá
            que el Agente 1 realice búsquedas web controladas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tavily-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="tavily-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="tvly-••••••••••••••••••••"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10 font-mono text-sm"
                disabled={isPending}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowKey((v) => !v)}
                tabIndex={-1}
                aria-label={showKey ? 'Ocultar API Key' : 'Mostrar API Key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Obtén tu API Key en{' '}
              <span className="font-medium text-foreground">app.tavily.com</span>{' '}
              → Dashboard → API Keys. Las claves comienzan con{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">tvly-</code>.
            </p>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                El botón &ldquo;Probar conexión&rdquo; (disponible después de guardar)
                consume 1 crédito de Tavily. No usar de forma masiva.
              </p>
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
            disabled={isPending || apiKey.trim().length < 16}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar credencial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Update API Key Modal
// ============================================================

interface UpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TavilyUpdateModal({ open, onOpenChange }: UpdateModalProps) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setApiKey('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await updateTavilyApiKey(apiKey);
      if (result.success) {
        setSuccessMsg(result.message ?? 'API Key actualizada.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al actualizar la API Key.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Actualizar API Key de Tavily</DialogTitle>
          <DialogDescription>
            La nueva API Key reemplazará a la anterior. Después de actualizarla,
            deberás probar nuevamente la conexión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tavily-new-api-key">Nueva API Key</Label>
            <div className="relative">
              <Input
                id="tavily-new-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="tvly-••••••••••••••••••••"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10 font-mono text-sm"
                disabled={isPending}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowKey((v) => !v)}
                tabIndex={-1}
                aria-label={showKey ? 'Ocultar API Key' : 'Mostrar API Key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
            disabled={isPending || apiKey.trim().length < 16}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Actualizar API Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Test Connection Button
// Advierte que consume 1 crédito antes de ejecutar.
// ============================================================

interface TestConnectionProps {
  disabled?: boolean;
}

export function TavilyTestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null);
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

  if (showConfirm) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            Esta acción consumirá <strong>1 crédito</strong> de tu plan Tavily.
            ¿Deseas continuar?
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Sí, probar conexión
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowConfirm(false)} disabled={isPending}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        onClick={() => setShowConfirm(true)}
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

export function TavilyDisconnectDialog({ open, onOpenChange }: DisconnectDialogProps) {
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
      const result = await disconnectTavily();
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
          <DialogTitle className="">Desconectar Tavily</DialogTitle>
          <DialogDescription>
            SellUp eliminará la API Key almacenada. El Agente 1 volverá a usar
            el proveedor mock por defecto. Puedes volver a conectar Tavily
            en cualquier momento.
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
          <Button variant="destructive" onClick={handleDisconnect} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDisconnectOpen(true)}
          >
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
