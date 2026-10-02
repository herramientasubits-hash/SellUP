/**
 * Helpers genericos sobre ParamsBundle. No conocen ningun producto: el panel
 * de admin, el export/import de configuracion y los lectores tipados sirven
 * igual para LMS, Seleccion y Cultura.
 *
 * El JSON exportado guarda solo { value, fuente } por id. Los labels, rangos
 * y descripciones viven en el codigo, asi que una configuracion vieja no
 * arrastra textos obsoletos al importarse.
 */

import * as z from 'zod';
import type {
  CurvaValue,
  ParamKind,
  ParamSpec,
  ParamValue,
  ParamsBundle,
  ProductId,
  StepsValue,
  VentanaValue,
} from './types';

export function crearBundle(
  productId: ProductId,
  specs: ParamSpec[],
  now: () => Date = () => new Date(),
): ParamsBundle {
  const params: Record<string, ParamSpec> = {};
  for (const spec of specs) params[spec.id] = spec;

  return {
    productId,
    schemaVersion: 1,
    actualizadoEn: now().toISOString(),
    params,
    orden: specs.map((s) => s.id),
  };
}

// ---------------------------------------------------------------------------
// Lectores tipados
// ---------------------------------------------------------------------------

/**
 * Lee un parametro por id. Si falta o el tipo no coincide, cae al respaldo en
 * vez de propagar undefined: un bundle importado a medias no debe producir
 * NaN silenciosos aguas abajo.
 */
function leer<T extends ParamValue>(
  bundle: ParamsBundle,
  id: string,
  esValido: (v: unknown) => v is T,
  respaldo: T,
): T {
  const spec = bundle.params[id];
  if (!spec) return respaldo;
  if (esValido(spec.value)) return spec.value;
  if (esValido(spec.defaultValue)) return spec.defaultValue;
  return respaldo;
}

const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Valida la FORMA del valor segun su kind.
 *
 * Antes se comparaba `typeof guardado === typeof defecto`, y steps, interp y
 * ventana son los tres 'object': un valor de escalera guardado se aceptaba en
 * un parametro de rampa y producia undefined aguas abajo. Ahora cada kind dice
 * que estructura espera.
 */
const VALIDADOR: Record<ParamKind, (v: unknown) => boolean> = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  currency: (v) => typeof v === 'number' && Number.isFinite(v),
  percent: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  enum: (v) => typeof v === 'string',
  steps: (v) =>
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as StepsValue).tramos) &&
    (v as StepsValue).tramos.every(
      (t) => typeof t?.valor === 'number' && (t.hasta === null || typeof t.hasta === 'number'),
    ),
  curva: (v) =>
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as CurvaValue).anclas) &&
    (v as CurvaValue).anclas.length > 0 &&
    (v as CurvaValue).anclas.every(
      (a) => typeof a?.cantidad === 'number' && typeof a?.valor === 'number',
    ),
  ventana: (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as VentanaValue).desde === 'object' &&
    typeof (v as VentanaValue).desde?.anio === 'number' &&
    typeof (v as VentanaValue).desde?.mes === 'number',
};

/** true si el valor encaja con la forma que ese kind espera. */
export const coincideKind = (kind: ParamKind, valor: unknown): boolean =>
  VALIDADOR[kind]?.(valor) ?? false;
const esBooleano = (v: unknown): v is boolean => typeof v === 'boolean';
const esTexto = (v: unknown): v is string => typeof v === 'string';
const esSteps = (v: unknown): v is StepsValue =>
  typeof v === 'object' && v !== null && Array.isArray((v as StepsValue).tramos);
const esCurva = (v: unknown): v is CurvaValue =>
  typeof v === 'object' && v !== null && Array.isArray((v as CurvaValue).anclas);
const esVentana = (v: unknown): v is VentanaValue =>
  typeof v === 'object' && v !== null && typeof (v as VentanaValue).desde === 'object';

export const numeroParam = (b: ParamsBundle, id: string, respaldo = 0): number =>
  leer(b, id, esNumero, respaldo);
export const booleanoParam = (b: ParamsBundle, id: string, respaldo = false): boolean =>
  leer(b, id, esBooleano, respaldo);
export const textoParam = (b: ParamsBundle, id: string, respaldo = ''): string =>
  leer(b, id, esTexto, respaldo);
export const stepsParam = (b: ParamsBundle, id: string, respaldo: StepsValue): StepsValue =>
  leer(b, id, esSteps, respaldo);
export const curvaParam = (b: ParamsBundle, id: string, respaldo: CurvaValue): CurvaValue =>
  leer(b, id, esCurva, respaldo);
