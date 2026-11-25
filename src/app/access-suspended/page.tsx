import { requireAccessScreen } from '@/modules/access/access-screen.server';
import { Ban } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessSuspendedPage() {
  const { user } = await requireAccessScreen('suspended');

  return (
    <AccessStatusScreen
      icon={Ban}
      tone="warning"
      title="Tu acceso a SellUp está inactivo"
      description="Un administrador de SellUp activa tu acceso desde Usuarios. Cuando lo haga, vuelve a entrar con Google usando tu correo."
      email={user.email}
    />
  );
}
