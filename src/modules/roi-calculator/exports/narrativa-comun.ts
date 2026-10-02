/**
 * Piezas de la narrativa que comparten el PDF y el PPTX de la proyeccion.
 *
 * En la calculadora original vivian en `narrativa.ts`, junto a los textos del
 * modo real (cierre del ano). Aqui solo se trae lo que la proyeccion usa.
 * Son funciones puras sobre ROIResultado para poder probarlas sin abrir
 * PowerPoint.
 */

import { fmtCantidad, fmtEntero, fmtUSD } from '../lib/format';
import { PARAM_IDS } from '../domain/lms/params';
import { ETIQUETA, PALANCA_IDS } from '../domain/lms/types';
import type { LMSInput } from '../domain/lms/types';
import type { PalancaResultado, ROIResultado } from '../domain/types';

/** 13.700 -> "13,7 mil". Las barras del deck van con la cifra abreviada. */
export function abreviarUSD(valor: number): string {
  if (valor >= 1_000_000) {
    const millones = valor / 1_000_000;
    return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(millones)} M`;
  }
  if (valor >= 1000) {
    const miles = valor / 1000;
    return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(miles)} mil`;
  }
  return fmtEntero(valor);
}

/**
 * Devuelve null, no 0, cuando la linea no existe: con una frase en palabras
 * encima, un cero inventado deja de ser un numero raro y pasa a ser una
 * afirmacion falsa delante del cliente.
 */
const lineaDe = (p: PalancaResultado, etiqueta: string): number | null =>
  p.explicacionInstalado.lineas.find((l) => l.etiqueta === etiqueta)?.valor ?? null;

/** Nombre corto para los rotulos apretados de las barras y del desglose. */
export function nombreCorto(id: string, nombre: string): string {
  switch (id) {
    case PALANCA_IDS.lms:
      return 'LMS incluido';
    case PALANCA_IDS.catalogoLideres:
      return 'Catálogo líderes';
    case PALANCA_IDS.catalogoPorRol:
      return 'Catálogo por rol';
    case PALANCA_IDS.onboarding:
      return 'Onboarding';
    case PALANCA_IDS.modoEstudio:
      return 'Tutor IA';
    case PALANCA_IDS.assessments:
      return 'Assessments';
    default:
      return nombre;
  }
}


/** Apertura de valor: lo primero que lee el cliente, antes de la primera cifra. */
export interface AperturaDeValor {
  /** Rotulo en versalitas sobre el parrafo. */
  rotulo: string;
  /** Version del PDF: hasta 3 renglones a 8,5 pt sobre 182 mm. */
  parrafo: string;
  /** Version del slide: 2 renglones a 11 pt sobre 9 in. */
  parrafoCorto: string;
  /** 'logro' cuando hay algo que ensenar; 'punto_de_partida' cuando no. */
  tono: 'logro' | 'punto_de_partida';
}

export interface CuentaPalanca {
  palancaId: string;
  /** El rotulo de la palanca: "Catálogo por rol". */
  titulo: string;
  /** La cuenta aritmetica, tal como la fijo la presentacion de referencia. */
  cuenta: string;
  /** De donde sale la cifra del cliente, en una frase. Sin punto final. */
  explicacion: string;
  /** Matiz opcional (prorrateo). Sin punto final. */
  nota?: string;
}

/** El punto final lo pone quien compone, no la narrativa. */
export const comoSeCalculaLinea = (c: CuentaPalanca): string =>
  `${c.cuenta} — ${c.explicacion}.`;

/**
 * "De donde sale cada cifra": la cuenta, intacta, y la frase que explica que
 * dato del cliente entro en ella.
 *
 * La cuenta se conserva literal porque su fraseo esta fijado contra la
 * presentacion de referencia del equipo. Lo que se anade es de donde sale el
 * numero DEL CLIENTE: si lo reporto el o si lo estimamos nosotros. Nunca se
 * justifica por que el precio de mercado es el que es.
 */
