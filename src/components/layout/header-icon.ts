/**
 * Botón de icono de la cabecera, como en el playground de UX (`header-icon.ts`):
 * cuadrado outline de 32px con el icono en el gris del menú lateral y, con su
 * menú o panel abierto, en azul con fondo suave, igual que la opción activa
 * del menú. Los disparadores de Base UI lo avisan con `data-popup-open` y
 * `aria-expanded`; los que abren un panel propio, con `aria-pressed`.
 */
export const HEADER_ICON_BUTTON = [
  "relative flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground shadow-xs transition-colors",
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
  "aria-expanded:border-primary/25 aria-expanded:bg-primary/10 aria-expanded:text-primary aria-expanded:hover:bg-primary/15",
  "aria-pressed:border-primary/25 aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/15",
  "data-[popup-open]:border-primary/25 data-[popup-open]:bg-primary/10 data-[popup-open]:text-primary",
].join(" ");
