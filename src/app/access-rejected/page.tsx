import { requireAccessScreen } from '@/modules/access/access-screen.server';
import { XCircle } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessRejectedPage() {
  const { user } = await requireAccessScreen('rejected');

  return (
    <AccessStatusScreen
      icon={XCircle}
      tone="negative"
      title="Acceso no aprobado"
      description="Tu solicitud de acceso a SellUp no fue aprobada. Si crees que esto es un error, por favor contacta al administrador del sistema para más información."
      email={user.email}
    />
  );
}
