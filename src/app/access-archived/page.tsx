import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LogOut, Archive, RotateCcw } from 'lucide-react';
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
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-500/10">
        <Archive className="h-8 w-8 text-slate-500" />
      </div>

      <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">
        Usuario archivado
      </h1>

      <p className="mb-8 text-sm text-muted-foreground leading-relaxed">
        Tu cuenta ha sido archivada y ya no tiene acceso a SellUp. Si deseas
        volver a usar la plataforma, puedes solicitar reingreso. Un administrador
        revisará tu solicitud.
      </p>

      <div className="mb-8 flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card p-4">
        <span className="text-sm text-foreground">{user.email}</span>
      </div>

      <div className="flex flex-col items-center gap-3">
        <form action={requestReaccess}>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-full"
          >
            <RotateCcw className="h-4 w-4" />
            Solicitar reingreso
          </button>
        </form>

        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}