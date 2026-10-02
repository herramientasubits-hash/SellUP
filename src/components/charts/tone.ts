/**
 * Los tonos de los paneles de datos (`BarList`, `DistributionBar`), traducidos
 * a los tokens de SellUp. En Thema salen de `lib/tone` como colores en línea;
 * aquí son clases, para que el color siga viniendo de `globals.css`.
 */
export type ChartTone = "brand" | "positive" | "warning" | "negative" | "neutral" | "info";

/** El relleno sólido del tono: una barra, un punto de leyenda. */
export const CHART_TONE_FILL: Readonly<Record<ChartTone, string>> = {
  brand: "bg-primary",
  positive: "bg-success",
  warning: "bg-warning",
  negative: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
};
