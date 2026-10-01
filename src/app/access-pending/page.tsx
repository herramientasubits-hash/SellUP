import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LogOut, Mail, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-warning/10">
        <Clock className="h-7 w-7 text-warning" aria-hidden="true" />
      </div>

      <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground">
        Solicitud enviada
      </h1>

      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        Tu solicitud de acceso a SellUp ha sido recibida y está pendiente de
        revisión por un administrador. Recibirás una notificación cuando tu
        acceso sea aprobado.
      </p>

      <div className="mb-8 flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-card">
        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm text-foreground" title={user.email}>{user.email}</span>
      </div>

      <form action={signOut}>
        <Button
          type="submit"
          variant="outline"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Cerrar sesión
        </Button>
      </form>
    </div>
  );
}