/**
 * Validacion de los inputs del LMS. Vive en el dominio, no en el formulario:
 * la UI pinta los mensajes pero no decide las reglas.
 *
 * Los opcionales aceptan cadena vacia y la convierten en null ("no lo se,
 * derivalo del supuesto"), que es como los captura el formulario.
 */

import * as z from 'zod';
import type { ErrorValidacion } from '../types';
import type { LMSInput } from './types';

const requerido = 'Este campo es obligatorio.';
const noEsNumero = 'Debe ser un número.';

/** Numero que acepta "", null y undefined como "sin dato". */
const opcionalNumero = (min = 0) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z
      .number({ error: noEsNumero })
      .min(min, `No puede ser menor que ${min}.`)
      .nullable(),
  );

const numero = (min: number, mensaje = requerido) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z
      .number({ error: (issue) => (issue.input === undefined ? mensaje : noEsNumero) })
      .min(min, `No puede ser menor que ${min}.`),
  );

export const poblacionSchema = z.object({
  poblacionTotal: numero(1, 'Indica la población con acceso.'),
  nLideres: opcionalNumero(),
  nResto: opcionalNumero(),
  // Proporcion libre: antes solo 5% o 10%. Los valores guardados siguen siendo validos.
  pctLideresDefault: z
    .number({ error: noEsNumero })
    .min(0, 'El porcentaje va de 0 a 100.')
    .max(1, 'El porcentaje va de 0 a 100.'),
  // Opcional y sin default: un input guardado sin este campo sigue validando.
  modoSegmentos: z.enum(['porcentaje', 'lideres', 'resto', 'ambos']).optional(),
});

export const capacidadSchema = z
  .object({
    // Opcional y sin default: un input guardado sin este campo sigue
    // validando y se lee como "las seis palancas".
    palancasCotizadas: z.array(z.string()).nullable().optional(),
    anio: numero(2000, 'Indica el año a calcular.'),
    inversionAnualUSD: numero(0, 'Indica la inversión anual del cliente.'),
    poblacion: poblacionSchema,
    rotacionAnual: opcionalNumero(),
    asr6Meses: opcionalNumero(),
  })
  .refine((c) => c.rotacionAnual === null || c.rotacionAnual <= 1, {
    message: 'La rotación se expresa como proporción: 0,20 para 20%.',
    path: ['rotacionAnual'],
  })
  .refine((c) => c.asr6Meses === null || c.asr6Meses <= 1, {
    message: 'El ASR se expresa como proporción: 0,15 para 15%.',
    path: ['asr6Meses'],
  });

export const lmsInputSchema = z.object({
  cliente: z.string().trim().min(1, 'Indica el nombre del cliente.'),
  capacidad: capacidadSchema,
});

export function validarLMSInput(
  valor: unknown,
): { ok: true; input: LMSInput } | { ok: false; errores: ErrorValidacion[] } {
  const parseo = lmsInputSchema.safeParse(valor);
  if (parseo.success) return { ok: true, input: parseo.data as LMSInput };

  return {
    ok: false,
    errores: parseo.error.issues.map((issue) => ({
      campo: issue.path.join('.'),
      mensaje: issue.message,
    })),
  };
}

export function inputPorDefecto(anio: number): LMSInput {
  return {
    cliente: '',
    capacidad: {
      anio,
      inversionAnualUSD: 0,
      poblacion: {
        poblacionTotal: 0,
        nLideres: null,
        nResto: null,
        pctLideresDefault: 0.05,
      },
      palancasCotizadas: null,
      rotacionAnual: null,
      asr6Meses: null,
    },
  };
}

/**
 * Un prospecto tipico: 300 personas, 26 lideres y US$11.900 al ano, en 2027
 * para que Modo Estudio cuente los doce meses y las cuentas se verifiquen a
 * mano. Es el ejemplo cargable y la base del golden test (US$42.600).
 */
export function casoEjemploProspecto(): LMSInput {
  return {
    cliente: 'Prospecto',
    capacidad: {
      anio: 2027,
      inversionAnualUSD: 11900,
      poblacion: {
        poblacionTotal: 300,
        nLideres: 26,
        nResto: 274,
        pctLideresDefault: 0.05,
      },
      palancasCotizadas: null,
      rotacionAnual: 0.2,
      asr6Meses: null,
    },
  };
}
