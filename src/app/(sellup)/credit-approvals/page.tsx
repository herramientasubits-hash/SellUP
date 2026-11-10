import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { PageShell } from '@/components/layout/page-shell';
import { getCreditApprovalsInbox } from '@/modules/credit-approvals/actions';
import { CreditApprovalsView } from './credit-approvals-view';

export const dynamic = 'force-dynamic';

/**
 * Solicitudes de créditos (dueña 10-11): lo que los aprobadores tienen que
 * decidir y lo que cada persona pidió. Llega aquí desde la notificación.
 */
export default async function CreditApprovalsPage() {
  const inbox = await getCreditApprovalsInbox();
  if (!inbox) redirect('/login');

  return (
    <PageShell width="normal">
      <PageHeader
        title="Solicitudes de créditos"
        description="Cuando alguien llega al límite de una regla que requiere aprobación, la solicitud llega aquí. Quien aprueba elige cuántos créditos le da para este mes."
      />
      <CreditApprovalsView inbox={inbox} />
    </PageShell>
  );
}
