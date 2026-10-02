/**
 * Contrato del resultado de la calculadora de ROI (portado de
 * ubits-roi-calculator, solo el modo proyeccion). Nada aqui conoce las 6
 * palancas del LMS: la pantalla de resultados, los exports y el panel de
 * parametros se escriben contra estos tipos.
 *
 * Regla dura del proyecto: la UI nunca hace aritmetica. Si un numero aparece
 * en pantalla o en un export, existe como campo de ROIResultado.
 */

export type ProductId = 'lms';

/** Abierto a proposito: cada producto define sus propios ids de palanca. */
export type PalancaId = string;

export type Unidad =
  | 'usd'
  | 'usd_unitario'
  | 'usuarios'
  | 'meses'
  | 'horas'
  | 'minutos'
  | 'cursos'
  | 'ratio'
  | 'porcentaje';

// ---------------------------------------------------------------------------
// Explicaciones — "como se calcula" sale del engine, no del componente
// ---------------------------------------------------------------------------

export interface DesgloseLinea {
  etiqueta: string;
  valor: number;
  unidad: Unidad;
  /** Enlaza con el ParamSpec que origino el numero, para el tooltip y el admin. */
  paramId?: string;
}

export interface Explicacion {
  /** Formula simbolica: "nResto x precioPorUsuarioResto(P)". */
  formula: string;
  /** Texto ya renderizado: "274 usuarios x US$50,00 - precio para una poblacion de 300". */
  texto: string;
  lineas: DesgloseLinea[];
  /** Matices: "Prorrateado 6/12 meses", "Ventana del producto: jul-dic 2026". */
  notas: string[];
}

// ---------------------------------------------------------------------------
// Advertencias
// ---------------------------------------------------------------------------

export type AdvertenciaCodigo =
  | 'SUMA_SEGMENTOS_DISTINTA_POBLACION'
  | 'PRODUCTO_FUERA_DE_VENTANA'
  | 'PRORRATEO_ACCESO_ACTIVO'
  | 'SEGMENTOS_ESTIMADOS'
  | 'BASE_ACTIVOS_SUPUESTA';

export type Severidad = 'info' | 'aviso' | 'error';

