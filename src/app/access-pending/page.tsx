import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LogOut, Mail, Clock } from 'lucide-react';
import { signOut } from '@/modules/auth/actions';

export default async function AccessPendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="w-full max-w-md text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
        <Clock className="h-8 w-8 text-amber-500" />
      </div>

      <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-foreground">
        Solicitud enviada
      </h1>

      <p className="mb-8 text-sm text-muted-foreground leading-relaxed">
        Tu solicitud de acceso a SellUp ha sido recibida y está pendiente de
        revisión por un administrador. Recibirás una notificación cuando tu
        acceso sea aprobado.
      </p>

      <div className="mb-8 flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card p-4">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-foreground">{user.email}</span>
      </div>

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
  );
}