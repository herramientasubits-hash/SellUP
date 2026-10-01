'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { cancelPreapproval } from '@/modules/access/actions';

interface PreapprovalCancelButtonProps {
  preapprovalId: string;
  email: string;
}

export function PreapprovalCancelButton({ preapprovalId, email }: PreapprovalCancelButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    setLoading(true);
    await cancelPreapproval(preapprovalId);
    setLoading(false);
    setOpen(false);
    window.location.reload();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        aria-label="Cancelar preautorización"
        onClick={() => setOpen(true)}
      >
        <X />
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="destructive"
        icon={X}
        title="Cancelar preautorización"
        description={`¿Cancelar la preautorización de ${email}? Esta persona no podrá ingresar automáticamente. Podrás preautorizarla de nuevo cuando quieras.`}
        confirmLabel={loading ? 'Cancelando...' : 'Confirmar cancelación'}
        loading={loading}
        onConfirm={handleCancel}
      />
    </>
  );
}
