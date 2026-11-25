import { redirect } from 'next/navigation';
import { SettingsPage } from '@/components/settings/settings-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getQuoteApproverSettings } from '@/modules/sales-quote/quote-actions';
import { QuoteApproversClient } from './quote-approvers-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cotizador · Configuración',
};

/** Configuración → Cotizador: quién aprueba los descuentos y quién va en copia. Solo admin. */
export default async function QuoteSettingsPage() {
  if (!(await isCurrentUserAdmin())) redirect('/settings');
  const result = await getQuoteApproverSettings();

  return (
    <SettingsPage
      title="Cotizador"
      description="Quién aprueba los descuentos que pasan el máximo y quién recibe copia. El cotizador es de Ventas; la región de cada vendedor sale de su grupo en Usuarios y acceso."
    >
      {result.ok ? (
        <QuoteApproversClient settings={result.settings} />
      ) : (
        <Alert variant={result.reason === 'missing_table' ? 'warning' : 'destructive'}>
          <AlertTitle>{result.reason === 'missing_table' ? 'Falta preparar la base de datos' : 'No se pudo cargar la configuración'}</AlertTitle>
          <AlertDescription>
            {result.reason === 'missing_table'
              ? 'Aplica la migración 170 (cotizaciones y aprobadores) en Supabase y recarga esta página.'
              : 'Recarga la página en un momento. Si sigue pasando, avisa al equipo.'}
          </AlertDescription>
        </Alert>
      )}
    </SettingsPage>
  );
}
