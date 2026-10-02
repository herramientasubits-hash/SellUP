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
      title="Acceso suspendido"
      description="Tu acceso a SellUp ha sido temporalmente suspendido. Por favor, contacta al administrador del sistema para obtener más información sobre el estado de tu cuenta."
      email={user.email}
    />
  );
}
