'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <X className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar preautorización</DialogTitle>
            <DialogDescription>
              ¿Cancelar la preautorización de <strong>{email}</strong>? Esta persona no podrá
              ingresar automáticamente. Podrás preautorizarla de nuevo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={loading}>
              {loading ? 'Cancelando...' : 'Confirmar cancelación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
