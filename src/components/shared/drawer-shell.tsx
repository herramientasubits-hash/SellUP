'use client';

import * as React from 'react';
import { XIcon } from "@/icons";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
  SheetClose,
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
  /** Small badge/indicator shown inline right after the title (e.g. estado). */
  titleBadge?: React.ReactNode;
  /** Actions shown right-aligned in the header (buttons, kebab). The close
   *  button is rendered inline at the end of this row, at the same level. */
  headerActions?: React.ReactNode;
  /** Drawer body content */
  children?: React.ReactNode;
  /** Custom footer content (replaces actions) */
  footer?: React.ReactNode;
  /** Action buttons (usually Primary and Cancel) */
  actions?: React.ReactNode;
  /** Side from which the drawer appears */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /**
   * Tamaños de Thema (`sm` 384px … `7xl` 1280px, `full`), más `workspace`
   * (~90% de la ventana), que es de SellUp.
   */
  size?: DrawerShellSize;
  /** Custom classes for the sheet content */
  className?: string;
  /** Whether to show the close button (default: true) */
  showCloseButton?: boolean;
  /** Whether the body content is scrollable as a whole (default: true) */
  scrollable?: boolean;
  /** Show loading skeleton with mirror shine effect */
  loading?: boolean;
  /**
   * Si el drawer acapara la pantalla (por defecto sí).
   *
   * En modo modal el resto de la página queda inerte: nada de fuera se puede
   * tocar ni leer. Un drawer que convive con un panel propio fuera de su caja
   * —el del Agente IA, que vive en el shell y no en el portal— tiene que
   * apagarlo mientras ese panel esté abierto, o el panel queda muerto. El velo
   * sigue estando.
   */
  modal?: boolean;
  /** Recorta el velo para dejar a la vista —y clicable— lo que convive con el
   *  drawer, como el panel del Agente IA. */
  overlayClassName?: string;
  /**
   * Estilo en línea del cajón y de su velo. Existe para el movimiento: un
   * drawer que se corre para hacerle sitio a otra cosa tiene que ir con la
   * misma curva y la misma duración que ella (`agentPanelShift`), y en línea
   * gana siempre a las clases de entrada del `Sheet`.
   */
  contentStyle?: React.CSSProperties;
  overlayStyle?: React.CSSProperties;
}

export type DrawerShellSize =
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '4xl'
  | '5xl'
  | '6xl'
  | '7xl'
  | 'full'
  | 'workspace';

