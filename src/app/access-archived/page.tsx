import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LogOut, Archive, RotateCcw } from "@/icons";
import { Button } from '@/components/ui/button';
import { signOut } from '@/modules/auth/actions';
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
    <div className="w-full max-w-md text-center">
      <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
        <Archive className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>

      <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground">
        Usuario archivado
      </h1>

      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        Tu cuenta ha sido archivada y ya no tiene acceso a SellUp. Si deseas
        volver a usar la plataforma, puedes solicitar reingreso. Un administrador
        revisará tu solicitud.
      </p>

      <div className="mb-8 flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-card">
        <span className="min-w-0 truncate text-sm text-foreground" title={user.email}>{user.email}</span>
      </div>

      <div className="flex flex-col items-stretch gap-3">
        <form action={requestReaccess} className="w-full">
          <Button
            type="submit"
            className="w-full"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Solicitar reingreso
          </Button>
        </form>

        <form action={signOut} className="w-full">
          <Button
            type="submit"
            variant="outline"
            className="w-full"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}