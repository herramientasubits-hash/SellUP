import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { XCircle } from "@/icons";
import { AccessStatusScreen } from '@/components/shared/access-status-screen';

export default async function AccessRejectedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

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
