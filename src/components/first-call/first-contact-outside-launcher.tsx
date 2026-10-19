'use client';

/**
 * El Agente 3 lanzado desde afuera de una empresa (Empresas, Contactos): primero elige
 * o crea la empresa y después abre el primer contacto de ella. Controlado por quien lo
 * monta (la barra de acciones de la pantalla).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { firstCallHref } from '@/modules/speech/first-call-links';
import { requestViewFirstContactResult } from '@/modules/speech/first-contact-runs-client';
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
  // Si el panel no pudo abrirse (avisa con un toast), el buscador tampoco queda esperando.
  const close = React.useCallback(() => {
    setTarget(null);
    onOpenChange(false);
  }, [onOpenChange]);
  // El buscador sigue abierto («Abriendo…») hasta que el panel de Rumbo tiene sus datos;
  // entonces se cambian en el mismo instante, sin un momento sin panel (dueña 19-10).
  const handOff = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <>
      <FirstContactCompanyPicker
        open={open}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
          onOpenChange(next);
        }}
        onBack={onBack}
        onResolved={(accountId) => {
          setTarget({ kind: 'account', accountId });
          router.refresh();
        }}
      />
      <FirstContactPanelHost
        target={target}
        onClose={close}
        onReady={handOff}
        onDone={() => router.refresh()}
        onViewResult={(accountId) => {
          if (!requestViewFirstContactResult(accountId)) router.push(firstCallHref(accountId));
        }}
      />
    </>
  );
}