export function comoSeCalcula(resultado: ROIResultado<unknown>): CuentaPalanca[] {
  const porId = new Map(resultado.palancas.map((p) => [p.id, p]));
  const inputs = resultado.inputs as Partial<LMSInput>;
  const poblacion = resultado.totales.poblacionTotal;
  const cuentas: CuentaPalanca[] = [];

  /** Solo las palancas de acceso se prorratean, y el campo ya lo dice. */
  const notaPeriodo = (p: PalancaResultado): string | undefined =>
    p.factorPeriodo === 'periodo_acceso'
      ? `ajustado a tus ${fmtEntero(resultado.periodo.mesesContrato)} meses de contrato, no a 12`
      : undefined;

  const agregar = (
    p: PalancaResultado | undefined,
    cuenta: string,
    explicacion: string,
  ) => {
    if (!p) return;
    cuentas.push({
      palancaId: p.id,
      titulo: nombreCorto(p.id, p.nombre),
      cuenta,
      explicacion,
      nota: notaPeriodo(p),
    });
  };

  // --- Catálogo por rol ------------------------------------------------------
  const catalogoRol = porId.get(PALANCA_IDS.catalogoPorRol);
  if (catalogoRol) {
    const resto = lineaDe(catalogoRol, ETIQUETA.usuariosResto);
    const precio = lineaDe(catalogoRol, ETIQUETA.precioUsuario);
    agregar(
      catalogoRol,
      `${fmtEntero(resto)} × ${fmtUSD(precio)}`,
      // Nunca "los que no son líderes": el motor admite que líderes + resto no
      // sume la población, y afirmar el complemento seria falso en ese caso.
      `son las ${fmtEntero(resto)} personas que no están en el grupo de líderes, cada una con el catálogo de su rol`,
    );
  }

  // --- Catálogo para líderes -------------------------------------------------
  const lideres = porId.get(PALANCA_IDS.catalogoLideres);
  if (lideres) {
    const n = lineaDe(lideres, ETIQUETA.lideres);
    const precio = lineaDe(lideres, ETIQUETA.precioLider);
    const declarados = inputs.capacidad?.poblacion?.nLideres != null;
    const pct = inputs.capacidad?.poblacion?.pctLideresDefault ?? 0;
    agregar(
      lideres,
      `${fmtEntero(n)} × ${fmtUSD(precio)}`,
      declarados
        ? `son los ${fmtEntero(n)} líderes que nos reportaste, cada uno con el catálogo de liderazgo`
        : `no nos diste cuántos líderes tienes: tomamos el ${fmtPct1(pct)} de tus ${fmtEntero(poblacion)} personas, o sea ${fmtEntero(n)}`,
    );
  }

  // --- LMS -------------------------------------------------------------------
  const lms = porId.get(PALANCA_IDS.lms);
  if (lms) {
    const desde = lineaDe(lms, ETIQUETA.tramoDesde);
    const hasta = lineaDe(lms, ETIQUETA.tramoHasta);
    const tramo = hasta === null ? `de ${fmtEntero(desde)} o más` : `de ${fmtEntero(desde)} a ${fmtEntero(hasta)}`;
    agregar(
      lms,
      `paquete de ${fmtUSD(lms.instalado)}`,
      `tus ${fmtEntero(poblacion)} personas caen en el tramo ${tramo}, y cada tramo tiene un valor único`,
    );
  }

  // --- Assessments -----------------------------------------------------------
  const assessments = porId.get(PALANCA_IDS.assessments);
  if (assessments) {
    agregar(
      assessments,
      `valor fijo de ${fmtUSD(assessments.instalado)}`,
      `no cambia con el tamaño: es el mismo valor para 10 personas que para tus ${fmtEntero(poblacion)}`,
    );
  }

  // --- Tutor IA --------------------------------------------------------------
  const tutor = porId.get(PALANCA_IDS.modoEstudio);
  if (tutor) {
    const base = resultado.fuenteActivos;
    const meses = lineaDe(tutor, ETIQUETA.mesesAplicables) ?? 0;
    const costo = lineaDe(tutor, ETIQUETA.costoMensual);
    const desdeUnaEstimacion = base.usada === 'poblacion_x_asr';
    const tasa = poblacion === 0 ? 0 : base.baseUsada / poblacion;

    if (meses === 0) {
      // "× 0 meses" se lee como un error de captura, no como el motivo.
      agregar(
        tutor,
        '0 meses de producto disponible',
        'el Tutor IA todavía no existía durante tu contrato, así que no suma capacidad',
      );
    } else {
      agregar(
        tutor,
        desdeUnaEstimacion
          ? `${fmtEntero(poblacion)} × ${fmtPct1(tasa)} × ${fmtUSD(costo)} × ${fmtEntero(meses)} meses`
          : `${fmtEntero(base.baseUsada)} × ${fmtUSD(costo)} × ${fmtEntero(meses)} meses`,
        desdeUnaEstimacion
          ? `unas ${fmtEntero(Math.round(base.baseUsada))} de tus ${fmtEntero(poblacion)} estudian cada mes; el Tutor IA existió ${fmtEntero(meses)} de tus ${fmtEntero(resultado.periodo.mesesContrato)} meses`
          : `son los ${fmtEntero(base.baseUsada)} usuarios activos que nos reportaste, por los ${fmtEntero(meses)} meses que existió`,
      );
    }
  }

  // --- Onboarding ------------------------------------------------------------
  const onboarding = porId.get(PALANCA_IDS.onboarding);
  if (onboarding) {
    const n = lineaDe(onboarding, ETIQUETA.contrataciones);
    const horas = lineaDe(onboarding, ETIQUETA.horasAhorradas);
    const costo = lineaDe(onboarding, ETIQUETA.costoHoraRH);
    // El input suele venir null y manda el parametro: leer solo el input
    // perderia el "20%" justo en el caso habitual.
    const paramRotacion = resultado.paramsSnapshot.params[PARAM_IDS.rotacionAnual]?.value;
    const rotacion =
      inputs.capacidad?.rotacionAnual ?? (typeof paramRotacion === 'number' ? paramRotacion : null);
    // Cada factor con su unidad: la cuenta se leia como tres numeros sueltos
    // ("2" y "10" de que?) y habia que preguntar. Las glosas largas no caben:
    // la linea fusionada tiene 110 caracteres de presupuesto en la tabla del
    // PDF, y pasarse manda el documento a una tercera pagina.
    agregar(
      onboarding,
      `${fmtEntero(n)} contrataciones × ${fmtEntero(horas)} h de RH × ${fmtUSD(costo)}/h`,
      `estimadas${
        rotacion === null ? '' : ` con la rotación del ${fmtPct1(rotacion)}`
      }: quien se va, se reemplaza`,
    );
  }

  return cuentas;
}

export const fmtPct1 = (r: number | null): string =>
  r === null || !Number.isFinite(r)
    ? '—'
    : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(r * 100)}%`;

/**
 * Cuando la valoracion se acoto, el informe lo dice. No es una letra pequena:
 * la cifra de arriba es menor que el precio de catalogo y el cliente tiene
 * derecho a saber por que, sobre todo si pregunta cuanto vale "de verdad".
 */
export function notaDeAcotacion(resultado: ROIResultado<unknown>): string | null {
  const a = resultado.acotacion;
  if (!a) return null;
  return (
    `Valoramos tu capacidad hasta ${fmtCantidad(a.techoMaximo)} veces tu inversión del periodo. ` +
    `A precio de catálogo serían ${fmtUSD(a.instaladoSinAcotar)}: por encima de ese múltiplo la ` +
    'cifra deja de sostenerse, así que la dejamos en la lectura conservadora.'
  );
}

