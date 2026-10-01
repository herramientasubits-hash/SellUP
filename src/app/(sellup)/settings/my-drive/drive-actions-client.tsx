'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

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
    setDisconnectError(null);
    try {
      const result = await disconnectUserDrive();
      if (result.success) {
        setConfirmOpen(false);
        router.refresh();
      } else {
        // El motivo se queda dentro del diálogo: es ahí donde se reintenta.
        setDisconnectError(result.message);
      }
    } finally {
      setDisconnecting(false);
    }
  }

  function handleConfirmOpenChange(nextOpen: boolean) {
    if (disconnecting) return;
    if (!nextOpen) setDisconnectError(null);
    setConfirmOpen(nextOpen);
  }

  const driveUrl = folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : null;

  return (
    <div className="space-y-4">
      {/* Feedback message */}
      {message && (
        <Alert variant={message.type === 'success' ? 'success' : 'destructive'}>{message.text}</Alert>
      )}

      {/* Acciones */}
      {isConnected ? (
        <div className="flex flex-wrap gap-2">
          {/* Probar conexión */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? 'Probando...' : 'Probar conexión'}
          </Button>

          {/* Abrir carpeta SellUp */}
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Abrir carpeta SellUp ↗
            </a>
          )}

          {/* Desconectar — con diálogo de confirmación */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={disconnecting}
            onClick={() => setConfirmOpen(true)}
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar Drive'}
          </Button>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={handleConfirmOpenChange}
            variant="destructive"
            title="¿Desconectar Google Drive?"
            description={
              <>
                SellUp dejará de tener acceso a tu Drive. Los archivos que ya creó se quedan donde
                están, y puedes volver a conectarlo cuando quieras.
                {disconnectError && (
                  // La descripción es un párrafo: el motivo va como texto, no como caja.
                  <span role="alert" className="mt-2 block font-medium text-destructive">
                    {disconnectError}
                  </span>
                )}
              </>
            }
            confirmLabel="Desconectar"
            loading={disconnecting}
            onConfirm={handleDisconnect}
          />
        </div>
      ) : (
        <a
          href="/api/integrations/google-drive/oauth/start"
          className={buttonVariants({ size: 'sm' })}
        >
          Conectar Google Drive
        </a>
      )}
    </div>
  );
}