export interface Advertencia {
  id: string;
  codigo: AdvertenciaCodigo;
  severidad: Severidad;
  palancaId?: PalancaId;
  /** Ruta del campo del formulario, para anclar el mensaje inline. */
  campoInput?: string;
  mensaje: string;
  /** Que se corrigio y por que. Ausente si la advertencia no corrige nada. */
  correccion?: string;
  valores?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Palancas
// ---------------------------------------------------------------------------

/** Como se aplico el periodo de contrato. Evita prorratear dos veces. */
export type FactorPeriodo = 'ninguno' | 'intrinseco' | 'periodo_acceso';

/** Metadatos sin calcular: headers de tabla, columnas de export, tabs de admin. */
export interface PalancaMeta {
  id: PalancaId;
  /** Etiqueta de presentacion ("P3"). Nunca se usa como clave de logica. */
  codigo: string;
  nombre: string;
  descripcionCorta: string;
  /** Binaria: captura el 100% de su valor instalado o US$0. */
  binaria: boolean;
  orden: number;
  paramIds: string[];
}

export interface PalancaResultado extends PalancaMeta {
  /** false cuando la palanca no entra en la cotizacion de este escenario. */
  enCotizacion: boolean;
  instalado: number;
  capturado: number;
  /** instalado - capturado, nunca negativo (el capturado va clampeado). */
  gap: number;
  /** capturado / instalado. null cuando instalado es 0. */
  aprovechamiento: number | null;
  factorPeriodo: FactorPeriodo;
  explicacionInstalado: Explicacion;
  explicacionCapturado: Explicacion;
  advertenciaIds: string[];
}

// ---------------------------------------------------------------------------
// Benchmarks — "las tres varas del mercado"
// ---------------------------------------------------------------------------

export type NivelBenchmark = 'BAJO' | 'MEDIO' | 'ALTO' | 'SIN_DATO' | 'NO_APLICA';

export interface Benchmark {
  id: string;
  nombre: string;
  /** null cuando no es calculable (division por cero, dato ausente). */
  valor: number | null;
  unidad: Unidad;
  referencia: number;
  referenciaTexto: string;
  fuenteReferencia: string;
  nivel: NivelBenchmark;
  /** Para el costo por curso: { multiplo: 7.07, texto: "~7x mas eficiente" }. */
  comparativo?: { multiplo: number; texto: string };
  explicacion: Explicacion;
}

// ---------------------------------------------------------------------------
// Parametros — autodescriptivos, para que el panel de admin sea generico
// ---------------------------------------------------------------------------

export type ParamKind =
  | 'number'
  | 'integer'
  | 'currency'
  | 'percent'
  | 'boolean'
  | 'enum'
  | 'steps'
  | 'curva'
  | 'ventana';

/** Funcion escalonada: el primer tramo cuyo `hasta` cubre el valor. */
export interface StepsValue {
  tramos: Array<{ hasta: number | null; valor: number }>;
}

/**
 * Precio unitario por cantidad comprada: anclas ordenadas de menos a mas, con
 * interpolacion lineal entre ellas y precio plano fuera del rango.
 *
 * Sustituye a la rampa de dos anclas (2.000 -> 30.000 usuarios), que era casi
 * plana justo donde estan los clientes reales: con 7.235 personas el precio
 * por lider seguia siendo US$425 de US$500, y la capacidad instalada de un
 * cliente de 2.500 lideres daba US$1,06 MM contra un contrato de US$94 mil.
 * Con varias anclas la curva puede caer rapido al principio y aplanarse
 * despues, que es como se comporta un descuento por volumen de verdad.
 */
export interface CurvaValue {
  anclas: Array<{ cantidad: number; valor: number }>;
}

/** Desde cuando existe el producto (Modo Estudio: julio de 2026). */
export interface VentanaValue {
  desde: { anio: number; mes: number };
}

export type ParamValue =
  | number
  | boolean
  | string
  | StepsValue
  | CurvaValue
  | VentanaValue;

export interface ParamSpec<T extends ParamValue = ParamValue> {
  id: string;
  palancaId: PalancaId | 'global';
  /** Encabezado bajo el que se agrupa en el panel de admin. */
  grupo: string;
  label: string;
  descripcion: string;
  kind: ParamKind;
  value: T;
  defaultValue: T;
  /** Texto libre editable: el modelo exige poder defender cada numero. */
  fuente: string;
  editable: boolean;
  unidad?: Unidad;
  min?: number;
  max?: number;
  step?: number;
  opciones?: Array<{ value: string; label: string }>;
  avanzado?: boolean;
}

export interface ParamsBundle {
  productId: ProductId;
  schemaVersion: 1;
  actualizadoEn: string;
  params: Record<string, ParamSpec>;
  /** Orden de render en el panel de admin. */
  orden: string[];
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type FuenteUsuariosActivos = 'dato_directo' | 'poblacion_x_asr';

// ---------------------------------------------------------------------------
// Modo de calculo — la lente, no un dato del cliente
// ---------------------------------------------------------------------------

/**
 * `proyeccion` se usa DURANTE la venta, cuando todavia no hay uso que medir:
 * la capacidad instalada es aritmetica sobre lo cotizado. La calculadora
 * original tambien tenia `real` (cierre del ano); en SellUP no existe.
 */
export type ModoCalculo = 'proyeccion';

export interface ProyeccionResultado {
  palancasCotizadas: PalancaId[];
  palancasExcluidas: PalancaId[];
  /** Descargo obligatorio al pie de todo entregable de proyeccion. */
  descargo: string;
}

/**
 * Inconsistencia documentada del modelo fuente: la guia dice "usuarios
 * activos: NUNCA lo estimes con un %", pero el caso SIES calculo la palanca
 * de Modo Estudio como poblacion x ASR. Se resuelve con un selector, y la UI
 * muestra siempre cuanto daria con la otra fuente.
 */
export interface FuenteActivosResuelta {
  usada: FuenteUsuariosActivos;
  baseUsada: number;
  etiquetaUsada: string;
  alternativa: FuenteUsuariosActivos;
  baseAlternativa: number | null;
  etiquetaAlternativa: string;
  /** Cuanto valdria la palanca con la otra fuente. null si no hay dato. */
  valorPalancaAlternativa: number | null;
}

export interface PeriodoResuelto {
  anio: number;
  mesInicio: number;
  mesFin: number;
  mesesContrato: number;
  /** mesesContrato / 12, para las palancas prorrateables. */
  factorAnual: number;
}

/**
 * Que significa cada campo en cada modo. El contrato importa porque en
 * proyeccion se reusa la misma forma con otro significado:
 *
 * | campo           | real                  | proyeccion                          |
 * |-----------------|-----------------------|-------------------------------------|
 * | instalado       | capacidad instalada   | valor de mercado de lo COTIZADO     |
 * | techoMultiplo   | el techo              | EL TITULAR, y el unico multiplo     |
 * | capturado       | valor ya usado        | SIEMPRE 0: no hay uso todavia       |
 * | sinCapturar     | instalado - capturado | = instalado (identidad, no "pago")  |
 * | aprovechamiento | % realmente usado     | SIEMPRE null: nada que medir        |
 * | multiploReal    | multiplo real         | SIEMPRE null: el unico es el techo  |
 *
 * Los dos null son deliberados y NO `razon(0, x)`, que devolveria 0 y se
 * renderizaria como "0,0x" el dia que alguien los pinte; `null` sale como "—".
 * En proyeccion esos cuatro campos no aparecen en ningun entregable: son
 * residuo de compartir la forma.
 */
export interface Totales {
  inversion: number;
  instalado: number;
  capturado: number;
  sinCapturar: number;
  /** capturado / instalado. null si instalado es 0. */
  aprovechamiento: number | null;
  /** capturado / inversion. null si inversion es 0. */
  multiploReal: number | null;
  /** instalado / inversion. null si inversion es 0. */
  techoMultiplo: number | null;
  poblacionTotal: number;
  poblacionCubierta: number;
  /** poblacionCubierta / poblacionTotal. null si la poblacion es 0. */
  coberturaPoblacion: number | null;
}

export interface ROIResultado<I = unknown> {
  productId: ProductId;
  productName: string;
  /** La lente con la que se calculo. Solo el engine construye esto. */
  modo: ModoCalculo;
  proyeccion: ProyeccionResultado;
  cliente: string;
  inputs: I;
  /** Trazabilidad: que supuestos produjeron estos numeros. */
  paramsSnapshot: ParamsBundle;
  periodo: PeriodoResuelto;
  palancas: PalancaResultado[];
  totales: Totales;
  benchmarks: Benchmark[];
  /** Cifras intermedias etiquetadas (segmentos, precios unitarios, meses). */
  derivados: DesgloseLinea[];
  fuenteActivos: FuenteActivosResuelta;
  /** null salvo que la valoracion se haya acotado al multiplo maximo. */
  acotacion: AcotacionValoracion | null;
  advertencias: Advertencia[];
  calculadoEn: string;
}

/**
 * Cuando el valor de lista se acoto para que el techo siga siendo defendible.
 *
 * El multiplo es lista / lo que paga el cliente, asi que un contrato muy
 * descontado puede dar 12x o 24x. La cifra es cierta y aun asi no se sostiene
 * delante de nadie, y arrastra consigo la credibilidad del resto del informe.
 */
export interface AcotacionValoracion {
  /** Lo que se multiplico cada precio unitario. Siempre < 1. */
  factor: number;
  instaladoSinAcotar: number;
  techoMaximo: number;
}

// ---------------------------------------------------------------------------
// Resultados intermedios del engine
// ---------------------------------------------------------------------------

export interface PalancaInstalada extends PalancaMeta {
  /** false cuando la palanca no entra en la cotizacion de este escenario. */
  enCotizacion: boolean;
  instalado: number;
  factorPeriodo: FactorPeriodo;
  explicacion: Explicacion;
  /** Datos intermedios reutilizables (precio unitario, contrataciones, etc). */
  contexto: Record<string, number>;
}

export interface CapacidadInstaladaResultado {
  palancas: PalancaInstalada[];
  total: number;
  periodo: PeriodoResuelto;
  fuenteActivos: FuenteActivosResuelta;
  advertencias: Advertencia[];
}

// ---------------------------------------------------------------------------
// El contrato del motor
// ---------------------------------------------------------------------------

export interface ProductROIEngine<I = unknown> {
  readonly productId: ProductId;
  readonly productName: string;

  getPalancas(): readonly PalancaMeta[];
  getParams(): ParamsBundle;
  getInputDefaults(): I;
  /** Valida y normaliza. La UI no implementa reglas de negocio. */
  validarInput(valor: unknown): { ok: true; input: I } | { ok: false; errores: ErrorValidacion[] };

  calcularCapacidadInstalada(input: I): CapacidadInstaladaResultado;

  /** Orquestador: instalada -> acotacion -> varas de referencia. */
  calcular(input: I): ROIResultado<I>;
}

export interface ErrorValidacion {
  campo: string;
  mensaje: string;
}

export interface OpcionesEngine {
  params?: ParamsBundle;
  /** Inyectable para que `calculadoEn` no vuelva los tests no deterministas. */
  now?: () => Date;
}
