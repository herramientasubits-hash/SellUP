/**
 * Motor de calculo del Modulo de Aprendizaje — solo PROYECCION.
 *
 * Portado de la calculadora de ROI de UBITS (ubits-roi-calculator). Alli el
 * motor tenia dos modos: `real` (mide el uso al cierre del ano) y
 * `proyeccion` (lo que se ensena durante la venta). SellUP solo usa el
 * segundo, asi que el camino real —valor capturado, clamps, gaps, NPS— no
 * existe aqui.
 *
 * Orden de redondeo (el golden test del prospecto depende de el):
 *  1. Los precios unitarios se redondean a 2 decimales al salir de pricing.
 *  2. Las contrataciones derivadas se redondean a entero ANTES de multiplicar.
 *  3. La base de usuarios activos NO se redondea: 300 x 0,2487 = 74,61 entra
 *     cruda al producto. Redondearla daria 2.250 o 2.220 en vez de 2.238.
 *  4. El prorrateo se aplica ANTES de redondear el valor de la palanca.
 *  5. Cada palanca se redondea a USD entero una sola vez, al final.
 *  6. Los totales suman palancas ya redondeadas.
 *  7. Las razones (aprovechamiento, multiplos, costo por curso) no se redondean
 *     aqui: se redondean solo al formatear.
 */

import { fmtDecimal1, fmtEntero, fmtUSD, fmtUSD2, rangoMeses, roundUSD } from '../../lib/format';
import { booleanoParam, curvaParam, numeroParam, stepsParam, ventanaParam } from '../params-core';
import type {
  Advertencia,
  Benchmark,
  CapacidadInstaladaResultado,
  DesgloseLinea,
  Explicacion,
  FactorPeriodo,
  FuenteActivosResuelta,
  FuenteUsuariosActivos,
  OpcionesEngine,
  PalancaInstalada,
  PalancaMeta,
  PalancaResultado,
  AcotacionValoracion,
  ParamsBundle,
  ProductROIEngine,
  ROIResultado,
  Totales,
} from '../types';
import { mesesAplicables, resolverPeriodo } from './calendario';
import {
  ESCALERA_LMS_DEFAULT,
  PARAM_IDS,
  COSTO_MODO_ESTUDIO_DEFAULT,
  PRECIO_LIDER_DEFAULT,
  PRECIO_RESTO_DEFAULT,
  VENTANA_MODO_ESTUDIO_DEFAULT,
  crearParamsLMS,
} from './params';
import { resolverPrecio, tramoActivo, valorEnCurva, valorEscalonado } from './pricing';
import { inputPorDefecto, validarLMSInput } from './schema';
import { ETIQUETA, PALANCA_IDS } from './types';
import type { LMSInput } from './types';

// ---------------------------------------------------------------------------
// Metadatos de las 6 palancas
// ---------------------------------------------------------------------------

const PALANCAS: readonly PalancaMeta[] = [
  {
    id: PALANCA_IDS.lms,
    codigo: 'P1',
    nombre: 'LMS incluido',
    descripcionCorta: 'Derecho de acceso a la plataforma, por tramo de población.',
    binaria: true,
    orden: 1,
    paramIds: [PARAM_IDS.escaleraLMS],
  },
  {
    id: PALANCA_IDS.catalogoLideres,
    codigo: 'P2',
    nombre: 'Catálogo para líderes',
    descripcionCorta: 'Formación de liderazgo disponible para cada líder.',
    binaria: false,
    orden: 2,
    paramIds: [PARAM_IDS.precioLider],
  },
  {
    id: PALANCA_IDS.catalogoPorRol,
    codigo: 'P3',
    nombre: 'Catálogo por rol',
    descripcionCorta: 'Catálogo por rol disponible para el resto de la población.',
    binaria: false,
    orden: 3,
    paramIds: [PARAM_IDS.precioResto],
  },
  {
    id: PALANCA_IDS.onboarding,
    codigo: 'P4',
    nombre: 'Onboarding estructurado',
    descripcionCorta: 'Horas de RH que se ahorran en cada contratación del año.',
    binaria: true,
    orden: 4,
    paramIds: [PARAM_IDS.rotacionAnual, PARAM_IDS.horasAhorradas, PARAM_IDS.costoHoraRH],
  },
  {
    id: PALANCA_IDS.modoEstudio,
    codigo: 'P5',
    nombre: 'Modo Estudio (Tutor IA)',
    descripcionCorta: 'Tutor de IA por usuario activo al mes.',
    binaria: false,
    orden: 5,
    paramIds: [PARAM_IDS.costoModoEstudio, PARAM_IDS.ventanaModoEstudio, PARAM_IDS.asrEsperado],
  },
  {
    id: PALANCA_IDS.assessments,
    codigo: 'P6',
    nombre: 'Assessments',
    descripcionCorta: 'Piso plano de valor, no escala con el headcount.',
    binaria: true,
    orden: 6,
    paramIds: [PARAM_IDS.pisoAssessments],
  },
] as const;

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

