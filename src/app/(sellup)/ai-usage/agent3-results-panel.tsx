// Agente 3 (Rumbo) · resultados del primer contacto, en Uso de IA → Por agente.
//
// Lee las preparaciones (sólo cuentas) y muestra la vista (`agent3-results-view.tsx`).
// Sin dinero: lo ve quien ve la página. Corre aparte en <Suspense>.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { UsageFilters } from '@/modules/ai-usage/queries';
import { getAgent3ResultsDashboard } from '@/modules/agent3-results/queries';
import { Agent3ResultsView } from './agent3-results-view';
import { countryLabel } from './usage-labels';

export { Agent3ResultsPanelSkeleton } from './agent3-results-view';

export async function Agent3ResultsPanel({ filters }: { filters: Pick<UsageFilters, 'period' | 'country'> }) {
  const result = await getAgent3ResultsDashboard(filters, (code) => countryLabel(code));

  if (result.status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudieron leer los resultados de Rumbo</AlertTitle>
        <AlertDescription>Vuelve a cargar la página en unos minutos.</AlertDescription>
      </Alert>
    );
  }

  return <Agent3ResultsView dashboard={result.dashboard} />;
}
