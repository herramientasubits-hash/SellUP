'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from '@/components/ui/sheet';

export interface DrawerShellProps {
  /** Controlled open state */
  open?: boolean;
  /** Event handler for open state changes */
  onOpenChange?: (open: boolean) => void;
  /** The element that triggers the drawer */
  trigger?: React.ReactNode;
  /** Main title of the drawer */
  title?: React.ReactNode;
  /** Brief description or subtitle */
  description?: React.ReactNode;
  /** Custom icon container for header */
  icon?: React.ReactNode;
  /** Drawer body content */
  children?: React.ReactNode;
  /** Custom footer content (replaces actions) */
  footer?: React.ReactNode;
  /** Action buttons (usually Primary and Cancel) */
  actions?: React.ReactNode;
  /** Side from which the drawer appears */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** Enterprise size variants */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Custom classes for the sheet content */
  className?: string;
  /** Whether to show the close button (default: true) */
  showCloseButton?: boolean;
  /** Whether the body content is scrollable as a whole (default: true) */
  scrollable?: boolean;
}

const sideSizeClasses = {
  right: {
    sm: 'sm:!max-w-sm w-full',  // 384px
    md: 'sm:!max-w-md w-full',  // 448px
    lg: 'sm:!max-w-lg w-full',  // 512px
    xl: 'sm:!max-w-xl w-full',  // 576px
  },
  left: {
    sm: 'sm:!max-w-sm w-full',
    md: 'sm:!max-w-md w-full',
    lg: 'sm:!max-w-lg w-full',
    xl: 'sm:!max-w-xl w-full',
  },
  top: {
    sm: 'h-[30vh]',
    md: 'h-[50vh]',
    lg: 'h-[70vh]',
    xl: 'h-[90vh]',
  },
  bottom: {
    sm: 'h-[30vh]',
    md: 'h-[50vh]',
    lg: 'h-[70vh]',
    xl: 'h-[90vh]',
  },
};

export function DrawerShell({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  icon,
  children,
  footer,
  actions,
  side = 'right',
  size = 'md',
  className,
  showCloseButton = true,
  scrollable = true,
}: DrawerShellProps) {
  const sizeClass = sideSizeClasses[side][size];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side={side}
        className={cn('flex flex-col gap-0 overflow-hidden', sizeClass, className)}
        showCloseButton={showCloseButton}
      >
        {/* Header section with optional icon */}
        {(title || description || icon) && (
          <SheetHeader className="shrink-0 border-b border-border/50 bg-muted/20 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              {icon && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-su-brand-soft">
                  {icon}
                </div>
              )}
              <div className="space-y-0.5 flex-1 min-w-0">
                {title && <SheetTitle className="text-base font-semibold">{title}</SheetTitle>}
                {description && (
                  <SheetDescription className="text-xs text-muted-foreground/70">
                    {description}
                  </SheetDescription>
                )}
              </div>
            </div>
          </SheetHeader>
        )}

        {/* Scrollable body content */}
        <div className={cn(
          'flex-1 min-h-0 flex flex-col',
          scrollable ? 'overflow-y-auto px-7 py-6' : 'overflow-hidden'
        )}>
          {children}
        </div>

        {/* Footer actions */}
        {footer ? (
          footer
        ) : actions ? (
          <SheetFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-border/50 bg-muted/20 px-7 py-4">
            {actions}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
