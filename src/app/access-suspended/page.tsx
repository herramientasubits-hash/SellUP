import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Ban } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessSuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

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
