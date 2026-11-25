import { requireAccessScreen } from '@/modules/access/access-screen.server';
import { Clock } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessPendingPage() {
  const { user } = await requireAccessScreen('pending_approval');

  return (
    <AccessStatusScreen
      icon={Clock}
      tone="warning"
      title="Solicitud enviada"
      description="Tu solicitud de acceso a SellUp ha sido recibida y está pendiente de revisión por un administrador. Recibirás una notificación cuando tu acceso sea aprobado."
      email={user.email}
    />
  );
}
