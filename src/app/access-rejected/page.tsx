import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LogOut, Mail, XCircle } from 'lucide-react';
import { signOut } from '@/modules/auth/actions';

export default async function AccessRejectedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="w-full max-w-md text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <XCircle className="h-8 w-8 text-destructive" />
      </div>

      <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-foreground">
        Acceso no aprobado
      </h1>

      <p className="mb-8 text-sm text-muted-foreground leading-relaxed">
        Tu solicitud de acceso a SellUp no fue aprobada. Si crees que esto es
        un error, por favor contacta al administrador del sistema para más
        información.
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