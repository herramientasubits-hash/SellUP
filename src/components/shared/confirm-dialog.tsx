'use client';

import * as React from 'react';
import { AlertTriangle, CircleHelp, Loader2, Trash2, type LucideIcon } from "@/icons";

import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { IconTile, type IconTileTone } from '@/components/utility';

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

/** El icono y el tono del chip de la cabecera, por variante. */
const TONE: Record<ConfirmVariant, { icon: LucideIcon; tile: IconTileTone }> = {
  default: { icon: CircleHelp, tile: 'primary' },
  warning: { icon: AlertTriangle, tile: 'warning' },
  destructive: { icon: Trash2, tile: 'negative' },
};

const CONFIRMATION_INPUT_ID = 'confirm-dialog-typed-confirmation';

/**
 * ConfirmDialog — port de Thema `overlays/ConfirmDialog.tsx`.
 *
 * El diálogo que pregunta antes de una acción con consecuencias. Va sobre
 * `AlertDialog`, no sobre `Dialog`: una confirmación exige respuesta, así que
 * **no tiene X y no se cierra con un clic afuera** — solo con Cancelar, con la
 * acción o con Escape. El foco entra en Cancelar (lo seguro) o, si hay que
 * escribir el nombre para confirmar, directo en ese campo.
 *
 * Anatomía: el chip (`IconTile`) con el icono del tono, el título — en rojo
 * cuando la acción es destructiva — y la descripción a su lado, y el pie con
 * cancelar a la izquierda de la confirmación. La confirmación final de algo
 * irreversible es el único botón del sistema que lleva el rojo sólido.
 *
 * Cierre manual tras éxito: la confirmación hace `preventDefault()` para
 * soportar procesos asíncronos (`loading`), así que usado de forma controlada
 * el diálogo NO se cierra solo; quien lo usa pone `open={false}` cuando la
 * operación termina bien.
 *
 * Para una decisión rápida sobre lo que ya está marcado en una barra flotante,
 * usa `ConfirmActionPopover` (`@/components/action-rail`) en vez de este
 * diálogo. Para un formulario corto, `ModalShell`.
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
  const confirmationInputRef = React.useRef<HTMLInputElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  // Con `trigger` y sin `open`, el diálogo lleva su propio estado: así Cancelar
  // puede cerrarlo sin que quien lo usa tenga que controlarlo.
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTypedConfirmation('');
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const isTypedMismatch = Boolean(confirmationText) && typedConfirmation !== confirmationText;
  const isBusy = loading || disabled;

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger && <AlertDialogTrigger render={trigger as React.ReactElement} />}
      <AlertDialogContent
        // Por encima de un `Dialog` (z-60) o un drawer desde el que se abra.
        className={cn('z-[60] sm:max-w-sm', className)}
        // Foco dirigido: al campo de confirmación si lo hay; si no, a Cancelar,
        // para que un Enter distraído no dispare la acción.
        initialFocus={confirmationText ? confirmationInputRef : cancelRef}
      >
        <div className="flex items-start gap-3">
          <IconTile icon={<Icon />} tone={tone.tile} size="md" />
          <AlertDialogHeader className="min-w-0 flex-1 place-items-start gap-1.5 pt-0.5 text-left">
            <AlertDialogTitle className={cn(variant === 'destructive' && 'text-destructive')}>
              {title}
            </AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
        </div>

        {confirmationText && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={CONFIRMATION_INPUT_ID} className="text-sm text-muted-foreground">
              Escribe <span className="font-semibold text-foreground">{confirmationText}</span> para confirmar
            </label>
            <Input
              ref={confirmationInputRef}
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
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancelRef}
            onClick={() => {
              onCancel?.();
              handleOpenChange(false);
            }}
            disabled={isBusy}
            type="button"
          >
            {cancelLabel}
          </AlertDialogCancel>
          {secondaryLabel && (
            <AlertDialogAction
              variant={secondaryVariant}
              onClick={onSecondary}
              disabled={isBusy}
              type="button"
            >
              {secondaryLabel}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            variant={actionVariant}
            onClick={(e) => {
              if (onConfirm) {
                e.preventDefault();
                onConfirm();
              }
            }}
            disabled={isBusy || isTypedMismatch}
            className="min-w-24"
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
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
