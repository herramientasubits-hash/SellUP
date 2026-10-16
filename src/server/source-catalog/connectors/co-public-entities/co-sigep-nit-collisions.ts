/**
 * co-sigep-nit-collisions.ts — NIT compartidos por entidades DISTINTAS en el SIGEP II.
 *
 * El SIGEP trae errores de captura: la misma cifra de NIT escrita en dos entidades que
 * no tienen nada que ver. Medido el 16-10-2026 sobre los datos públicos (4.150 filas):
 * 12 NIT con dos entidades «cabeza» distintas, p. ej. el Ministerio de Salud con el NIT
 * del Ministerio del Trabajo (830115226), la Alcaldía de Baraya con el de Maicao o la
 * Alcaldía de Restrepo con el de Puerto Rico (Meta). Al cargar «una fila por NIT» se
 * fundían: los servidores se SUMABAN y el nombre lo decidía el mayor, de modo que la
 * entidad de verdad quedaba con un tamaño inflado y la otra sin tamaño en su propio NIT.
 *
 * Regla (conservadora, sólo cabeza contra cabeza). Para un NIT con dos o más nombres
 * «cabeza» distintos, el CHIP de la Contaduría —que sí tiene el NIT correcto de cada
 * entidad— dice quién es el dueño: el nombre que concuerda con el del CHIP se queda y
 * los demás se sacan de ese NIT. Una entidad sacada se pasa a su NIT propio sólo si el
 * CHIP la conoce con ese mismo nombre, el NIT es único y el SIGEP no tiene filas ahí
 * (si no, se suman servidores dos veces); si no hay destino claro, se descarta de la
 * carga. Sin dueño claro (el CHIP no tiene el NIT, ninguno concuerda o concuerdan
 * varios, p. ej. «Alcaldía de X» y «Alcaldía Distrital de X») NO se toca: queda como
 * antes y se informa.
 *
 * Fuera de alcance a propósito: entidades que no son «cabeza» (concejo, personería,
 * fuerzas militares bajo el NIT del Ministerio de Defensa…) conviven con su NIT. La única
 * excepción es una lista corta de errores de captura verificados a mano
 * (`MISCAPTURED_SIGEP_ENTITIES`): el Ejército figura con el NIT de la Superintendencia de
 * Servicios Públicos y le sumaba ~4.500 servidores.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

/** Una fila del SIGEP ya reducida a lo que hace falta para detectar el choque. */
export type SigepNitFact = {
  nit: string;
  /** Nombre normalizado (`normalizeColombiaCompanyNameCore`). */
  nameKey: string;
  head: boolean;
  workers: number;
};

export type NitCollisionMoved = { name: string; toNit: string; workers: number };
export type NitCollisionDropped = {
  name: string;
  workers: number;
  reason: 'sin_destino' | 'destino_ya_tiene_sigep';
};

export type NitCollisionReport =
  | {
      nit: string;
      resolution: 'correccion_manual';
      name: string;
      workers: number;
      movedTo: string | null;
      reason: string;
    }
  | {
      nit: string;
      resolution: 'resuelto';
      chipName: string;
      kept: string;
      moved: NitCollisionMoved[];
      dropped: NitCollisionDropped[];
    }
  | {
      nit: string;
      resolution: 'sin_resolver';
      chipName: string | null;
      reason: 'sin_nombre_chip' | 'ninguna_concuerda' | 'varias_concuerdan';
      names: string[];
    };

/**
 * Entidades que el SIGEP captura con el NIT de OTRA, verificadas a mano contra el CHIP y la
 * entidad real. No son «cabeza contra cabeza», así que la regla general no las ve. Agregar
 * una exige evidencia (qué dice el CHIP para ese NIT) y se informa en cada carga.
 */
export const MISCAPTURED_SIGEP_ENTITIES: ReadonlyArray<{ nit: string; nameKey: string; reason: string }> = [
  {
    nit: '800250984',
    nameKey: 'EJERCITO NACIONAL DE COLOMBIA',
    reason: 'el SIGEP lo captura como «8002509846» (NIT de la Superintendencia de Servicios Públicos + su dígito); el CHIP dice que 800250984 es de la Superintendencia',
  },
];

/** Palabras que no identifican a la entidad: clase de entidad, artículos y preposiciones. */
const NON_IDENTIFYING = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E',
  'ALCALDIA', 'GOBERNACION', 'DEPARTAMENTO', 'MINISTERIO', 'MUNICIPIO', 'MUNICIPAL',
  'DISTRITO', 'DISTRITAL', 'ESPECIAL', 'TURISTICO', 'CULTURAL', 'HISTORICO',
]);

function identifyingTokens(core: string): string[] {
  const tokens = core.split(/\s+/).filter((t) => t !== '');
  const kept = tokens.filter((t) => !NON_IDENTIFYING.has(t));
  return kept.length > 0 ? kept : tokens;
}

