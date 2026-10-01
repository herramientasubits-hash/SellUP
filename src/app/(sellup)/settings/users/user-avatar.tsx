import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const MAX_INITIALS = 2;

/**
 * Las iniciales de una persona: las dos primeras palabras de su nombre o, si
 * todavía no tiene nombre, las dos primeras letras de su correo.
 */
export function getUserInitials(name: string | null | undefined, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words
      .slice(0, MAX_INITIALS)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  }
  return email.slice(0, MAX_INITIALS).toUpperCase();
}

const SIZE_CLASSES = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-9',
  lg: 'size-10',
  xl: 'size-12',
} as const;

export type UserAvatarSize = keyof typeof SIZE_CLASSES;

interface UserAvatarProps {
  name: string | null | undefined;
  email: string;
  size?: UserAvatarSize;
  className?: string;
}

/**
 * El avatar con iniciales de «Usuarios y acceso». Una sola pieza para la
 * tabla, el organigrama, los grupos y los diálogos: mismas iniciales y mismo
 * tinte en todos.
 */
export function UserAvatar({ name, email, size = 'md', className }: UserAvatarProps) {
  const isLarge = size === 'xl';
  return (
    <Avatar className={cn(SIZE_CLASSES[size], 'shrink-0', className)}>
      <AvatarFallback
        className={cn('bg-primary/10 text-primary', isLarge ? 'text-sm font-semibold' : 'text-xs')}
      >
        {getUserInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
