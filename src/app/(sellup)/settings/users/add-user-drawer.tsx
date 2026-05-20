'use client';

import { useState } from 'react';
import { UserPlus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createPreapproval } from '@/modules/access/actions';
import type { Role, InternalUser, OrganizationGroup } from '@/modules/access/types';

const NO_MANAGER = '__none__';
const NO_GROUP = '__none__';

interface AddUserDrawerProps {
  roles: Role[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
}

export function AddUserDrawer({ roles, activeUsers, groups }: AddUserDrawerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [notes, setNotes] = useState('');

  const emailValid = email.endsWith('@ubits.co') && email.length > 10;

  function reset() {
    setEmail('');
    setFullName('');
    setRoleId('');
    setManagerId('');
    setGroupId('');
    setNotes('');
    setError(null);
  }

  async function handleSubmit() {
    if (!emailValid || !roleId) return;
    setLoading(true);
    setError(null);

    const result = await createPreapproval({
      email: email.trim().toLowerCase(),
      full_name: fullName.trim() || null,
      role_id: roleId,
      manager_id: managerId && managerId !== NO_MANAGER ? managerId : null,
      group_id: groupId && groupId !== NO_GROUP ? groupId : null,
      notes: notes.trim() || null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }

    reset();
    setOpen(false);
    window.location.reload();
  }

  const groupsByDepth = {
    root: groups.filter(g => g.depth === 0),
    mid: groups.filter(g => g.depth === 1),
    leaf: groups.filter(g => g.depth === 2),
  };

  function groupLabel(g: OrganizationGroup): string {
    const prefix = g.depth === 0 ? '' : g.depth === 1 ? '  · ' : '    ↳ ';
    return prefix + g.name;
  }

  const sortedGroups = [
    ...groupsByDepth.root,
    ...groupsByDepth.mid,
    ...groupsByDepth.leaf,
  ];

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Agregar usuario
      </Button>

      <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Agregar usuario manualmente</SheetTitle>
          <SheetDescription>
            Preautoriza un correo corporativo. El usuario podrá ingresar la primera vez
            que inicie sesión con su cuenta Google <span className="font-medium">@ubits.co</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {/* Info banner */}
          <div className="flex gap-3 rounded-xl border border-su-brand/20 bg-su-brand-soft px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
            <p className="text-xs text-su-brand leading-relaxed">
              Este usuario quedará <strong>preautorizado</strong>. No se crea contraseña ni se
              envía invitación. El acceso se activa automáticamente cuando la persona inicie
              sesión con Google por primera vez.
            </p>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="pu-email">
              Correo corporativo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pu-email"
              type="email"
              placeholder="nombre.apellido@ubits.co"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={email && !emailValid ? 'border-destructive' : ''}
            />
            {email && !emailValid && (
              <p className="text-xs text-destructive">El correo debe terminar en @ubits.co</p>
            )}
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="pu-name">Nombre completo</Label>
            <Input
              id="pu-name"
              placeholder="Nombre Apellido"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label>
              Rol base <span className="text-destructive">*</span>
            </Label>
            <Select value={roleId || undefined} onValueChange={v => setRoleId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Manager */}
          <div className="space-y-1.5">
            <Label>Líder inmediato <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Select value={managerId || undefined} onValueChange={v => setManagerId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin líder asignado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MANAGER}>Sin líder asignado</SelectItem>
                {activeUsers.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name ?? u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Group */}
          <div className="space-y-1.5">
            <Label>Grupo organizacional <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Select value={groupId || undefined} onValueChange={v => setGroupId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin grupo asignado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Sin grupo asignado</SelectItem>
                {sortedGroups.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {groupLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="pu-notes">Notas internas <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Textarea
              id="pu-notes"
              placeholder="Contexto de la preautorización..."
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="resize-none"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
              {error}
            </p>
          )}
        </div>

        <SheetFooter className="mt-8 gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }} className="w-full sm:w-auto">
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!emailValid || !roleId || loading}
            className="w-full sm:w-auto"
          >
            {loading ? 'Preautorizando...' : 'Preautorizar usuario'}
          </Button>
        </SheetFooter>
      </SheetContent>
      </Sheet>
    </>
  );
}
