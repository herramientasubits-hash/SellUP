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
  connectSamu,
  updateSamuApiKey,
  testSamuConnectionAction,
  disconnectSamu,
} from '@/modules/integrations/actions';

// ============================================================
// Connect Modal
// ============================================================

interface ConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SamuConnectModal({ open, onOpenChange }: ConnectModalProps) {
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
      const result = await connectSamu(apiKey);
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
          <DialogTitle className="font-heading">Conectar Samu IA</DialogTitle>
          <DialogDescription>
            La API Key se almacenará de forma segura en Vault y permitirá validar
            la conexión con Samu IA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="samu-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="samu-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="••••••••••••••••••••"
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
              Obtén tu API Key en Samu IA → Configuración → Integraciones → API.
              Requiere plan Enterprise.
            </p>
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              La disponibilidad de reuniones, transcripciones y participantes dependerá
              de los permisos y del entorno asociado a esta API Key.
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
            disabled={isPending || apiKey.trim().length < 8}
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

export function SamuUpdateModal({ open, onOpenChange }: UpdateModalProps) {
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
      const result = await updateSamuApiKey(apiKey);
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
          <DialogTitle className="font-heading">Actualizar API Key de Samu IA</DialogTitle>
          <DialogDescription>
            La nueva API Key reemplazará a la anterior. Después de actualizarla,
            deberás probar nuevamente la conexión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="samu-new-api-key">Nueva API Key</Label>
            <div className="relative">
              <Input
                id="samu-new-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder="••••••••••••••••••••"
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
            disabled={isPending || apiKey.trim().length < 8}
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
// ============================================================

interface TestConnectionProps {
  disabled?: boolean;
}

export function SamuTestConnectionButton({ disabled }: TestConnectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null);

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
      <Button variant="outline" onClick={handleTest} disabled={isPending || disabled}>
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

export function SamuDisconnectDialog({ open, onOpenChange }: DisconnectDialogProps) {
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
      const result = await disconnectSamu();
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
          <DialogTitle className="font-heading">Desconectar Samu IA</DialogTitle>
          <DialogDescription>
            SellUp eliminará la API Key almacenada. Podrás volver a conectar Samu IA
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
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDisconnectOpen(true)}
          >
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
