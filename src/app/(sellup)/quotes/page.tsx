import { QuoteClient, type QuotesTab } from '@/components/sales-quote/quote-client';
import { getSalesQuotesBoard } from '@/modules/sales-quote/quote-actions';
import { getMyQuoteAccess } from '@/modules/sales-quote/quote-markets.server';
import { availablePricingVersions, defaultPricingVersion } from '@/modules/sales-quote/version';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cotizador',
};

const TABS: readonly QuotesTab[] = ['quote', 'mine', 'team', 'approvals'];

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Cotizador de Ventas.
 *
 * Lo usa cualquier persona activa. El servidor decide qué regiones cotiza
 * (admin y líderes, todas; los demás, la de su grupo de SellUp), qué versiones
 * de precios siguen vigentes hoy (en hora de Bogotá) y qué cotizaciones ve:
 * las suyas, las de su equipo y las que le toca aprobar. El cálculo corre en
 * el navegador con el mismo motor puro (`src/modules/sales-quote`) y, al
 * guardar, el servidor lo vuelve a hacer. Si no se puede saber quién es, no ve
 * regiones (falla cerrado).
 */
export default async function QuotesPage({ searchParams }: PageProps) {
  const [{ tab }, access, board] = await Promise.all([searchParams, getMyQuoteAccess(), getSalesQuotesBoard()]);
  const now = new Date();
  const requested = TABS.find((item) => item === tab) ?? 'quote';
  const initialTab =
    (requested === 'approvals' && !board.canApprove) || (requested === 'team' && board.team === null) ? 'quote' : requested;
  return (
    <QuoteClient
      markets={access.markets}
      seesAllMarkets={access.seesAll}
      fromGroup={access.fromGroup ?? null}
      versions={availablePricingVersions(now)}
      defaultVersion={defaultPricingVersion(now)}
      board={board}
      initialTab={initialTab}
    />
  );
}
