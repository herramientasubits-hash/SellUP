import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Archive, RotateCcw } from "@/icons";
import { Button } from '@/components/ui/button';
import { AccessStatusScreen } from '@/components/shared/access-status-screen';
import { requestReaccess } from './actions';

export default async function AccessArchivedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, access_status')
    .eq('auth_user_id', user.id)
    .single();

  if (!internalUser || internalUser.access_status !== 'archived') {
    redirect('/login');
  }

  return (
    <AccessStatusScreen
      icon={Archive}
      tone="neutral"
      title="Usuario archivado"
      description="Tu cuenta ha sido archivada y ya no tiene acceso a SellUp. Si deseas volver a usar la plataforma, puedes solicitar reingreso. Un administrador revisará tu solicitud."
      email={user.email}
      primaryAction={
        <form action={requestReaccess} className="w-full">
          <Button type="submit" className="w-full">
            <RotateCcw className="size-4" aria-hidden="true" />
            Solicitar reingreso
          </Button>
        </form>
      }
    />
  );
}
