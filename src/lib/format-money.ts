/**
 * Dólares en formato es-CO, igual en toda la app: «US$1.234,56».
 *
 * Antes cada pantalla armaba su cadena —«US$ 0.0000», «$0.0000 USD»,
 * «US$0,25»— y el mismo costo se leía distinto según dónde se mirara. Los
 * costos por consulta de IA son de centavos: debajo de un centavo se muestran
 * hasta 4 decimales para que no salgan como «US$0,00».
 */
export function formatUSD(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  const decimales = abs > 0 && abs < 0.01 ? 4 : 2;
  const numero = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(value);
  return `US$${numero}`;
}
