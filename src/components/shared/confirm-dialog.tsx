'use client';

import * as React from 'react';
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
import { Loader2 } from 'lucide-react';

export interface ConfirmDialogProps {
  /** Controlled open state */
  open?: boolean;
  /** Event handler for open state changes */
  onOpenChange?: (open: boolean) => void;
  /** The element that triggers the dialog */
  trigger?: React.ReactNode;
  /** Main title of the confirmation */
  title: string;
  /** Brief description or warning */
  description?: string;
  /** Label for the confirmation button */
  confirmLabel?: string;
  /** Label for the cancellation button */
  cancelLabel?: string;
  /** Visual style variant */
  variant?: 'default' | 'warning' | 'destructive';
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
}

export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  onConfirm,
  onCancel,
  loading = false,
  disabled = false,
  className,
}: ConfirmDialogProps) {
  // Map variant to button variant
  const actionVariant = variant === 'destructive' ? 'destructive' : 'default';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent
        className={cn('sm:max-w-sm w-full', className)}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className={cn(variant === 'destructive' && 'text-destructive')}>
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={loading || disabled}
                type="button"
              />
            }
          >
            {cancelLabel}
          </DialogClose>
          <Button
            variant={actionVariant}
            onClick={(e) => {
              if (onConfirm) {
                e.preventDefault();
                onConfirm();
              }
            }}
            disabled={loading || disabled}
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
