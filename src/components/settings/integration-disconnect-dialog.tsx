'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';

/** Lo que devuelve la acción de servidor que desconecta una integración. */
export interface IntegrationDisconnectResult {
  success: boolean;
  error?: string;
}

export interface IntegrationDisconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Desconectar HubSpot». */
  title: string;
  /** Qué deja de funcionar y qué se conserva. */
  description: ReactNode;
  /** La acción de servidor de ESTA integración. Solo se llama al confirmar. */
  onDisconnect: () => Promise<IntegrationDisconnectResult>;
  confirmLabel?: string;
}

const FALLBACK_ERROR = 'No se pudo desconectar. Inténtalo de nuevo.';

/**
 * IntegrationDisconnectDialog — la confirmación de «Desconectar» de cualquier
 * integración de Configuración.
 *
 * Es un `ConfirmDialog` destructivo: abrirlo o cancelarlo no toca nada; solo
 * el botón rojo llama a `onDisconnect`. Mientras la acción corre no se puede
 * cerrar; si falla, el motivo aparece dentro del mismo diálogo y se queda
 * abierto para reintentar; si sale bien, se cierra y la pantalla se refresca.
 */
export function IntegrationDisconnectDialog({
  open,
  onOpenChange,
  title,
  description,
  onDisconnect,
  confirmLabel = 'Desconectar',
}: IntegrationDisconnectDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return;
    if (!nextOpen) setError(null);
    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    setError(null);

    startTransition(async () => {
      try {
        const result = await onDisconnect();
        if (!result.success) {
          setError(result.error ?? FALLBACK_ERROR);
          return;
        }
        onOpenChange(false);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error && caught.message ? caught.message : FALLBACK_ERROR);
      }
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      variant="destructive"
      title={title}
      description={
        <>
          {description}
          {error && (
            // La descripción de `ConfirmDialog` es un párrafo: una caja `Alert`
            // (un `div`) dentro sería HTML inválido. El motivo va como texto.
            <span role="alert" className="mt-2 block font-medium text-destructive">
              {error}
            </span>
          )}
        </>
      }
      confirmLabel={confirmLabel}
      loading={isPending}
      onConfirm={handleConfirm}
    />
  );
}
