import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import { CONNECTION_TEST_STATUS_LABELS } from '@/modules/source-catalog/labels';
import type { SourceConnectionTestStatus } from '@/server/source-catalog/connection-test/types';

/** Cómo se lee cada resultado de prueba de conexión en el vocabulario de estados. */
export const CONNECTION_TEST_STATUS_TONE: Record<SourceConnectionTestStatus, StatusType> = {
  success: 'active',
  failed: 'error',
  blocked: 'error',
  requires_credentials: 'warning',
  input_required: 'warning',
  not_supported: 'neutral',
};

/** El chip del resultado de una prueba de conexión, igual en el panel, el resumen y la tabla. */
export function ConnectionTestStatusBadge({ status }: { status: SourceConnectionTestStatus }) {
  return (
    <StatusBadge
      status={CONNECTION_TEST_STATUS_TONE[status]}
      label={CONNECTION_TEST_STATUS_LABELS[status]}
    />
  );
}