const meta = (id: string): PalancaMeta => {
  const m = PALANCAS.find((p) => p.id === id);
  if (!m) throw new Error(`Palanca desconocida: ${id}`);
  return m;
};

const linea = (
  etiqueta: string,
  valor: number,
  unidad: DesgloseLinea['unidad'],
  paramId?: string,
): DesgloseLinea => (paramId ? { etiqueta, valor, unidad, paramId } : { etiqueta, valor, unidad });

const explicacion = (
  formula: string,
  texto: string,
  lineas: DesgloseLinea[],
  notas: string[] = [],
): Explicacion => ({ formula, texto, lineas, notas });

const vacia = (texto: string): Explicacion => explicacion('—', texto, [], []);

/** Va al pie de todo entregable de proyeccion. */
const DESCARGO_PROYECCION =
  'Esta es una proyección: las cifras salen de lo que estás cotizando y de los precios de mercado de UBITS. ' +
  'No es una medición de uso ni una garantía de resultado.';

/** Razon segura: null en vez de Infinity o NaN. */
const razon = (numerador: number, denominador: number): number | null =>
  denominador === 0 || !Number.isFinite(denominador) ? null : numerador / denominador;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function crearEngineLMS(opciones: OpcionesEngine = {}): ProductROIEngine<LMSInput> {
  const now = opciones.now ?? (() => new Date());
  const params: ParamsBundle = opciones.params ?? crearParamsLMS(now);

  // --- lectura de supuestos -------------------------------------------------
  const escalera = () => stepsParam(params, PARAM_IDS.escaleraLMS, ESCALERA_LMS_DEFAULT);
  const curvaLider = () => curvaParam(params, PARAM_IDS.precioLider, PRECIO_LIDER_DEFAULT);
  const curvaResto = () => curvaParam(params, PARAM_IDS.precioResto, PRECIO_RESTO_DEFAULT);
  const rotacionDefault = () => numeroParam(params, PARAM_IDS.rotacionAnual, 0.2);
  const horasAhorradas = () => numeroParam(params, PARAM_IDS.horasAhorradas, 2);
  const costoHoraRH = () => numeroParam(params, PARAM_IDS.costoHoraRH, 10);
  const curvaModoEstudio = () =>
    curvaParam(params, PARAM_IDS.costoModoEstudio, COSTO_MODO_ESTUDIO_DEFAULT);
  const ventana = () => ventanaParam(params, PARAM_IDS.ventanaModoEstudio, VENTANA_MODO_ESTUDIO_DEFAULT);
  const pisoAssessments = () => numeroParam(params, PARAM_IDS.pisoAssessments, 4000);
  const prorratearAcceso = () => booleanoParam(params, PARAM_IDS.prorratearAcceso, false);
  const asrEsperado = () => numeroParam(params, PARAM_IDS.asrEsperado, 0.15);

  /** Líderes y resto: declarados, o derivados del porcentaje por defecto. */
  function resolverSegmentos(input: LMSInput) {
    const { poblacionTotal, nLideres, nResto, pctLideresDefault } = input.capacidad.poblacion;
    const lideresEstimados = nLideres === null;
    const lideres = nLideres ?? Math.round(poblacionTotal * pctLideresDefault);
    const restoEstimado = nResto === null;
    const resto = nResto ?? Math.max(0, poblacionTotal - lideres);
    return { lideres, resto, lideresEstimados, restoEstimado, pctLideresDefault };
  }

  // -------------------------------------------------------------------------
  // 4.1 Capacidad instalada
  // -------------------------------------------------------------------------

  /**
   * @param factorValoracion escala TODOS los precios unitarios. Lo usa la
   * acotacion del techo: recalcular con precios escalados —en vez de recortar
   * el total al final— deja las cuentas de las explicaciones verdaderas, que
   * es lo que el cliente lee ("274 x US$31 = US$8.500").
   */
  function calcularCapacidadInstalada(
    input: LMSInput,
    factorValoracion = 1,
  ): CapacidadInstaladaResultado {
    const { capacidad } = input;
    const P = capacidad.poblacion.poblacionTotal;
    // En proyeccion el periodo es siempre el ano completo. Un prospecto no
    // tiene corte de anualidad que mostrar, y el modelo no sabe expresar "de
    // abril a abril": los meses son de un ano calendario.
    const periodo = resolverPeriodo(capacidad.anio, 1, 12);
    const advertencias: Advertencia[] = [];
    const segmentos = resolverSegmentos(input);

    // Las palancas de acceso solo se prorratean si el admin lo pide.
    const prorratea = prorratearAcceso();
    const factorAcceso = prorratea ? periodo.factorAnual : 1;
    const factorPeriodoAcceso: FactorPeriodo = prorratea ? 'periodo_acceso' : 'ninguno';
    const notaAcceso = prorratea
      ? [`Prorrateado a ${periodo.mesesContrato} de 12 meses de contrato.`]
      : [];

    if (prorratea) {
      advertencias.push({
        id: 'PRORRATEO_ACCESO_ACTIVO:global',
        codigo: 'PRORRATEO_ACCESO_ACTIVO',
        severidad: 'info',
        mensaje: `Cálculo prorrateado a ${periodo.mesesContrato} meses de contrato.`,
        correccion:
          'Las palancas de acceso (LMS, catálogos y Assessments) se multiplicaron por meses de contrato ÷ 12.',
        valores: { mesesContrato: periodo.mesesContrato },
      });
    }

    if (segmentos.lideresEstimados || segmentos.restoEstimado) {
      advertencias.push({
        id: 'SEGMENTOS_ESTIMADOS:global',
        codigo: 'SEGMENTOS_ESTIMADOS',
        severidad: 'info',
        campoInput: 'capacidad.poblacion.nLideres',
        mensaje: segmentos.lideresEstimados
          ? `No se declaró el número de líderes: se estimó en ${fmtEntero(segmentos.lideres)} (${Math.round(segmentos.pctLideresDefault * 100)}% de la población).`
          : `No se declaró el resto de población: se tomó como población total menos líderes (${fmtEntero(segmentos.resto)}).`,
        valores: { lideres: segmentos.lideres, resto: segmentos.resto },
      });
    }

    if (segmentos.lideres + segmentos.resto !== P) {
      advertencias.push({
        id: 'SUMA_SEGMENTOS_DISTINTA_POBLACION:global',
        codigo: 'SUMA_SEGMENTOS_DISTINTA_POBLACION',
        severidad: 'aviso',
        campoInput: 'capacidad.poblacion.nResto',
        mensaje: `Líderes (${fmtEntero(segmentos.lideres)}) más resto (${fmtEntero(segmentos.resto)}) suman ${fmtEntero(segmentos.lideres + segmentos.resto)}, y la población declarada es ${fmtEntero(P)}.`,
        correccion:
          'No se corrigió ningún número: el cálculo respeta los segmentos declarados. Revisa el dato si la diferencia no es intencional.',
        valores: { lideres: segmentos.lideres, resto: segmentos.resto, poblacion: P },
      });
    }

    // --- P1 · LMS incluido --------------------------------------------------
    const tramo = tramoActivo(escalera(), P);
    const valorLMSBase = valorEscalonado(escalera(), P) * factorValoracion;
    const palancaLMS: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.lms),
      instalado: roundUSD(valorLMSBase * factorAcceso),
      factorPeriodo: factorPeriodoAcceso,
      explicacion: explicacion(
        'tramo(P)',
        `Población de ${fmtEntero(P)} — tramo ${fmtEntero(tramo.desde)}${tramo.hasta === null ? ' o más' : ` a ${fmtEntero(tramo.hasta)}`}: ${fmtUSD(valorLMSBase)}`,
        [
          linea(ETIQUETA.poblacionTotal, P, 'usuarios'),
          linea(ETIQUETA.valorTramo, valorLMSBase, 'usd', PARAM_IDS.escaleraLMS),
          // Los bordes del tramo solo existian dentro del texto renderizado, y
          // los exports no pueden parsear una frase para explicarla.
          linea(ETIQUETA.tramoDesde, tramo.desde, 'usuarios', PARAM_IDS.escaleraLMS),
          ...(tramo.hasta === null
            ? []
            : [linea(ETIQUETA.tramoHasta, tramo.hasta, 'usuarios', PARAM_IDS.escaleraLMS)]),
        ],
        notaAcceso,
      ),
      contexto: { valorBase: valorLMSBase },
    };

    // --- P2 · Catálogo para líderes ----------------------------------------
    // El descuento por volumen va sobre los asientos de liderazgo que lleva,
    // no sobre el tamano de la empresa: quien compra 2.500 catalogos de
    // liderazgo no paga el precio de un cliente mediano por cada uno.
    const precioLiderLista = resolverPrecio(curvaLider(), segmentos.lideres);
    const precioLider = { ...precioLiderLista, precio: precioLiderLista.precio * factorValoracion };
    const palancaLideres: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.catalogoLideres),
      instalado: roundUSD(segmentos.lideres * precioLider.precio * factorAcceso),
      factorPeriodo: factorPeriodoAcceso,
      explicacion: explicacion(
        'nLíderes × precioPorLíder(nLíderes)',
        `${fmtEntero(segmentos.lideres)} líderes × ${fmtUSD2(precioLider.precio)} — ${precioLider.nota}`,
        [
          linea(ETIQUETA.lideres, segmentos.lideres, 'usuarios'),
          linea(ETIQUETA.precioLider, precioLider.precio, 'usd_unitario', PARAM_IDS.precioLider),
        ],
        notaAcceso,
      ),
      contexto: { precioUnitario: precioLider.precio, segmento: segmentos.lideres },
    };

    // --- P3 · Catálogo por rol ---------------------------------------------
    const precioRestoLista = resolverPrecio(curvaResto(), segmentos.resto);
    const precioResto = { ...precioRestoLista, precio: precioRestoLista.precio * factorValoracion };
    const palancaResto: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.catalogoPorRol),
      instalado: roundUSD(segmentos.resto * precioResto.precio * factorAcceso),
      factorPeriodo: factorPeriodoAcceso,
      explicacion: explicacion(
        'nResto × precioPorUsuarioResto(nResto)',
        `${fmtEntero(segmentos.resto)} usuarios × ${fmtUSD2(precioResto.precio)} — ${precioResto.nota}`,
        [
          linea(ETIQUETA.usuariosResto, segmentos.resto, 'usuarios'),
          linea(ETIQUETA.precioUsuario, precioResto.precio, 'usd_unitario', PARAM_IDS.precioResto),
        ],
        notaAcceso,
      ),
      contexto: { precioUnitario: precioResto.precio, segmento: segmentos.resto },
    };

    // --- P4 · Onboarding estructurado --------------------------------------
    // Las contrataciones salen SIEMPRE de la rotacion: quien se va se
    // reemplaza, que es lo que significa rotar. Habia ademas un campo de
    // contrataciones directas, y dos entradas para el mismo numero solo
    // servian para contradecirse.
    const rotacion = capacidad.rotacionAnual ?? rotacionDefault();
    const contrataciones = Math.round(P * rotacion * periodo.factorAnual);
    const valorOnboarding = contrataciones * horasAhorradas() * costoHoraRH() * factorValoracion;

    const palancaOnboarding: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.onboarding),
      instalado: roundUSD(valorOnboarding),
      factorPeriodo: 'intrinseco',
      explicacion: explicacion(
        'contrataciones × horasAhorradas × costoHoraRH',
        `${fmtEntero(contrataciones)} contrataciones × ${horasAhorradas()} h × ${fmtUSD2(costoHoraRH())}`,
        [
          linea(ETIQUETA.contrataciones, contrataciones, 'usuarios'),
          linea(ETIQUETA.horasAhorradas, horasAhorradas(), 'horas', PARAM_IDS.horasAhorradas),
          linea(ETIQUETA.costoHoraRH, costoHoraRH(), 'usd_unitario', PARAM_IDS.costoHoraRH),
        ],
        [
          `Estimadas: ${fmtEntero(P)} × ${Math.round(rotacion * 100)}% de rotación × ${periodo.mesesContrato}/12 meses.`,
        ],
      ),
      contexto: { contrataciones, valorUnitario: horasAhorradas() * costoHoraRH() },
    };

    // --- P5 · Modo Estudio --------------------------------------------------
    const aplicables = mesesAplicables(periodo, ventana());
    // Un prospecto no tiene conteo directo de activos: la base es siempre
    // poblacion x ASR.
    const fuenteElegida: FuenteUsuariosActivos = 'poblacion_x_asr';

    const baseDirecta: number | null = null;
    // En venta el prospecto no tiene ASR propio: en vez de colapsar la palanca
    // a US$0 se cae a un supuesto, que es el punto medio del mismo benchmark
    // que el reporte le ensena.
    const asrProyectado = capacidad.asr6Meses === null ? asrEsperado() : null;
    const asrEfectivo = capacidad.asr6Meses ?? asrProyectado;
    const baseASR = asrEfectivo === null ? null : P * asrEfectivo;
    const baseUsada = baseASR ?? 0;

    if (asrProyectado !== null) {
      advertencias.push({
        id: 'base_activos_supuesta',
        codigo: 'BASE_ACTIVOS_SUPUESTA',
        severidad: 'info',
        palancaId: PALANCA_IDS.modoEstudio,
        campoInput: 'capacidad.asr6Meses',
        mensaje: `No hay ASR propio: Modo Estudio se calculó con un ${fmtDecimal1(asrProyectado * 100)}% esperado sobre ${fmtEntero(P)} personas.`,
        correccion: 'Es el punto medio del rango de mercado de esta calculadora. Cámbialo si tienes una expectativa distinta.',
        valores: { asrEsperado: asrProyectado, base: baseASR ?? 0 },
      });
    }
    const baseAlternativa = baseDirecta;

    const etiqueta = (f: FuenteUsuariosActivos) =>
      f === 'poblacion_x_asr' ? 'Población × ASR promedio' : 'Dato directo de usuarios activos';

    // El precio por activo tambien baja con el volumen: era la unica palanca
    // por asiento a precio plano.
    const precioActivoLista = resolverPrecio(curvaModoEstudio(), baseUsada);
    const precioActivo = {
      ...precioActivoLista,
      precio: precioActivoLista.precio * factorValoracion,
    };
    const valorModoEstudio = baseUsada * precioActivo.precio * aplicables.meses;
    const fuenteActivos: FuenteActivosResuelta = {
      usada: fuenteElegida,
      baseUsada,
      etiquetaUsada: etiqueta(fuenteElegida),
      alternativa: 'dato_directo',
      baseAlternativa,
      etiquetaAlternativa: etiqueta('dato_directo'),
      valorPalancaAlternativa:
        baseAlternativa === null
          ? null
          : roundUSD(
              baseAlternativa *
                valorEnCurva(curvaModoEstudio(), baseAlternativa) *
                factorValoracion *
                aplicables.meses,
            ),
    };

    if (aplicables.fueraDeVentana) {
      advertencias.push({
        id: `PRODUCTO_FUERA_DE_VENTANA:${PALANCA_IDS.modoEstudio}`,
        codigo: 'PRODUCTO_FUERA_DE_VENTANA',
        severidad: 'info',
        palancaId: PALANCA_IDS.modoEstudio,
        mensaje: `Modo Estudio existe desde ${ventana().desde.mes}/${ventana().desde.anio}, así que no genera valor instalado en este periodo.`,
        valores: { anio: periodo.anio },
      });
    }

    const palancaModoEstudio: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.modoEstudio),
      instalado: roundUSD(valorModoEstudio),
      factorPeriodo: 'intrinseco',
      explicacion: explicacion(
        'usuariosActivosBase × costoMensual × mesesAplicables',
        `${fmtDecimal1(baseUsada)} usuarios × ${fmtUSD2(precioActivo.precio)} × ${aplicables.meses} meses — ${precioActivo.nota}`,
        [
          linea(ETIQUETA.baseActivos, baseUsada, 'usuarios', PARAM_IDS.asrEsperado),
          linea(ETIQUETA.costoMensual, precioActivo.precio, 'usd_unitario', PARAM_IDS.costoModoEstudio),
          linea(ETIQUETA.mesesAplicables, aplicables.meses, 'meses', PARAM_IDS.ventanaModoEstudio),
        ],
        [
          `Base: ${etiqueta(fuenteElegida)}.`,
          aplicables.fueraDeVentana
            ? 'El producto no existía en ningún mes del contrato.'
            : `Ventana aplicable: ${rangoMeses(aplicables.desde ?? 1, aplicables.hasta ?? 12, periodo.anio)}.`,
        ],
      ),
      contexto: { mesesAplicables: aplicables.meses, costoMensual: precioActivo.precio },
    };

    // --- P6 · Assessments ---------------------------------------------------
    const piso = pisoAssessments() * factorValoracion;
    const palancaAssessments: PalancaInstalada = {
      enCotizacion: true,
      ...meta(PALANCA_IDS.assessments),
      instalado: roundUSD(piso * factorAcceso),
      factorPeriodo: factorPeriodoAcceso,
      explicacion: explicacion(
        'pisoPlano',
        `Piso plano de ${fmtUSD(piso)} para toda la población`,
        [linea(ETIQUETA.pisoAssessments, piso, 'usd', PARAM_IDS.pisoAssessments)],
        ['No escala con el headcount.', ...notaAcceso],
      ),
      contexto: { piso },
    };

    const todas = [
      palancaLMS,
      palancaLideres,
      palancaResto,
      palancaOnboarding,
      palancaModoEstudio,
      palancaAssessments,
    ];

    // Sin cotizacion declarada este map devuelve LAS MISMAS REFERENCIAS: es la
    // identidad, y de eso depende que el golden no se mueva un dolar.
    const cotizadas = capacidad.palancasCotizadas ?? null;
    const palancas = todas.map((p) =>
      cotizadas === null || cotizadas.includes(p.id)
        ? p
        : {
            ...p,
            enCotizacion: false,
            instalado: 0,
            explicacion: vacia('No incluida en esta cotización.'),
          },
    );

    return {
      palancas,
      total: palancas.reduce((acc, p) => acc + p.instalado, 0),
      periodo,
      fuenteActivos,
      advertencias,
    };
  }

  // -------------------------------------------------------------------------
  // Las tres varas del mercado
  // -------------------------------------------------------------------------

  /**
   * En venta las varas no miden al prospecto —que no tiene uso— sino que dicen
   * contra que se le va a medir al cierre. Por eso todas salen `NO_APLICA`, sin
   * valor, y solo con el rango de referencia.
   */
  function calcularBenchmarks(): Benchmark[] {
    const minBajo = numeroParam(params, PARAM_IDS.minutosUmbralBajo, 10);
    const minAlto = numeroParam(params, PARAM_IDS.minutosUmbralAlto, 25);
    const minRef = numeroParam(params, PARAM_IDS.minutosReferencia, 21);
    const asrBajo = numeroParam(params, PARAM_IDS.asrUmbralBajo, 0.1);
    const asrAlto = numeroParam(params, PARAM_IDS.asrUmbralAlto, 0.2);
    const costoMercado = numeroParam(params, PARAM_IDS.costoCursoMercado, 15);

    const referencia = (
      id: string,
      nombre: string,
      unidad: Benchmark['unidad'],
      valorReferencia: number,
      referenciaTexto: string,
      paramFuente: string,
    ): Benchmark => ({
      id,
      nombre,
      valor: null,
      unidad,
      referencia: valorReferencia,
      // El rango que JUZGA, no el promedio que solo se cita.
      referenciaTexto,
      fuenteReferencia: params.params[paramFuente]?.fuente ?? '',
      nivel: 'NO_APLICA',
      explicacion: vacia(`Referencia de mercado: ${referenciaTexto}. Aquí se medirá al cierre.`),
    });

    return [
      referencia(
        'minutos_elearning',
        'Minutos de e-learning por persona/mes',
        'minutos',
        minRef,
        `${minBajo}–${minAlto} min`,
        PARAM_IDS.minutosReferencia,
      ),
      referencia(
        'asr_mensual',
        'ASR mensual (promedio 6 meses)',
        'porcentaje',
        asrAlto,
        `${Math.round(asrBajo * 100)}%–${Math.round(asrAlto * 100)}%`,
        PARAM_IDS.asrUmbralAlto,
      ),
      referencia(
        'costo_por_curso',
        'Costo por curso completado',
        'usd_unitario',
        costoMercado,
        fmtUSD(costoMercado),
        PARAM_IDS.costoCursoMercado,
      ),
    ];
  }

  // -------------------------------------------------------------------------
  // Orquestador
  // -------------------------------------------------------------------------

  /** Las cifras intermedias etiquetadas. */
  function derivadosDe(input: LMSInput, instalada: CapacidadInstaladaResultado): DesgloseLinea[] {
    const segmentos = resolverSegmentos(input);
    const contextoDe = (id: string, clave: string): number =>
      instalada.palancas.find((p) => p.id === id)?.contexto[clave] ?? 0;
    const mesesModoEstudio =
      instalada.palancas.find((p) => p.id === PALANCA_IDS.modoEstudio)?.contexto.mesesAplicables ?? 0;

    return [
      linea(ETIQUETA.lideres, segmentos.lideres, 'usuarios'),
      linea('Resto de población', segmentos.resto, 'usuarios'),
      linea('Precio por líder', contextoDe(PALANCA_IDS.catalogoLideres, 'precioUnitario'), 'usd_unitario'),
      linea('Precio por usuario del resto', contextoDe(PALANCA_IDS.catalogoPorRol, 'precioUnitario'), 'usd_unitario'),
      linea('Contrataciones del periodo', contextoDe(PALANCA_IDS.onboarding, 'contrataciones'), 'usuarios'),
      linea('Meses de contrato', instalada.periodo.mesesContrato, 'meses'),
      linea('Meses aplicables de Modo Estudio', mesesModoEstudio, 'meses'),
    ];
  }

  /**
   * La capacidad instalada, acotada a un multiplo defendible de la inversion.
   *
   * El techo es valor de lista dividido por lo que paga el cliente, asi que un
   * contrato muy descontado da 12x o 24x: la cifra es cierta y aun asi nadie se
   * la cree, y el documento entero pierde credibilidad con ella. Cuando se pasa
   * del tope se vuelve a calcular TODO con los precios escalados, para que las
   * cuentas de las explicaciones sigan cuadrando.
   */
  function capacidadAcotada(input: LMSInput): {
    instalada: CapacidadInstaladaResultado;
    acotacion: AcotacionValoracion | null;
  } {
    const instalada = calcularCapacidadInstalada(input);
    const techoMaximo = numeroParam(params, PARAM_IDS.techoMaximo, 6);
    const inversion = input.capacidad.inversionAnualUSD;

    const tope = techoMaximo * inversion;
    if (techoMaximo <= 0 || inversion <= 0 || instalada.total <= tope) {
      return { instalada, acotacion: null };
    }

    const factor = tope / instalada.total;
    return {
      instalada: calcularCapacidadInstalada(input, factor),
      acotacion: { factor, instaladoSinAcotar: instalada.total, techoMaximo },
    };
  }

  /**
   * El ROI que se ensena DURANTE la venta. No mide nada: la capacidad
   * instalada es aritmetica sobre lo cotizado y lo que se capturaria es un
   * supuesto declarado.
   */
  function calcular(input: LMSInput): ROIResultado<LMSInput> {
    const { instalada, acotacion } = capacidadAcotada(input);
    const advertencias = [...instalada.advertencias];
    const inversion = input.capacidad.inversionAnualUSD;

    // En venta no hay uso que medir, asi que no hay nada capturado. Los dos
    // null son deliberados: `razon(0, x)` devolveria 0, que se renderiza como
    // "0,0x" o "0%" — peor que un guion delante de un prospecto.
    const palancas: PalancaResultado[] = instalada.palancas.map((p) => ({
      enCotizacion: p.enCotizacion,
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      descripcionCorta: p.descripcionCorta,
      binaria: p.binaria,
      orden: p.orden,
      paramIds: p.paramIds,
      instalado: p.instalado,
      capturado: 0,
      gap: p.instalado,
      aprovechamiento: null,
      factorPeriodo: p.factorPeriodo,
      explicacionInstalado: p.explicacion,
      explicacionCapturado: vacia(
        p.enCotizacion
          ? 'En venta no se mide uso: todavía no hay nada que capturar.'
          : 'No incluida en esta cotización.',
      ),
      advertenciaIds: advertencias.filter((a) => a.palancaId === p.id).map((a) => a.id),
    }));

    const segmentos = resolverSegmentos(input);
    const P = input.capacidad.poblacion.poblacionTotal;
    const poblacionCubierta = segmentos.lideres + segmentos.resto;

    const totales: Totales = {
      inversion,
      instalado: instalada.total,
      capturado: 0,
      sinCapturar: instalada.total,
      aprovechamiento: null,
      multiploReal: null,
      techoMultiplo: razon(instalada.total, inversion),
      poblacionTotal: P,
      poblacionCubierta,
      coberturaPoblacion: razon(poblacionCubierta, P),
    };

    const cotizadas = instalada.palancas.filter((p) => p.enCotizacion).map((p) => p.id);
    const excluidas = instalada.palancas.filter((p) => !p.enCotizacion).map((p) => p.id);

    return {
      productId: 'lms',
      productName: 'Módulo de Aprendizaje',
      modo: 'proyeccion',
      proyeccion: {
        palancasCotizadas: cotizadas,
        palancasExcluidas: excluidas,
        descargo: DESCARGO_PROYECCION,
      },
      cliente: input.cliente,
      inputs: input,
      paramsSnapshot: params,
      periodo: instalada.periodo,
      palancas,
      totales,
      benchmarks: calcularBenchmarks(),
      derivados: derivadosDe(input, instalada),
      fuenteActivos: instalada.fuenteActivos,
      acotacion,
      advertencias,
      calculadoEn: now().toISOString(),
    };
  }

  return {
    productId: 'lms',
    productName: 'Módulo de Aprendizaje',
    getPalancas: () => PALANCAS,
    getParams: () => params,
    getInputDefaults: () => inputPorDefecto(now().getFullYear()),
    validarInput: validarLMSInput,
    calcularCapacidadInstalada,
    calcular,
  };
}
