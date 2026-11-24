import { QuoteClient } from '@/components/sales-quote/quote-client';
import { getMyQuoteAccess } from '@/modules/sales-quote/quote-markets.server';
import { availablePricingVersions, defaultPricingVersion } from '@/modules/sales-quote/version';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cotizador',
};

/**
 * Cotizador de Ventas.
 *
 * Lo usa cualquier persona activa. El servidor decide dos cosas: qué regiones
 * cotiza (admin y líderes, todas; los demás, las que les asignó un admin) y qué
 * versiones de precios siguen vigentes hoy (en hora de Bogotá). El cálculo
 * corre en el navegador con el mismo motor puro (`src/modules/sales-quote`).
 * Si no se puede saber quién es, no ve regiones (falla cerrado).
 */
export default async function QuotesPage() {
  const access = await getMyQuoteAccess();
  const now = new Date();
  return (
    <QuoteClient
      markets={access.markets}
      seesAllMarkets={access.seesAll}
      versions={availablePricingVersions(now)}
      defaultVersion={defaultPricingVersion(now)}
    />
  );
}
