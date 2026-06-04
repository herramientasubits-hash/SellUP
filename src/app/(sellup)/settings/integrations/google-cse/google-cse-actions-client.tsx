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
  connectGoogleCSE,
  updateGoogleCSECredentials,
  testGoogleCSEConnectionAction,
  disconnectGoogleCSE,
} from '@/modules/integrations/actions';

// ============================================================
// Connect Modal
// ============================================================

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GoogleCSEConnectModal({ open, onOpenChange }: ConnectModalProps) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [cx, setCx] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setApiKey('');
    setCx('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await connectGoogleCSE(apiKey, cx);
      if (result.success) {
        setSuccessMsg(result.message ?? 'Credenciales guardadas correctamente.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al guardar las credenciales.');
      }
    });
  }

  const canSubmit = apiKey.trim().length >= 10 && cx.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Conectar Google Custom Search</DialogTitle>
          <DialogDescription>
            Las credenciales se almacenarán de forma segura en Vault y permitirán
            que el Agente 1 realice búsquedas web a través de Google CSE.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="gcse-api-key">API Key de Google Cloud</Label>
            <div className="relative">
              <Input
                id="gcse-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="AIza••••••••••••••••••••••••••••••••••"
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
              <span className="font-medium text-foreground">console.cloud.google.com</span>{' '}
              → Credenciales. Habilita{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">Custom Search API</code>{' '}
              antes de usar.
            </p>
          </div>

          {/* Search Engine ID / CX */}
          <div className="space-y-2">
            <Label htmlFor="gcse-cx">Search Engine ID (cx)</Label>
            <Input
              id="gcse-cx"
              type="text"
              placeholder="67c93085cfde84a6d"
              value={cx}
              onChange={(e) => setCx(e.target.value)}
              className="font-mono text-sm"
              disabled={isPending}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Encuéntralo en{' '}
              <span className="font-medium text-foreground">programmablesearchengine.google.com</span>{' '}
              → Panel de control → ID del motor de búsqueda.
            </p>
          </div>

          {/* Quota note */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                El plan gratuito incluye <strong>100 consultas/día</strong>. El botón
                &ldquo;Probar conexión&rdquo; consume 1 consulta de tu cuota diaria.
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
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar credenciales
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Update Credentials Modal
// ============================================================

interface UpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cx_masked?: string;
}

export function GoogleCSEUpdateModal({ open, onOpenChange, cx_masked }: UpdateModalProps) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [cx, setCx] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleClose() {
    if (isPending) return;
    setApiKey('');
    setCx('');
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const result = await updateGoogleCSECredentials(apiKey, cx);
      if (result.success) {
        setSuccessMsg(result.message ?? 'Credenciales actualizadas.');
        setTimeout(() => {
          handleClose();
          router.refresh();
        }, 1200);
      } else {
        setError(result.error ?? 'Error al actualizar las credenciales.');
      }
    });
  }

  const canSubmit = apiKey.trim().length >= 10 && cx.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="">Actualizar credenciales de Google CSE</DialogTitle>
          <DialogDescription>
            Las nuevas credenciales reemplazarán a las anteriores. Después de
            actualizar, deberás probar nuevamente la conexión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="gcse-new-api-key">Nueva API Key de Google Cloud</Label>
            <div className="relative">
              <Input
                id="gcse-new-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="AIza••••••••••••••••••••••••••••••••••"
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

          {/* CX */}
          <div className="space-y-2">
            <Label htmlFor="gcse-new-cx">Nuevo Search Engine ID (cx)</Label>
            <Input
              id="gcse-new-cx"
              type="text"
              placeholder={cx_masked ?? '67c93085cfde84a6d'}
              value={cx}
              onChange={(e) => setCx(e.target.value)}
              className="font-mono text-sm"
              disabled={isPending}
              autoComplete="off"
            />
            {cx_masked && (
              <p className="text-[11px] text-muted-foreground">
                CX actual:{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
                  {cx_masked}
                </code>
              </p>
            )}
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
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Actualizar credenciales
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Test Connection Button
// Advierte que consume 1 consulta del quota diario.
// ============================================================

interface TestConnectionProps {
  disabled?: boolean;
}

export function GoogleCSETestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null);
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

  if (showConfirm) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            Esta acción consumirá <strong>1 consulta</strong> de tu cuota diaria de Google CSE
            (100 gratuitas/día). ¿Deseas continuar?
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Sí, probar conexión
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConfirm(false)}
            disabled={isPending}
          >
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

export function GoogleCSEDisconnectDialog({ open, onOpenChange }: DisconnectDialogProps) {
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
      const result = await disconnectGoogleCSE();
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
          <DialogTitle className="">Desconectar Google Custom Search</DialogTitle>
          <DialogDescription>
            SellUp eliminará ambas credenciales almacenadas (API Key y Search Engine ID).
            El Agente 1 dejará de usar Google CSE como proveedor de búsqueda.
            Puedes volver a conectarlo en cualquier momento.
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
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDisconnectOpen(true)}
          >
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
