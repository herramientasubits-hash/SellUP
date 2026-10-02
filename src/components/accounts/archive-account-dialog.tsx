'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Archive } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { archiveAccount } from '@/modules/accounts/actions';

interface ArchiveAccountDialogProps {
  /** La empresa que se va a archivar. Con `null`, el diálogo está cerrado. */
  accountId: string | null;
  /** Se llama al cancelar o al cerrar con Escape. */
  onClose: () => void;
  /** Se llama cuando la empresa ya quedó archivada (el diálogo ya se cerró). */
  onArchived: () => void;
}

/**
 * ArchiveAccountDialog — la única confirmación de «Archivar empresa».
 *
 * La usan la tabla de empresas y el menú de acciones del detalle (página y
 * panel lateral): mismo texto, misma acción (`archiveAccount`) y mismo aviso.
 * Lo que pasa después de archivar (refrescar la lista, cerrar el panel, volver
 * a /accounts) lo decide quien la monta, en `onArchived`.
 */
export function ArchiveAccountDialog({
  accountId,
  onClose,
  onArchived,
}: ArchiveAccountDialogProps) {
  const [archiving, setArchiving] = React.useState(false);

  async function handleArchive() {
    if (!accountId) return;
    setArchiving(true);
    try {
      const result = await archiveAccount(accountId);
      if (result.success) {
        onClose();
        toast.success('Empresa archivada');
        onArchived();
      } else {
        toast.error(result.error);
      }
    } finally {
      setArchiving(false);
    }
  }

  return (
    <ConfirmDialog
      open={accountId !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      variant="destructive"
      icon={Archive}
      title="Archivar empresa"
      description="Esta acción retira la empresa del pipeline activo. Solo un administrador puede realizarla y queda registrada en auditoría. ¿Confirmas?"
      confirmLabel={archiving ? 'Archivando…' : 'Archivar empresa'}
      loading={archiving}
      onConfirm={handleArchive}
    />
  );
}
