/**
 * Todos los supuestos del Modulo de Aprendizaje, en un solo lugar y con su
 * fuente. El panel de admin los renderiza de forma generica a partir de
 * `kind`, asi que agregar un supuesto aqui lo hace editable sin tocar la UI.
 *
 * El campo `fuente` es texto libre y editable a proposito: el modelo exige
 * poder defender cada numero frente al cliente.
 */

import { crearBundle } from '../params-core';
import type { CurvaValue, ParamSpec, ParamsBundle, StepsValue, VentanaValue } from '../types';
import { PALANCA_IDS } from './types';

export const PARAM_IDS = {
  escaleraLMS: 'p1.escalera',
  precioLider: 'p2.precioLider',
  precioResto: 'p3.precioResto',
  rotacionAnual: 'p4.rotacionAnual',
  horasAhorradas: 'p4.horasAhorradasPorContratacion',
  costoHoraRH: 'p4.costoHoraRH',
  costoModoEstudio: 'p5.costoMensualPorUsuario',
  ventanaModoEstudio: 'p5.ventanaProducto',
  pisoAssessments: 'p6.pisoPlano',
  prorratearAcceso: 'global.prorratearPalancasDeAcceso',
  techoMaximo: 'global.techoMaximo',
  minutosReferencia: 'bench.minutosReferencia',
  minutosUmbralBajo: 'bench.minutosUmbralBajo',
  minutosUmbralAlto: 'bench.minutosUmbralAlto',
  asrUmbralBajo: 'bench.asrUmbralBajo',
  asrUmbralAlto: 'bench.asrUmbralAlto',
  costoCursoMercado: 'bench.costoCursoMercado',
  asrEsperado: 'proy.asrEsperado',
} as const;

export const ESCALERA_LMS_DEFAULT: StepsValue = {
  tramos: [
    { hasta: 250, valor: 6000 },
    { hasta: 1000, valor: 8000 },
    { hasta: 2500, valor: 10000 },
    { hasta: 10000, valor: 12500 },
    { hasta: null, valor: 15000 },
  ],
};

/**
 * Precio por lider segun CUANTOS lideres lleva, no segun el tamano de la
 * empresa. Cae rapido en los primeros miles de asientos y se aplana despues,
 * que es como se comporta un descuento por volumen de verdad.
 *
 * Calibrado contra dos casos reales: un cliente de 300 personas con 26 lideres
 * sigue exactamente donde estaba (US$500), y uno de 7.235 con 2.500 lideres
 * pasa de US$1,06 MM de capacidad instalada a US$200 mil. Su techo cae de
 * 14,5x a 4,2x, que es una cifra que se puede defender delante del cliente.
 */
export const PRECIO_LIDER_DEFAULT: CurvaValue = {
  anclas: [
    { cantidad: 100, valor: 500 },
    { cantidad: 250, valor: 380 },
    { cantidad: 500, valor: 280 },
    { cantidad: 1000, valor: 180 },
    { cantidad: 2500, valor: 80 },
    { cantidad: 10000, valor: 50 },
    { cantidad: 30000, valor: 35 },
  ],
};

/** Misma mecanica para el resto de la poblacion, con sus propias anclas. */
export const PRECIO_RESTO_DEFAULT: CurvaValue = {
  anclas: [
    { cantidad: 500, valor: 50 },
    { cantidad: 1000, valor: 40 },
    { cantidad: 2500, valor: 27 },
    { cantidad: 5000, valor: 19 },
    { cantidad: 10000, valor: 13 },
    { cantidad: 30000, valor: 8 },
  ],
};

/**
 * El Tutor IA era la unica palanca por asiento sin descuento por volumen: US$5
 * planos por usuario activo al mes. Para un cliente de 8.000 personas eso son
 * US$60 mil en medio ano, el 14% de su capacidad instalada.
 *
 * El ancla de 200 a US$5 deja intacto al cliente pequeno: con 74,6 activos, el
 * caso SIES sigue exactamente donde estaba.
 */
