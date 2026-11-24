import { redirect } from 'next/navigation';
import { SettingsPage } from '@/components/settings/settings-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getQuoteMarketAssignments } from '@/modules/sales-quote/quote-markets-actions';
import { QuoteMarketsClient } from './quote-markets-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cotizador · Configuración',
};

/** Configuración → Cotizador: qué regiones cotiza cada persona. Solo admin. */
export default async function QuoteSettingsPage() {
  if (!(await isCurrentUserAdmin())) redirect('/settings');
  const assignments = await getQuoteMarketAssignments();

  return (
    <SettingsPage
      title="Cotizador"
      description="Qué regiones cotiza cada persona. Admin, manager y líder comercial cotizan todas por su rol; vendedores y Growth, solo las que les asignes aquí."
    >
      {assignments.ok ? (
        <QuoteMarketsClient rows={assignments.rows} />
      ) : (
        <Alert variant={assignments.reason === 'missing_table' ? 'warning' : 'destructive'}>
          <AlertTitle>
            {assignments.reason === 'missing_table' ? 'Falta preparar la base de datos' : 'No se pudieron cargar las regiones'}
          </AlertTitle>
          <AlertDescription>
            {assignments.reason === 'missing_table'
              ? 'Aplica la migración 170 (regiones del cotizador) en Supabase y recarga esta página.'
              : 'Recarga la página en un momento. Si sigue pasando, avisa al equipo.'}
          </AlertDescription>
        </Alert>
      )}
    </SettingsPage>
  );
}
