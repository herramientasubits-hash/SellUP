'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RotateCcw } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { restoreAccount } from '@/modules/accounts/actions';

interface RestoreAccountDialogProps {
  /** La empresa archivada que se va a restaurar. Con `null`, el diálogo está cerrado. */
  accountId: string | null;
  /** Se llama al cancelar o al cerrar con Escape. */
  onClose: () => void;
  /** Se llama cuando la empresa ya volvió (el diálogo ya se cerró). */
  onRestored: () => void;
}

/**
 * RestoreAccountDialog — la confirmación de «Restaurar empresa» (dueña 25-11): deshace
 * «Archivar». Cualquier usuario sobre las empresas de su alcance; el servidor lo exige igual. Si la empresa ya volvió a entrar con
 * otra ficha activa, el servidor no la restaura y lo dice.
 */
export function RestoreAccountDialog({ accountId, onClose, onRestored }: RestoreAccountDialogProps) {
  const [restoring, setRestoring] = React.useState(false);

  async function handleRestore() {
    if (!accountId) return;
    setRestoring(true);
    try {
      const result = await restoreAccount(accountId);
      if (result.success) {
        onClose();
        toast.success('Empresa restaurada');
        onRestored();
      } else {
        toast.error(result.error);
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <ConfirmDialog
      open={accountId !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      icon={RotateCcw}
      title="Restaurar empresa"
      description="La empresa vuelve al listado y al pipeline activo, con su responsable, contactos e historial. Queda registrado en auditoría. ¿Confirmas?"
      confirmLabel={restoring ? 'Restaurando…' : 'Restaurar empresa'}
      loading={restoring}
      onConfirm={handleRestore}
    />
  );
}
