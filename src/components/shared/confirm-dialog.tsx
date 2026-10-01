'use client';

import * as React from 'react';
import { AlertTriangle, CircleHelp, Loader2, Trash2, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ConfirmVariant = 'default' | 'warning' | 'destructive';

export interface ConfirmDialogProps {
  /** Controlled open state */
  open?: boolean;
  /** Event handler for open state changes */
  onOpenChange?: (open: boolean) => void;
  /** The element that triggers the dialog */
  trigger?: React.ReactNode;
  /** Main title of the confirmation */
  title: string;
  /** Brief description or warning. Admite nodos para dar énfasis a un nombre. */
  description?: React.ReactNode;
  /** Label for the confirmation button */
  confirmLabel?: string;
  /** Label for the cancellation button */
  cancelLabel?: string;
  /** Visual style variant */
  variant?: ConfirmVariant;
  /** Icono del chip de la cabecera. Por defecto, el del tono de `variant`. */
  icon?: LucideIcon;
  /**
   * Con valor, el botón de confirmar sigue apagado hasta que se escribe este
   * texto tal cual: la fricción extra que pide una acción irreversible de
   * verdad (borrar un registro con nombre) y que un «¿Estás seguro?» no da.
   */
  confirmationText?: string;
  /** Callback when confirmed */
  onConfirm?: () => void;
  /** Callback when cancelled */
  onCancel?: () => void;
  /** Whether the confirm action is loading */
  loading?: boolean;
  /** Whether the dialog is disabled */
  disabled?: boolean;
  /** Custom classes for the dialog content */
  className?: string;
  /**
   * Rótulo de un tercer botón opcional, entre cancelar y confirmar: un «Salir
   * sin guardar» junto a un «Guardar y salir». Sin él, el diálogo es el de dos
   * botones de siempre.
   */
  secondaryLabel?: string;
  /** Estilo del botón secundario. Por defecto `outline`. */
  secondaryVariant?: 'default' | 'destructive' | 'outline';
  /** Callback del botón secundario. Necesario cuando hay `secondaryLabel`. */
  onSecondary?: () => void;
}

/** El icono y el tinte del chip de la cabecera, por tono. */
const TONE: Record<ConfirmVariant, { icon: LucideIcon; chip: string }> = {
  default: { icon: CircleHelp, chip: 'bg-primary/10 text-primary' },
  warning: { icon: AlertTriangle, chip: 'bg-warning/15 text-warning' },
  destructive: { icon: Trash2, chip: 'bg-destructive/10 text-destructive' },
};

const CONFIRMATION_INPUT_ID = 'confirm-dialog-typed-confirmation';

/**
 * ConfirmDialog
 *
 * El diálogo que pregunta antes de una acción con consecuencias. Anatomía de
 * Thema: un chip con el icono del tono (primario, aviso o destructivo), el
 * título y la descripción a su lado, y el pie con cancelar a la izquierda de
 * la confirmación. La confirmación final de algo irreversible es el único
 * botón del sistema que lleva el rojo sólido.
 *
 * Cierre manual tras éxito: la confirmación hace `preventDefault()` para
 * soportar procesos asíncronos (`loading`), así que usado de forma controlada
 * el diálogo NO se cierra solo; quien lo usa pone `open={false}` cuando la
 * operación termina bien.
 *
 * Para una decisión rápida sobre lo que ya está marcado en una barra flotante,
 * usa `ConfirmActionPopover` (`@/components/action-rail`) en vez de este
 * diálogo.
 *
 * @example
 * <ConfirmDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   variant="destructive"
 *   title="¿Eliminar el lote?"
 *   description="Se borran sus 42 prospectos. No se puede deshacer."
 *   confirmLabel="Eliminar"
 *   loading={isDeleting}
 *   onConfirm={handleDelete}
 * />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  icon,
  confirmationText,
  onConfirm,
  onCancel,
  loading = false,
  disabled = false,
  className,
  secondaryLabel,
  secondaryVariant = 'outline',
  onSecondary,
}: ConfirmDialogProps) {
  // La confirmación final de algo irreversible sí lleva el rojo sólido: es el
  // único botón del sistema que debe pesar más que el primario.
  const actionVariant = variant === 'destructive' ? 'destructive-solid' : 'default';
  const tone = TONE[variant];
  const Icon = icon ?? tone.icon;

  // El texto escrito es una llave de un solo uso: dejarlo para la siguiente
  // confirmación (casi siempre de otro registro) pre-armaría un borrado ajeno.
  const [typedConfirmation, setTypedConfirmation] = React.useState('');
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTypedConfirmation('');
    onOpenChange?.(nextOpen);
  };

  const isTypedMismatch = Boolean(confirmationText) && typedConfirmation !== confirmationText;
  const isBusy = loading || disabled;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent
        className={cn('sm:max-w-sm w-full', className)}
        showCloseButton={false}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone.chip)}
          >
            <Icon className="size-5" />
          </span>
          <DialogHeader className="min-w-0 flex-1 pr-0 pt-0.5">
            <DialogTitle>
              {title}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        </div>

        {confirmationText && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={CONFIRMATION_INPUT_ID} className="text-sm text-muted-foreground">
              Escribe <span className="font-semibold text-foreground">{confirmationText}</span> para confirmar
            </label>
            <Input
              id={CONFIRMATION_INPUT_ID}
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isTypedMismatch && !isBusy) {
                  onConfirm?.();
                }
              }}
              // Sin placeholder: el rótulo de arriba ya dice el texto exacto;
              // repetirlo aquí se leería como si ya estuviera escrito.
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={isBusy}
                type="button"
              />
            }
          >
            {cancelLabel}
          </DialogClose>
          {secondaryLabel && (
            <Button
              variant={secondaryVariant}
              onClick={onSecondary}
              disabled={isBusy}
              type="button"
            >
              {secondaryLabel}
            </Button>
          )}
          <Button
            variant={actionVariant}
            onClick={(e) => {
              if (onConfirm) {
                e.preventDefault();
                onConfirm();
              }
            }}
            disabled={isBusy || isTypedMismatch}
            className="min-w-[100px]"
            type="button"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