export const COSTO_MODO_ESTUDIO_DEFAULT: CurvaValue = {
  anclas: [
    { cantidad: 200, valor: 5 },
    { cantidad: 1000, valor: 4 },
    { cantidad: 5000, valor: 3 },
    { cantidad: 15000, valor: 2.5 },
  ],
};

export const VENTANA_MODO_ESTUDIO_DEFAULT: VentanaValue = { desde: { anio: 2026, mes: 7 } };

const GRUPOS = {
  p1: 'Palanca 1 · LMS incluido',
  p2: 'Palanca 2 · Catálogo para líderes',
  p3: 'Palanca 3 · Catálogo por rol',
  p4: 'Palanca 4 · Onboarding estructurado',
  p5: 'Palanca 5 · Modo Estudio (Tutor IA)',
  p6: 'Palanca 6 · Assessments',
  calculo: 'Reglas de cálculo',
  varas: 'Las tres varas del mercado',
  proyeccion: 'Proyección de venta',
} as const;

const spec = <T extends ParamSpec['value']>(s: ParamSpec<T>): ParamSpec => s as ParamSpec;

const SPECS: ParamSpec[] = [
  spec<StepsValue>({
    id: PARAM_IDS.escaleraLMS,
    palancaId: PALANCA_IDS.lms,
    grupo: GRUPOS.p1,
    label: 'Tramos de valor del LMS por población',
    descripcion:
      'Función escalonada: cada tramo de población tiene un valor plano. No se interpola entre tramos.',
    kind: 'steps',
    value: ESCALERA_LMS_DEFAULT,
    defaultValue: ESCALERA_LMS_DEFAULT,
    fuente: 'Modelo de valor UBITS — valor de mercado de un LMS corporativo por tamaño de población.',
    editable: true,
    unidad: 'usd',
  }),
  spec<CurvaValue>({
    id: PARAM_IDS.precioLider,
    palancaId: PALANCA_IDS.catalogoLideres,
    grupo: GRUPOS.p2,
    label: 'Precio por líder según cuántos líderes',
    descripcion:
      'Descuento por volumen sobre la cantidad de líderes que lleva el cliente, no sobre el tamaño de la empresa. El precio se interpola entre anclas, así que dos clientes parecidos nunca reciben cifras muy distintas.',
    kind: 'curva',
    value: PRECIO_LIDER_DEFAULT,
    defaultValue: PRECIO_LIDER_DEFAULT,
    fuente:
      'Modelo de valor UBITS — precio de catálogo de liderazgo con descuento por volumen de asientos.',
    editable: true,
    unidad: 'usd_unitario',
  }),
  spec<CurvaValue>({
    id: PARAM_IDS.precioResto,
    palancaId: PALANCA_IDS.catalogoPorRol,
    grupo: GRUPOS.p3,
    label: 'Precio por usuario según cuántos usuarios del resto',
    descripcion:
      'Misma mecánica que el precio por líder, con anclas propias. Es el precio que antes se aplicaba a criterio del CS.',
    kind: 'curva',
    value: PRECIO_RESTO_DEFAULT,
    defaultValue: PRECIO_RESTO_DEFAULT,
    fuente:
      'Modelo de valor UBITS — precio de catálogo por rol con descuento por volumen de asientos.',
    editable: true,
    unidad: 'usd_unitario',
  }),
  spec<number>({
    id: PARAM_IDS.rotacionAnual,
    palancaId: PALANCA_IDS.onboarding,
    grupo: GRUPOS.p4,
    label: 'Rotación anual por defecto',
    descripcion:
      'Solo se usa cuando el cliente no reporta el número real de contrataciones del año.',
    kind: 'percent',
    value: 0.2,
    defaultValue: 0.2,
    fuente: 'Supuesto UBITS — rotación anual promedio observada en clientes corporativos de LatAm.',
    editable: true,
    unidad: 'porcentaje',
    min: 0,
    max: 1,
    step: 0.01,
  }),
  spec<number>({
    id: PARAM_IDS.horasAhorradas,
    palancaId: PALANCA_IDS.onboarding,
    grupo: GRUPOS.p4,
    label: 'Horas de RH ahorradas por contratación',
    descripcion: 'Horas que el equipo de RH deja de invertir por cada ingreso con onboarding estructurado.',
    kind: 'number',
    value: 2,
    defaultValue: 2,
    fuente: 'Supuesto UBITS — tiempo de inducción manual sustituido por el onboarding en plataforma.',
    editable: true,
    unidad: 'horas',
    min: 0,
    step: 0.5,
  }),
  spec<number>({
    id: PARAM_IDS.costoHoraRH,
    palancaId: PALANCA_IDS.onboarding,
    grupo: GRUPOS.p4,
    label: 'Costo de la hora de RH',
    descripcion: 'Costo cargado de una hora del equipo de Recursos Humanos.',
    kind: 'currency',
    value: 10,
    defaultValue: 10,
    fuente: 'Supuesto UBITS — costo hora de un analista de RH en LatAm.',
    editable: true,
    unidad: 'usd_unitario',
    min: 0,
  }),
  spec<CurvaValue>({
    id: PARAM_IDS.costoModoEstudio,
    palancaId: PALANCA_IDS.modoEstudio,
    grupo: GRUPOS.p5,
    label: 'Costo mensual por usuario activo según cuántos activos',
    descripcion:
      'Valor de mercado de un tutor de IA por usuario activo al mes, con descuento por volumen sobre la cantidad de activos. Era la única palanca por asiento que seguía a precio plano.',
    kind: 'curva',
    value: COSTO_MODO_ESTUDIO_DEFAULT,
    defaultValue: COSTO_MODO_ESTUDIO_DEFAULT,
    fuente: 'Precio de referencia de mercado de un asistente de estudio con IA, por usuario/mes.',
    editable: true,
    unidad: 'usd_unitario',
  }),
  spec<VentanaValue>({
    id: PARAM_IDS.ventanaModoEstudio,
    palancaId: PALANCA_IDS.modoEstudio,
    grupo: GRUPOS.p5,
    label: 'Disponible desde',
    descripcion:
      'Antes de esta fecha el producto no existía, así que no genera valor instalado por más que el contrato cubra esos meses.',
    kind: 'ventana',
    value: VENTANA_MODO_ESTUDIO_DEFAULT,
    defaultValue: VENTANA_MODO_ESTUDIO_DEFAULT,
    fuente: 'Fecha de lanzamiento de Modo Estudio: julio de 2026.',
    editable: true,
  }),
  spec<number>({
    id: PARAM_IDS.pisoAssessments,
    palancaId: PALANCA_IDS.assessments,
    grupo: GRUPOS.p6,
    label: 'Piso plano de Assessments',
    descripcion: 'No escala con el headcount: es el mismo valor para toda la población.',
    kind: 'currency',
    value: 4000,
    defaultValue: 4000,
    fuente: 'Valor de mercado de un proceso de assessments corporativo, piso conservador.',
    editable: true,
    unidad: 'usd',
    min: 0,
  }),
  spec<boolean>({
    id: PARAM_IDS.prorratearAcceso,
    palancaId: 'global',
    grupo: GRUPOS.calculo,
    label: 'Prorratear también las palancas de acceso',
    descripcion:
      'Las palancas 1, 2, 3 y 6 son derechos de acceso anuales y por defecto no se prorratean. Al activarlo se multiplican por meses de contrato ÷ 12. Onboarding y Modo Estudio ya se prorratean siempre.',
    kind: 'boolean',
    value: false,
    defaultValue: false,
    fuente: 'Decisión de modelo: el derecho de acceso se devenga completo al firmar.',
    editable: true,
  }),
  spec<number>({
    id: PARAM_IDS.techoMaximo,
    palancaId: 'global',
    grupo: GRUPOS.calculo,
    label: 'Múltiplo máximo defendible del techo',
    descripcion:
      'Cuando el valor de mercado supera este múltiplo de la inversión, se valora la capacidad hasta ese tope y se dice en el reporte. Un cliente con mucho descuento puede dar 12x o 24x: la cifra es cierta y aun así nadie se la cree. En 0 se desactiva y la valoración sale a precio de lista puro.',
    kind: 'number',
    value: 6,
    defaultValue: 6,
    fuente:
      'Decisión comercial: por encima de 6x el múltiplo deja de sostenerse delante del cliente.',
    editable: true,
    min: 0,
    step: 0.5,
  }),
  spec<number>({
    id: PARAM_IDS.minutosReferencia,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'Minutos de e-learning por persona/mes — referencia',
    descripcion: 'Promedio de la industria contra el que se compara al cliente.',
    kind: 'number',
    value: 21,
    defaultValue: 21,
    fuente: 'ATD State of the Industry 2026.',
    editable: true,
    unidad: 'minutos',
    min: 0,
  }),
  spec<number>({
    id: PARAM_IDS.minutosUmbralBajo,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'Minutos — umbral de BAJO',
    descripcion: 'Por debajo de este valor el cliente queda en BAJO y primero va plan de adopción.',
    kind: 'number',
    value: 10,
    defaultValue: 10,
    fuente: 'Regla del deck de entrenamiento de CS.',
    editable: true,
    unidad: 'minutos',
    min: 0,
  }),
  spec<number>({
    id: PARAM_IDS.minutosUmbralAlto,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'Minutos — umbral de ALTO',
    descripcion: 'Por encima de este valor el cliente está sobre la vara del mercado.',
    kind: 'number',
    value: 25,
    defaultValue: 25,
    fuente: 'Regla del deck de entrenamiento de CS.',
    editable: true,
    unidad: 'minutos',
    min: 0,
  }),
  spec<number>({
    id: PARAM_IDS.asrUmbralBajo,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'ASR mensual — umbral de BAJO',
    descripcion: 'Active Student Rate promedio de los últimos 6 meses.',
    kind: 'percent',
    value: 0.1,
    defaultValue: 0.1,
    fuente: 'Rango medio de ASR mensual observado en la base de clientes UBITS.',
    editable: true,
    unidad: 'porcentaje',
    min: 0,
    max: 1,
    step: 0.01,
  }),
  spec<number>({
    id: PARAM_IDS.asrUmbralAlto,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'ASR mensual — umbral de ALTO',
    descripcion: 'Por encima de este valor el ritmo de uso está sobre el rango medio del mercado.',
    kind: 'percent',
    value: 0.2,
    defaultValue: 0.2,
    fuente: 'Rango medio de ASR mensual observado en la base de clientes UBITS.',
    editable: true,
    unidad: 'porcentaje',
    min: 0,
    max: 1,
    step: 0.01,
  }),
  spec<number>({
    id: PARAM_IDS.costoCursoMercado,
    palancaId: 'global',
    grupo: GRUPOS.varas,
    label: 'Costo de un curso suelto en mercado abierto',
    descripcion: 'Referencia contra la que se compara el costo por curso completado del cliente.',
    kind: 'currency',
    value: 15,
    defaultValue: 15,
    fuente: 'Precio de un curso suelto en marketplaces de e-learning abiertos.',
    editable: true,
    unidad: 'usd_unitario',
    min: 0,
  }),
  spec<number>({
    id: PARAM_IDS.asrEsperado,
    palancaId: 'global',
    grupo: GRUPOS.proyeccion,
    label: 'ASR mensual esperado para la proyección',
    descripcion:
      'Proporción de la población que se espera que estudie cada mes. Alimenta la base de Modo Estudio cuando el prospecto todavía no tiene datos propios.',
    kind: 'percent',
    value: 0.15,
    defaultValue: 0.15,
    fuente:
      'Supuesto UBITS — punto medio del rango de ASR mensual del propio benchmark de esta calculadora (10%–20%), para que el supuesto salga de la misma vara que se le enseña al prospecto.',
    editable: true,
    unidad: 'porcentaje',
    min: 0,
    max: 1,
    step: 0.01,
  }),
];

export function crearParamsLMS(now?: () => Date): ParamsBundle {
  return crearBundle('lms', SPECS.map((s) => ({ ...s })), now);
}
