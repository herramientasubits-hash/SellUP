/**
 * Los tonos de la interfaz, en un solo sitio.
 *
 * Un tono dice QUÉ significa algo (bien, cuidado, mal, información, marca) y
 * cada pieza lo traduce a su uso: el disco de un icono, el texto, una barra,
 * una variante de Badge, un fondo de acento. Antes cada componente tenía su
 * propia copia del mapa —MetricCard, DrawerSection, AttentionStrip, TabsBadge,
 * los gráficos— y bastaba con que una cambiara para que el mismo «warning» se
 * viera de dos maneras.
 *
 * Las clases van escritas enteras (nada de `bg-${tono}`): Tailwind solo genera
 * las que encuentra literales en el código.
 */

export type Tone = "brand" | "positive" | "warning" | "negative" | "info" | "violet" | "neutral";

export const TONES: readonly Tone[] = [
  "brand",
  "positive",
  "warning",
  "negative",
  "info",
  "violet",
  "neutral",
];

/** El disco o la caja de un icono: tinte suave con el icono en el tono. */
export const TONE_CHIP: Readonly<Record<Tone, string>> = {
  brand: "bg-primary/10 text-primary",
  positive: "bg-success/10 text-success",
  // El ámbar al 10 % se pierde sobre blanco: va al 15.
  warning: "bg-warning/15 text-warning",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  violet: "bg-chart-2/10 text-chart-2",
  neutral: "bg-surface-muted text-muted-foreground",
};

/** El color del texto o de un icono suelto. */
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
  brand: "text-primary",
  positive: "text-success",
  warning: "text-warning",
  negative: "text-destructive",
  info: "text-info",
  violet: "text-chart-2",
  neutral: "text-muted-foreground",
};

/** El relleno sólido: una barra, un filete, un punto de leyenda. */
export const TONE_FILL: Readonly<Record<Tone, string>> = {
  brand: "bg-primary",
  positive: "bg-success",
  warning: "bg-warning",
  negative: "bg-destructive",
  info: "bg-info",
  violet: "bg-chart-2",
  neutral: "bg-border-strong",
};

/** Fondo de acento de una tarjeta entera: apenas un velo del tono. */
export const TONE_SOFT: Readonly<Record<Tone, string>> = {
  brand: "bg-primary/5 border-primary/20",
  positive: "bg-success/5 border-success/20",
  warning: "bg-warning/5 border-warning/25",
  negative: "bg-destructive/5 border-destructive/20",
  info: "bg-info/5 border-info/20",
  violet: "bg-chart-2/5 border-chart-2/20",
  neutral: "bg-surface-subtle border-border/60",
};

/** La variante de `Badge` que corresponde a cada tono. */
export const TONE_BADGE = {
  brand: "brand",
  positive: "positive",
  warning: "warning",
  negative: "negative",
  info: "info",
  // Badge no tiene violeta: un estado no debería necesitarlo.
  violet: "brand",
  neutral: "neutral",
} as const satisfies Record<Tone, string>;
