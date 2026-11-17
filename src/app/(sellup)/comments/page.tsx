import { PageHeader } from '@/components/shared/page-header';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/ui/empty-state';
import { MessageSquare } from '@/icons';
import { getRecordCommentsInbox } from '@/modules/record-comments/actions';
import type { RecordCommentsInboxFilters } from '@/modules/record-comments/types';
import { CommentsInboxView } from './comments-inbox-view';

export const dynamic = 'force-dynamic';

const DEFAULT_FILTERS: RecordCommentsInboxFilters = { status: 'open', people: 'everyone', fieldKey: 'any' };

/**
 * Comentarios y alertas (feedback de vendedores 17-11): todo lo que el equipo
 * dejó sobre empresas y contactos, en un solo sitio. Cada uno ve lo de las
 * fichas de su alcance.
 */
export default async function CommentsPage() {
  const inbox = await getRecordCommentsInbox(DEFAULT_FILTERS);

  return (
    <PageShell width="normal">
      <PageHeader
        title="Comentarios y alertas"
        description="Lo que el equipo reportó sobre empresas y contactos: números que no existen, datos que están mal, avisos para otra persona. Marca una alerta como resuelta cuando ya la revisaste."
      />
      {inbox.available ? (
        <CommentsInboxView
          initialItems={inbox.items}
          initialOpenAlerts={inbox.openAlerts}
          initialTruncated={inbox.truncated}
          initialFilters={DEFAULT_FILTERS}
        />
      ) : (
        <EmptyState
          icon={MessageSquare}
          title="Todavía no está activo"
          description="Los comentarios estarán disponibles en cuanto se active su base de datos."
        />
      )}
    </PageShell>
  );
}