export const ventanaParam = (b: ParamsBundle, id: string, respaldo: VentanaValue): VentanaValue =>
  leer(b, id, esVentana, respaldo);

/** Etiqueta de la fuente, para el tooltip "de donde sale este supuesto". */
export const fuenteParam = (b: ParamsBundle, id: string): string => b.params[id]?.fuente ?? '';

// ---------------------------------------------------------------------------
// Edicion
// ---------------------------------------------------------------------------

function conParams(
  bundle: ParamsBundle,
  params: Record<string, ParamSpec>,
  now: () => Date,
): ParamsBundle {
  return { ...bundle, params, actualizadoEn: now().toISOString() };
}

export function aplicarValor(
  bundle: ParamsBundle,
  id: string,
  value: ParamValue,
  now: () => Date = () => new Date(),
): ParamsBundle {
  const spec = bundle.params[id];
  if (!spec) return bundle;
  return conParams(bundle, { ...bundle.params, [id]: { ...spec, value } }, now);
}

export function aplicarFuente(
  bundle: ParamsBundle,
  id: string,
  fuente: string,
  now: () => Date = () => new Date(),
): ParamsBundle {
  const spec = bundle.params[id];
  if (!spec) return bundle;
  return conParams(bundle, { ...bundle.params, [id]: { ...spec, fuente } }, now);
}

export function restaurarParam(
  bundle: ParamsBundle,
  id: string,
  base: ParamsBundle,
  now: () => Date = () => new Date(),
): ParamsBundle {
  const spec = bundle.params[id];
  const original = base.params[id];
  if (!spec || !original) return bundle;
  return conParams(
    bundle,
    { ...bundle.params, [id]: { ...spec, value: original.defaultValue, fuente: original.fuente } },
    now,
  );
}

export function restaurarTodo(base: ParamsBundle, now: () => Date = () => new Date()): ParamsBundle {
  const params: Record<string, ParamSpec> = {};
  for (const [id, spec] of Object.entries(base.params)) {
    params[id] = { ...spec, value: spec.defaultValue };
  }
  return conParams(base, params, now);
}

export interface DiffParam {
  id: string;
  label: string;
  grupo: string;
  defaultValue: ParamValue;
  value: ParamValue;
}

/** Alimenta el badge "N supuestos modificados" y el pie de los exports. */
export function diffDesdeDefaults(bundle: ParamsBundle): DiffParam[] {
  const diffs: DiffParam[] = [];
  for (const id of bundle.orden) {
    const spec = bundle.params[id];
    if (!spec) continue;
    if (JSON.stringify(spec.value) !== JSON.stringify(spec.defaultValue)) {
      diffs.push({
        id,
        label: spec.label,
        grupo: spec.grupo,
        defaultValue: spec.defaultValue,
        value: spec.value,
      });
    }
  }
  return diffs;
}

/** Agrupa para el panel de admin, respetando el orden declarado. */
export function agruparParams(bundle: ParamsBundle): Array<{ grupo: string; params: ParamSpec[] }> {
  const grupos: Array<{ grupo: string; params: ParamSpec[] }> = [];
  for (const id of bundle.orden) {
    const spec = bundle.params[id];
    if (!spec) continue;
    const existente = grupos.find((g) => g.grupo === spec.grupo);
    if (existente) existente.params.push(spec);
    else grupos.push({ grupo: spec.grupo, params: [spec] });
  }
  return grupos;
}

/**
 * Fusiona una configuracion guardada con el catalogo vigente del codigo.
 * Conserva valor y fuente de los ids que siguen existiendo, adopta los
 * parametros nuevos con su default y descarta los que ya no existen, de modo
 * que un localStorage viejo nunca deja la app sin un supuesto.
 */
export function fusionarParams(persistido: ParamsBundle | null, base: ParamsBundle): ParamsBundle {
  if (!persistido || persistido.productId !== base.productId) return base;

  const params: Record<string, ParamSpec> = {};
  for (const [id, spec] of Object.entries(base.params)) {
    const guardado = persistido.params[id];
    // Un parametro que el usuario nunca toco sigue al codigo. Se reconoce
    // porque su valor guardado es identico al default con el que se guardo:
    // sin esto, cambiar un defecto no llegaba nunca a quien ya tenia la app
    // abierta, y el cambio parecia no haberse hecho.
    const sinTocar =
      guardado !== undefined &&
      JSON.stringify(guardado.value) === JSON.stringify(guardado.defaultValue);

    params[id] =
      guardado && !sinTocar && coincideKind(spec.kind, guardado.value)
        ? { ...spec, value: guardado.value, fuente: guardado.fuente ?? spec.fuente }
        : { ...spec, fuente: sinTocar ? spec.fuente : (guardado?.fuente ?? spec.fuente) };
  }
  return { ...base, params, actualizadoEn: persistido.actualizadoEn ?? base.actualizadoEn };
}

