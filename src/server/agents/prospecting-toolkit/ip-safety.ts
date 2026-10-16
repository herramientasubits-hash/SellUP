/**
 * Prospecting Toolkit — qué direcciones nunca se descargan (anti-SSRF, puro).
 *
 * El guard anterior comparaba el TEXTO del host: `[::ffff:127.0.0.1]` (que la URL
 * normaliza a `[::ffff:7f00:1]`), `[::]`, las ULA `fd00::/8` o un nombre DNS que
 * apunta a una IP privada pasaban. Aquí se decide por la DIRECCIÓN:
 *
 *   · IPv4: no enrutables (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
 *     192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24,
 *     224/4 multicast y 240/4 reservado, incluido 255.255.255.255);
 *   · IPv6: `::`, `::1`, IPv4 mapeado (`::ffff:a.b.c.d`) o compatible (`::a.b.c.d`),
 *     NAT64 (`64:ff9b::/96`) y 6to4 (`2002::/16`) con la IPv4 embebida mirada como
 *     IPv4, Teredo (`2001::/32`), documentación (`2001:db8::/32`), ULA (`fc00::/7`),
 *     link-local (`fe80::/10`), site-local (`fec0::/10`) y multicast (`ff00::/8`);
 *   · nombres: `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`
 *     y nombres de una sola etiqueta (intranets).
 *
 * Sin E/S: la resolución DNS la hace quien llama (website-verifier).
 */

import { isIP } from 'node:net';

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? (octets as [number, number, number, number]) : null;
}

export function isBlockedIpv4(ip: string): boolean {
  const octets = ipv4Octets(ip);
  if (!octets) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Los 8 grupos de 16 bits de una IPv6 (acepta `::` y una IPv4 final), o `null`. */
export function parseIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const octets = ipv4Octets(text.slice(lastColon + 1));
    if (!octets) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    text = `${text.slice(0, lastColon + 1)}`;
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 && known !== 8) return null;
  if (halves.length === 2 && known > 7) return null;
  const zeros = new Array(8 - known).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...(halves.length === 2 ? zeros : []), ...rest.map((g) => parseInt(g, 16)), ...tail];
}

function embeddedIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return true;
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (g.every((x) => x === 0)) return true; // ::
  if (allZeroUpTo(7) && g[7] === 1) return true; // ::1
  // IPv4 mapeado (::ffff:a.b.c.d) y compatible (::a.b.c.d): se juzga la IPv4.
  if (allZeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedIpv4(embeddedIpv4(g[6], g[7]));
  // NAT64 64:ff9b::/96 — la IPv4 embebida decide.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIpv4(embeddedIpv4(g[6], g[7]));
  // 6to4 2002::/16 — la IPv4 va en los grupos 1 y 2.
  if (g[0] === 0x2002) return isBlockedIpv4(embeddedIpv4(g[1], g[2]));
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentación
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (obsoleto)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** ¿Esta dirección IP (4 o 6, sin corchetes) NO se puede descargar? */
export function isBlockedIpAddress(ip: string): boolean {
  const version = isIP(ip.split('%')[0]);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

const RESERVED_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

/**
 * ¿El host de una URL (como lo devuelve `URL.hostname`, con corchetes en IPv6)
 * NO se puede descargar, sin necesidad de resolver DNS?
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(bare.split('%')[0])) return isBlockedIpAddress(bare);
  if (bare === 'localhost' || bare === 'localhost.localdomain') return true;
  if (RESERVED_NAME_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return true;
  // Un nombre de una sola etiqueta sólo existe dentro de una red privada.
  return !bare.includes('.');
}

/** El host es una IP escrita tal cual (no hace falta resolver DNS). */
export function isIpLiteralHostname(hostname: string): boolean {
  const host = hostname.trim().replace(/^\[|\]$/g, '');
  return isIP(host.split('%')[0]) !== 0;
}
