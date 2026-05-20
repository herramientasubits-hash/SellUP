'use client';

import { useState } from 'react';
import { UserPlus, Mail, CheckCircle2, XCircle, ChevronDown, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { createPreapproval } from '@/modules/access/actions';
import type { Role, InternalUser, OrganizationGroup } from '@/modules/access/types';

const NO_MANAGER = '__none__';
const NO_GROUP = '__none__';

interface AddUserDrawerProps {
  roles: Role[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
}

function getInitials(name: string, email: string): string {
  if (name.trim()) return name.trim().split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const local = email.split('@')[0];
  return local.slice(0, 2).toUpperCase();
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

  const emailTouched = email.length > 0;
  const emailValid = email.endsWith('@ubits.co') && email.length > 10;

  const selectedRole = roles.find(r => r.id === roleId);
  const selectedManager = activeUsers.find(u => u.id === managerId);
  const selectedGroup = groups.find(g => g.id === groupId);
  const previewInitials = getInitials(fullName, email || 'NN');

  const sortedGroups = [...groups].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.name.localeCompare(b.name);
  });

  function reset() {
    setEmail(''); setFullName(''); setRoleId('');
    setManagerId(''); setGroupId(''); setNotes('');
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

  return (
    <>
      <Button size="sm" className="gap-2 h-9 text-xs font-medium" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" />
        Agregar usuario
      </Button>

      <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">

          {/* ── Sticky header ───────────────────────────────── */}
          <div className="shrink-0 border-b border-border/60 px-6 pt-6 pb-4">
            <SheetHeader className="space-y-1">
              <SheetTitle className="text-base font-semibold">Agregar usuario</SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">
                Preautoriza un correo <span className="font-medium text-foreground">@ubits.co</span>.
                El acceso se activa en el primer inicio de sesión con Google.
              </SheetDescription>
            </SheetHeader>
          </div>

          {/* ── Scrollable body ──────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* Identity preview */}
            <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarFallback className="bg-su-brand-soft text-su-brand text-sm font-semibold">
                  {previewInitials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {fullName.trim() || <span className="text-muted-foreground italic">Nombre completo</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {email || <span className="italic">correo@ubits.co</span>}
                </p>
                {selectedRole && (
                  <Badge variant="outline" className="mt-1 text-[10px] bg-su-brand-soft text-su-brand border-su-brand/20">
                    {selectedRole.name}
                  </Badge>
                )}
              </div>
            </div>

            {/* ── Section: Identidad ────────────────────────── */}
            <div className="space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Identidad
              </p>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="au-email" className="text-sm">
                  Correo corporativo <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="au-email"
                    type="email"
                    placeholder="nombre.apellido@ubits.co"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={`pl-9 pr-9 ${
                      emailTouched
                        ? emailValid
                          ? 'border-emerald-500/60 focus-visible:ring-emerald-500/30'
                          : 'border-destructive/60 focus-visible:ring-destructive/30'
                        : ''
                    }`}
                  />
                  {emailTouched && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      {emailValid
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <XCircle className="h-4 w-4 text-destructive" />
                      }
                    </span>
                  )}
                </div>
                {emailTouched && !emailValid && (
                  <p className="text-xs text-destructive">Debe terminar en @ubits.co</p>
                )}
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="au-name" className="text-sm">
                  Nombre completo <span className="text-xs text-muted-foreground">(opcional)</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="au-name"
                    placeholder="Nombre Apellido"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {/* ── Section: Acceso ───────────────────────────── */}
            <div className="space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Acceso
              </p>

              {/* Role */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Rol base <span className="text-destructive">*</span>
                </Label>
                <Select value={roleId || undefined} onValueChange={v => setRoleId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map(r => (
                      <SelectItem key={r.id} value={r.id}>
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium">{r.name}</span>
                          {r.description && (
                            <span className="text-[11px] text-muted-foreground leading-tight">{r.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Manager */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Líder inmediato <span className="text-xs text-muted-foreground">(opcional)</span>
                </Label>
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
                {selectedManager && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className="bg-su-brand-soft text-su-brand text-[10px]">
                        {getInitials(selectedManager.full_name ?? '', selectedManager.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-foreground">{selectedManager.full_name ?? selectedManager.email}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Section: Organización ─────────────────────── */}
            <div className="space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Organización
              </p>

              <div className="space-y-1.5">
                <Label className="text-sm">
                  Grupo <span className="text-xs text-muted-foreground">(opcional)</span>
                </Label>
                <Select value={groupId || undefined} onValueChange={v => setGroupId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin grupo asignado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP}>Sin grupo asignado</SelectItem>
                    {sortedGroups.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        {'  '.repeat(g.depth)}{g.depth > 0 ? '· ' : ''}{g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedGroup && (
                  <p className="text-xs text-muted-foreground px-1">
                    <ChevronDown className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                    Nivel {selectedGroup.depth + 1}
                    {selectedGroup.parent_group_id && ' · subgrupo'}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="au-notes" className="text-sm">
                  Notas internas <span className="text-xs text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id="au-notes"
                  placeholder="Contexto de la preautorización, área, fecha de ingreso..."
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="resize-none text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* ── Sticky footer ────────────────────────────────── */}
          <div className="shrink-0 border-t border-border/60 px-6 py-4 flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => { setOpen(false); reset(); }}
              className="text-sm"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!emailValid || !roleId || loading}
              className="text-sm gap-2 h-9"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {loading ? 'Preautorizando...' : 'Preautorizar'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