/**
 * ¿El nombre del SIGEP concuerda con el del CHIP? Si TODAS las palabras que identifican
 * a uno están en el otro (CHIP «MAICAO» ⊂ «ALCALDIA DE MAICAO»; «SAN JUANITO» no cabe
 * en «SAN MARTIN DE LOS LLANOS META»: no basta compartir «SAN»).
 */
export function sigepNameMatchesChip(sigepCore: string, chipCore: string): boolean {
  const a = identifyingTokens(sigepCore);
  const b = identifyingTokens(chipCore);
  if (a.length === 0 || b.length === 0) return false;
  const inA = new Set(a);
  const inB = new Set(b);
  return b.every((t) => inA.has(t)) || a.every((t) => inB.has(t));
}

export type NitCollisionInput = {
  facts: readonly SigepNitFact[];
  /** Nombre normalizado del CHIP por NIT (último periodo). */
  chipNameByNit: ReadonlyMap<string, string>;
  /** NIT del CHIP por nombre normalizado. */
  chipNitsByName: ReadonlyMap<string, ReadonlySet<string>>;
};

export type NitCollisionResult = {
  /** Por fila de entrada: el NIT al que pertenece, o `null` si se descarta de la carga. */
  assignment: (string | null)[];
  collisions: NitCollisionReport[];
};

export function resolveSigepNitCollisions(input: NitCollisionInput): NitCollisionResult {
  const { facts, chipNameByNit, chipNitsByName } = input;
  const assignment: (string | null)[] = facts.map((f) => f.nit);
  const collisions: NitCollisionReport[] = [];
  const allNits = new Set(facts.map((f) => f.nit));
  const isManual = (fact: SigepNitFact) => MISCAPTURED_SIGEP_ENTITIES.some((m) => m.nit === fact.nit && m.nameKey === fact.nameKey);
  for (const manual of MISCAPTURED_SIGEP_ENTITIES) {
    const indexes = facts.flatMap((f, i) => (f.nit === manual.nit && f.nameKey === manual.nameKey ? [i] : []));
    if (indexes.length === 0) continue;
    const homes = chipNitsByName.get(manual.nameKey);
    const home = homes !== undefined && homes.size === 1 ? [...homes][0] : null;
    const target = home !== null && home !== manual.nit && !allNits.has(home) ? home : null;
    for (const i of indexes) assignment[i] = target;
    collisions.push({
      nit: manual.nit,
      resolution: 'correccion_manual',
      name: manual.nameKey,
      workers: indexes.reduce((sum, i) => sum + facts[i].workers, 0),
      movedTo: target,
      reason: manual.reason,
    });
  }
  const byNit = new Map<string, Map<string, number[]>>();
  facts.forEach((fact, index) => {
    if (isManual(fact)) return;
    const names = byNit.get(fact.nit) ?? new Map<string, number[]>();
    names.set(fact.nameKey, [...(names.get(fact.nameKey) ?? []), index]);
    byNit.set(fact.nit, names);
  });
  const sigepNits = allNits;
  const workersOf = (indexes: readonly number[]) => indexes.reduce((sum, i) => sum + facts[i].workers, 0);

  for (const [nit, names] of [...byNit].sort(([a], [b]) => a.localeCompare(b))) {
    const heads = [...names].filter(([, indexes]) => indexes.some((i) => facts[i].head));
    if (heads.length < 2) continue;
    const headNames = heads.map(([name]) => name);
    const chipName = chipNameByNit.get(nit) ?? null;
    if (chipName === null) {
      collisions.push({ nit, resolution: 'sin_resolver', chipName, reason: 'sin_nombre_chip', names: headNames });
      continue;
    }
    const owners = heads.filter(([name]) => sigepNameMatchesChip(name, chipName));
    if (owners.length !== 1) {
      collisions.push({
        nit,
        resolution: 'sin_resolver',
        chipName,
        reason: owners.length === 0 ? 'ninguna_concuerda' : 'varias_concuerdan',
        names: headNames,
      });
      continue;
    }
    const moved: NitCollisionMoved[] = [];
    const dropped: NitCollisionDropped[] = [];
    for (const [name, indexes] of heads) {
      if (name === owners[0][0]) continue;
      const homes = chipNitsByName.get(name);
      const home = homes !== undefined && homes.size === 1 ? [...homes][0] : null;
      const workers = workersOf(indexes);
      if (home !== null && home !== nit && !sigepNits.has(home)) {
        for (const i of indexes) assignment[i] = home;
        moved.push({ name, toNit: home, workers });
      } else {
        for (const i of indexes) assignment[i] = null;
        dropped.push({ name, workers, reason: home !== null && sigepNits.has(home) ? 'destino_ya_tiene_sigep' : 'sin_destino' });
      }
    }
    collisions.push({ nit, resolution: 'resuelto', chipName, kept: owners[0][0], moved, dropped });
  }
  return { assignment, collisions };
}
