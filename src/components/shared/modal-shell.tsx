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
} from '@/components/ui/dialog';

export interface ModalShellProps {
  /** Controlled open state */
  open?: boolean;
  /** Event handler for open state changes */
  onOpenChange?: (open: boolean) => void;
  /** The element that triggers the modal */
  trigger?: React.ReactNode;
  /** Main title of the modal */
  title?: React.ReactNode;
  /** Brief description or subtitle */
  description?: React.ReactNode;
  /** Modal body content */
  children?: React.ReactNode;
  /** Custom footer content (replaces actions) */
  footer?: React.ReactNode;
  /** Action buttons (usually Primary and Cancel) */
  actions?: React.ReactNode;
  /** Enterprise size variants */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Custom classes for the dialog content */
  className?: string;
  /** Whether to show the close button (default: true) */
  showCloseButton?: boolean;
}

const sizeClasses = {
  sm: 'sm:!max-w-sm w-full',  // 384px
  md: 'sm:!max-w-md w-full',  // 448px
  lg: 'sm:!max-w-lg w-full',  // 512px
  xl: 'sm:!max-w-xl w-full',  // 576px;
};

export function ModalShell({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  actions,
  size = 'md',
  className,
  showCloseButton = true,
}: ModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent
        className={cn(sizeClasses[size], className)}
        showCloseButton={showCloseButton}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}

        <div className="py-2">
          {children}
        </div>

        {footer ? (
          footer
        ) : actions ? (
          <DialogFooter>
            {actions}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