// ---------------------------------------------------------------------------
// Export / import como JSON
// ---------------------------------------------------------------------------

/**
 * La forma del archivo, no la del parametro: quien decide si un valor encaja
 * con SU parametro es `coincideKind`, que corre por id mas abajo. Por eso el
 * tipo del union es mas ancho que `ParamValue` y admite formas que ya no son
 * ningun kind vivo.
 */
const valorSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.object({
    tramos: z.array(z.object({ hasta: z.number().nullable(), valor: z.number() })),
  }),
  z.object({ anclas: z.array(z.object({ cantidad: z.number(), valor: z.number() })) }),
  // La rampa de dos anclas ya no existe como kind, pero se sigue aceptando al
  // leer el archivo: un JSON exportado antes de la curva tiene que poder
  // importarse: ese parametro cae a su valor por defecto con un aviso, en vez
  // de tumbar el archivo entero.
  z.object({
    minPoblacion: z.number(),
    maxPoblacion: z.number(),
    valorEnMin: z.number(),
    valorEnMax: z.number(),
  }),
  z.object({ desde: z.object({ anio: z.number(), mes: z.number() }) }),
]);

const archivoSchema = z.object({
  productId: z.string(),
  schemaVersion: z.number(),
  actualizadoEn: z.string().optional(),
  valores: z.record(z.string(), z.object({ value: valorSchema, fuente: z.string().optional() })),
});

export type ArchivoParams = z.infer<typeof archivoSchema>;

export function exportarParams(bundle: ParamsBundle): string {
  const valores: ArchivoParams['valores'] = {};
  for (const id of bundle.orden) {
    const spec = bundle.params[id];
    if (!spec) continue;
    valores[id] = { value: spec.value, fuente: spec.fuente };
  }
  return JSON.stringify(
    {
      productId: bundle.productId,
      schemaVersion: bundle.schemaVersion,
      actualizadoEn: bundle.actualizadoEn,
      valores,
    },
    null,
    2,
  );
}

export interface ResultadoImport {
  ok: boolean;
  bundle: ParamsBundle;
  errores: string[];
  /** Ids desconocidos o ausentes: se reportan, nunca se silencian. */
  avisos: string[];
}

export function importarParams(
  crudo: unknown,
  base: ParamsBundle,
  now: () => Date = () => new Date(),
): ResultadoImport {
  const errores: string[] = [];
  const avisos: string[] = [];

  let datos: unknown = crudo;
  if (typeof crudo === 'string') {
    try {
      datos = JSON.parse(crudo);
    } catch {
      return { ok: false, bundle: base, errores: ['El archivo no es un JSON válido.'], avisos };
    }
  }

  const parseo = archivoSchema.safeParse(datos);
  if (!parseo.success) {
    return {
      ok: false,
      bundle: base,
      errores: ['El archivo no tiene la estructura de una configuración de parámetros.'],
      avisos,
    };
  }

  const archivo = parseo.data;
  if (archivo.productId !== base.productId) {
    errores.push(
      `La configuración es del producto "${archivo.productId}" y este módulo es "${base.productId}".`,
    );
  }
  if (archivo.schemaVersion !== base.schemaVersion) {
    errores.push(
      `Versión de esquema ${archivo.schemaVersion}; esta app espera ${base.schemaVersion}.`,
    );
  }
  if (errores.length > 0) return { ok: false, bundle: base, errores, avisos };

  const params: Record<string, ParamSpec> = {};
  for (const [id, spec] of Object.entries(base.params)) {
    const entrada = archivo.valores[id];
    if (!entrada) {
      avisos.push(`"${spec.label}" no venía en el archivo; se dejó el valor por defecto.`);
      params[id] = { ...spec, value: spec.defaultValue };
      continue;
    }
    if (!coincideKind(spec.kind, entrada.value)) {
      avisos.push(`"${spec.label}" traía un tipo distinto al esperado; se dejó el valor por defecto.`);
      params[id] = { ...spec, value: spec.defaultValue };
      continue;
    }
    params[id] = {
      ...spec,
      // `coincideKind` acaba de comprobar la forma contra el kind del spec.
      value: entrada.value as ParamValue,
      fuente: entrada.fuente ?? spec.fuente,
    };
  }

  for (const id of Object.keys(archivo.valores)) {
    if (!base.params[id]) avisos.push(`El archivo trae un parámetro desconocido: "${id}".`);
  }

  return { ok: true, bundle: conParams(base, params, now), errores, avisos };
}
