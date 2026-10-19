'use client';

/**
 * El Agente 3 lanzado desde afuera de una empresa (Empresas, Contactos): primero elige
 * o crea la empresa y después abre el primer contacto de ella. Controlado por quien lo
 * monta (la barra de acciones de la pantalla).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { firstCallHref } from '@/modules/speech/first-call-links';
import { FirstContactCompanyPicker } from './first-contact-company-picker';
import { FirstContactPanelHost, type FirstContactTarget } from './first-contact-panel-host';

export function FirstContactOutsideLauncher({
  open,
  onOpenChange,
  onBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Volver» a «¿Qué quieres hacer?» de Rumbo. */
  onBack?: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState<FirstContactTarget | null>(null);
  const close = React.useCallback(() => setTarget(null), []);

  return (
    <>
      <FirstContactCompanyPicker
        open={open && target === null}
        onOpenChange={onOpenChange}
        onBack={onBack}
        onResolved={(accountId) => {
          onOpenChange(false);
          setTarget({ kind: 'account', accountId });
          router.refresh();
        }}
      />
      <FirstContactPanelHost
        target={target}
        onClose={close}
        onDone={() => router.refresh()}
        onViewResult={(accountId) => router.push(firstCallHref(accountId))}
      />
    </>
  );
}