/** Mientras un drawer NO modal está abierto, el fondo no se desplaza: el modal ya lo congela solo. */
function useBodyScrollLock(locked: boolean): void {
  React.useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

const WORKSPACE_WIDTH = 'sm:!w-[90vw] sm:!max-w-[calc(100vw-1.5rem)] overflow-x-hidden'; // ~90% viewport

const HORIZONTAL_SIZE_CLASSES: Record<DrawerShellSize, string> = {
  sm: 'sm:!max-w-sm', // 384px
  md: 'sm:!max-w-md', // 448px
  lg: 'sm:!max-w-lg', // 512px
  xl: 'sm:!max-w-xl', // 576px
  '2xl': 'sm:!max-w-2xl', // 672px
  '3xl': 'sm:!max-w-3xl', // 768px
  '4xl': 'sm:!max-w-4xl', // 896px
  '5xl': 'sm:!max-w-5xl', // 1024px
  '6xl': 'sm:!max-w-6xl', // 1152px
  '7xl': 'sm:!max-w-7xl', // 1280px
  full: 'sm:!max-w-[calc(100%-1.5rem)]',
  workspace: WORKSPACE_WIDTH,
};

const VERTICAL_SIZE_CLASSES: Record<DrawerShellSize, string> = {
  sm: 'h-[30vh]',
  md: 'h-[50vh]',
  lg: 'h-[70vh]',
  xl: 'h-[90vh]',
  '2xl': 'h-[90vh]',
  '3xl': 'h-[90vh]',
  '4xl': 'h-[90vh]',
  '5xl': 'h-[90vh]',
  '6xl': 'h-[90vh]',
  '7xl': 'h-[90vh]',
  full: 'h-[calc(100dvh-1.5rem)]',
  workspace: 'h-[90vh]',
};

const sideSizeClasses = {
  right: HORIZONTAL_SIZE_CLASSES,
  left: HORIZONTAL_SIZE_CLASSES,
  top: VERTICAL_SIZE_CLASSES,
  bottom: VERTICAL_SIZE_CLASSES,
};

export function DrawerShell({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  icon,
  titleBadge,
  headerActions,
  children,
  footer,
  actions,
  side = 'right',
  size = 'md',
  className,
  showCloseButton = true,
  scrollable = true,
  loading = false,
  modal = true,
  overlayClassName,
  contentStyle,
  overlayStyle,
}: DrawerShellProps) {
  const sizeClass = sideSizeClasses[side][size];
  const hasHeader = Boolean(title || description || icon);

  useBodyScrollLock(open === true && !modal);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side={side}
        className={cn('flex flex-col gap-0 overflow-hidden !bg-background', sizeClass, className)}
        // Con header propio renderizamos el botón de cierre inline (misma fila
        // que las acciones). Sin header, dejamos el cierre por defecto del Sheet.
        showCloseButton={hasHeader ? false : showCloseButton}
        style={contentStyle}
        overlayClassName={overlayClassName}
        overlayStyle={overlayStyle}
      >
        {/* Header — icon + título (+ badge inline) a la izquierda; acciones y
            botón de cierre a la derecha, todo en la misma fila y centrado. */}
        {hasHeader && (
          <SheetHeader className="shrink-0 border-b border-border/60 bg-card px-6 py-4">
            <div className="flex items-center gap-3">
              {icon && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  {title && (
                    <SheetTitle className="truncate text-base font-semibold leading-tight">
                      {title}
                    </SheetTitle>
                  )}
                  {titleBadge && <span className="shrink-0">{titleBadge}</span>}
                </div>
                {description && (
                  <SheetDescription className="text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </SheetDescription>
                )}
              </div>
              {(headerActions || showCloseButton) && (
                <div className="flex shrink-0 items-center gap-2">
                  {headerActions}
                  {showCloseButton && (
                    <SheetClose
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Cerrar"
                        />
                      }
                    >
                      <XIcon className="h-4 w-4" />
                    </SheetClose>
                  )}
                </div>
              )}
            </div>
          </SheetHeader>
        )}

        {/* Scrollable body content */}
        <div className={cn(
          'relative flex-1 min-h-0 flex flex-col',
          scrollable ? 'overflow-y-auto overflow-x-hidden px-6 py-5 bg-background [scrollbar-gutter:stable]' : 'overflow-hidden'
        )}>
          {loading ? (
            <div className="flex flex-col gap-4 animate-su-fade-in">
              <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-6">
                <div className="absolute inset-0 -translate-x-full skew-x-[-12deg] su-mirror-shine animate-su-mirror-shine" />
                <div className="space-y-3">
                  <div className="h-4 w-3/4 rounded-md bg-surface-muted dark:bg-secondary" />
                  <div className="h-3 w-1/2 rounded-md bg-surface-muted dark:bg-secondary" />
                </div>
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4">
                    <div className="absolute inset-0 -translate-x-full skew-x-[-12deg] su-mirror-shine animate-su-mirror-shine" style={{ animationDelay: `${i * 0.2}s` }} />
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded-md bg-surface-muted dark:bg-secondary" />
                      <div className="h-3 w-4/5 rounded-md bg-surface-muted dark:bg-secondary" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            children
          )}
        </div>

        {/* Footer actions */}
        {footer ? (
          footer
        ) : actions ? (
          <SheetFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-card px-6 py-4">
            {actions}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
