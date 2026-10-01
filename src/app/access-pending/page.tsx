import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Clock } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessPendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

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
