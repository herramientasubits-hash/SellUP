'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Loader2 } from '@/icons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ModalShell, type ModalShellProps } from '@/components/shared/modal-shell';

/** Lo que devuelve la acción de servidor que guarda una credencial. */
export interface IntegrationCredentialResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface IntegrationCredentialModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Rótulo del botón que guarda: «Guardar y probar conexión». */
  submitLabel: string;
  /** Si lo escrito ya alcanza para enviar. Con `false`, el botón sigue apagado. */
  canSubmit: boolean;
  /** La acción de servidor de ESTA integración, con lo escrito en los campos. */
  onSubmit: () => Promise<IntegrationCredentialResult>;
  /** Vacía los campos: se llama al cerrar, para que una credencial no se quede escrita. */
  onReset: () => void;
  /** Texto si la acción sale bien y no trae mensaje propio. */
  successFallback: string;
  /** Texto si la acción falla y no trae motivo propio. */
  errorFallback: string;
  /** Cuánto se deja ver la confirmación antes de cerrar. */
  closeDelayMs?: number;
  size?: ModalShellProps['size'];
  /** Los campos. Reciben `isPending` para apagarse mientras se guarda. */
  children: (state: { isPending: boolean }) => ReactNode;
}

const DEFAULT_CLOSE_DELAY_MS = 1200;

/**
 * IntegrationCredentialModal — el formulario corto de «Conectar» y «Actualizar
 * credencial» de una integración, sobre `ModalShell`.
 *
 * Pone lo que era idéntico en las cinco integraciones: el pie (Cancelar +
 * guardar con su estado de espera), el aviso de error o de éxito bajo los
 * campos, no dejar cerrar mientras se guarda, vaciar los campos al cerrar y,
 * tras guardar bien, mostrar la confirmación un momento, cerrar y refrescar.
 * Cada integración solo aporta sus campos y su acción.
 */
export function IntegrationCredentialModal({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  canSubmit,
  onSubmit,
  onReset,
  successFallback,
  errorFallback,
  closeDelayMs = DEFAULT_CLOSE_DELAY_MS,
  size = 'md',
  children,
}: IntegrationCredentialModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  function close() {
    onReset();
    setError(null);
    setSuccessMsg(null);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return;
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    close();
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      try {
        const result = await onSubmit();
        if (!result.success) {
          setError(result.error ?? errorFallback);
          return;
        }
        setSuccessMsg(result.message ?? successFallback);
        closeTimer.current = setTimeout(() => {
          close();
          router.refresh();
        }, closeDelayMs);
      } catch (caught) {
        setError(caught instanceof Error && caught.message ? caught.message : errorFallback);
      }
    });
  }

  // Ya guardado: el diálogo solo espera a cerrarse; reenviar duplicaría la acción.
  const isSubmitDisabled = isPending || !canSubmit || successMsg !== null;

  return (
    <ModalShell
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      size={size}
      actions={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitDisabled}>
            {isPending && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSubmitDisabled) handleSubmit();
        }}
      >
        {children({ isPending })}

        {error && <Alert variant="destructive">{error}</Alert>}
        {successMsg && <Alert variant="success">{successMsg}</Alert>}
      </form>
    </ModalShell>
  );
}
