/**
 * AGENT1-SUPPLIER-SEARCH-3 — nombre del lote de «Proveedores de una empresa»: el mismo en
 * la reserva y en la escritura de Claude (el escritor recalcula el nombre al adoptar el
 * lote; sin esto quedaba «Agente 1 · Pipeline · Colombia · Tecnología»). Puro.
 */
export function buildSupplierBatchName(referenceCompanyName: string, country: string, industry: string): string {
  return [`Proveedores de ${referenceCompanyName}`, country, industry].filter((part) => part.trim()).join(' · ');
}
