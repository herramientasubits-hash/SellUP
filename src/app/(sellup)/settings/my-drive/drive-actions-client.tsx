'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { testUserDriveConnection, disconnectUserDrive } from '@/modules/drive/actions';

interface DriveActionsPanelProps {
  connectionStatus: string;
  folderId: string | null;
}

export function DriveActionsPanel({ connectionStatus, folderId }: DriveActionsPanelProps) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isConnected = connectionStatus === 'connected';

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const result = await testUserDriveConnection();
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
      if (result.success) router.refresh();
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      const result = await disconnectUserDrive();
      if (result.success) {
        setConfirmOpen(false);
        router.refresh();
      } else {
        setMessage({ type: 'error', text: result.message });
      }
    } finally {
      setDisconnecting(false);
    }
  }

  const driveUrl = folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : null;

  return (
    <div className="space-y-4">
      {/* Feedback message */}
      {message && (
        <p
          className={`text-sm rounded-lg border px-3 py-2 ${
            message.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Acciones */}
      {isConnected ? (
        <div className="flex flex-wrap gap-2">
          {/* Probar conexión */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            className="text-xs"
          >
            {testing ? 'Probando...' : 'Probar conexión'}
          </Button>

          {/* Abrir carpeta SellUp */}
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Abrir carpeta SellUp ↗
            </a>
          )}

          {/* Desconectar — con diálogo de confirmación */}
          <button
            className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
            disabled={disconnecting}
            onClick={() => setConfirmOpen(true)}
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar Drive'}
          </button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Desconectar Google Drive?</DialogTitle>
                <DialogDescription>
                  SellUp dejará de tener acceso a tu Drive. Los archivos ya creados en tu Drive
                  permanecerán intactos. Podrás volver a conectar tu Drive en cualquier momento.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Desconectando...' : 'Desconectar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <a
          href="/api/integrations/google-drive/oauth/start"
          className="inline-flex items-center rounded-md bg-su-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-su-brand/90"
        >
          Conectar Google Drive
        </a>
      )}
    </div>
  );
}
