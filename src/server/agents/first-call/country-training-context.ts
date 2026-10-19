/**
 * Agente 3 (Rumbo) · normas y programas de formación de cada país (puro).
 *
 * Dueña 19-10: «el contexto de cada país también es insumo». Una norma que obliga a
 * capacitar (NOM-035 en México, la franquicia SENCE en Chile, la NR-1 en Brasil…) es
 * una buena pregunta para RR. HH. Sólo entra lo que las investigaciones del 19-10-2026
 * verificaron en una fuente oficial o en prensa con fecha; lo que quedó «por verificar»
 * NO está aquí. Rumbo la usa como contexto o como pregunta, nunca para decir que la
 * empresa incumple.
 */

export interface TrainingContextItem {
  /** La norma o el programa, como se nombra en el país. */
  name: string;
  /** Qué exige u ofrece, en una frase (sus cifras quedan permitidas en los mensajes). */
  what: string;
  /** A quién aplica. */
  appliesTo: string;
  /** Dónde se verificó. */
  source: string;
  /** Cómo se nombra en un mensaje («NOM-035», «Ley 21.643»): sus números no son cifras sin fuente. */
  ids?: readonly string[];
}

const CONTEXT: Readonly<Record<string, readonly TrainingContextItem[]>> = {
  MX: [
    {
      name: 'NOM-035-STPS-2018',
      ids: ['NOM-035-STPS-2018', 'NOM-035'],
      what: 'identificar y prevenir los factores de riesgo psicosocial; desde 16 trabajadores con cuestionario y con más de 50 también evaluar el entorno organizacional',
      appliesTo: 'todos los centros de trabajo',
      source: 'DOF 23-10-2018',
    },
    {
      name: 'Constancias DC-3 de la STPS',
      ids: ['DC-3', 'DC-4'],
      what: 'constancia de competencias o habilidades laborales de cada capacitación, que la empresa reporta a la STPS',
      appliesTo: 'todos los patrones',
      source: 'DOF 14-06-2013',
    },
    {
      name: 'Estímulo fiscal del Plan México',
      what: 'deducción adicional del 25 % del incremento en el gasto de capacitación técnica (2025 a 2030)',
      appliesTo: 'contribuyentes aprobados por el Comité de Evaluación',
      source: 'DOF 21-01-2025',
    },
    {
      name: 'Reforma de la jornada a 40 horas',
      what: 'la jornada baja de 48 a 46 horas en 2027 y llega a 40 en 2030, con registro electrónico de entrada y salida desde 2027',
      appliesTo: 'todos los patrones',
      source: 'Expansión, 07-10-2026',
    },
  ],
  CL: [
    {
      name: 'Franquicia Tributaria SENCE',
      what: 'descontar de impuestos la capacitación hasta el 1 % de la planilla anual de remuneraciones',
      appliesTo: 'empresas de primera categoría; el Comité Bipartito de Capacitación es obligatorio desde 15 trabajadores',
      source: 'sence.gob.cl',
    },
    {
      name: 'Ley Karin (Ley 21.643)',
      ids: ['Ley 21.643', 'Ley 21643'],
      what: 'protocolo de prevención del acoso laboral, sexual y la violencia en el trabajo',
      appliesTo: 'todos los empleadores',
      source: 'Dirección del Trabajo',
    },
  ],
  BR: [
    {
      name: 'NR-1 (riscos psicossociais)',
      ids: ['NR-1', 'NR 1'],
      what: 'incluir los riesgos psicosociales en la gestión de riesgos laborales, vigente desde el 26-05-2026',
      appliesTo: 'todo empleador con empleados CLT',
      source: 'manual del MTE, 16-03-2026',
    },
  ],
  ES: [
    {
      name: 'Crédito de formación de FUNDAE',
      what: 'formación de la plantilla bonificada en las cuotas de la Seguridad Social',
      appliesTo: 'empresas que cotizan por formación profesional',
      source: 'fundae.es',
    },
    {
      name: 'Real Decreto 723/2026',
      ids: ['Real Decreto 723/2026', 'RD 723/2026'],
      what: 'informar por escrito las condiciones de trabajo antes de empezar, vigente desde el 05-10-2026',
      appliesTo: 'todas las empresas',
      source: 'Observatorio de RRHH',
    },
  ],
  AR: [
    {
      name: 'Ley Micaela (Ley 27.499)',
      ids: ['Ley 27.499', 'Ley 27499'],
      what: 'capacitación obligatoria en género y violencia contra las mujeres',
      appliesTo: 'todo el personal de la función pública',
      source: 'argentina.gob.ar/normativa',
    },
  ],
  PE: [
    {
      name: 'Ley 29783 de Seguridad y Salud en el Trabajo',
      ids: ['Ley 29783', 'Ley N.° 29783'],
      what: 'no menos de 4 capacitaciones al año en seguridad y salud en el trabajo',
      appliesTo: 'todos los empleadores',
      source: 'Ley 29783, art. 35',
    },
    {
      name: 'Reglamento de la Ley 27942 (DS 014-2019-MIMP)',
      ids: ['Ley 27942', 'DS 014-2019-MIMP'],
      what: 'capacitación en prevención del hostigamiento sexual al inicio de la relación laboral y una anual especializada',
      appliesTo: 'todos los empleadores',
      source: 'El Peruano',
    },
  ],
  EC: [
    {
      name: 'SECAP',
      what: 'capacitación y certificación por competencias laborales para empresas y personas en las 24 provincias',
      appliesTo: 'empresas y trabajadores',
      source: 'gob.ec/secap',
    },
  ],
  VE: [
    {
      name: 'Aporte al INCES',
      what: 'aporte del 2 % del salario normal mensual para la formación de los trabajadores',
      appliesTo: 'empleadores privados',
      source: 'inces.gob.ve',
    },
  ],
  CR: [
    {
      name: 'Convenio 190 de la OIT (Ley 10.749)',
      ids: ['Convenio 190', 'Ley 10.749'],
      what: 'prevención de la violencia y el acoso en el trabajo, ratificado en 2025',
      appliesTo: 'todos los empleadores',
      source: 'Delfino, 10-2026',
    },
  ],
  DO: [
    {
      name: 'Responsabilidad penal de las personas jurídicas (Código Penal, Ley 74-25)',
      ids: ['Ley 74-25'],
      what: 'desde el 05-11-2026 se recomienda un programa de cumplimiento, canal de denuncias y protocolos contra el acoso',
      appliesTo: 'empresas',
      source: 'ADOARH, 2026',
    },
  ],
  PY: [
    {
      name: 'SINAFOCAL',
      what: 'capacitación laboral, certificación de competencias y registro de institutos de formación',
      appliesTo: 'trabajadores, empresas e institutos',
      source: 'sinafocal.gov.py',
    },
  ],
};

/** Lo verificado del país (vacío si no hay nada confirmado). */
export function trainingContextFor(countryCode: string | null | undefined): readonly TrainingContextItem[] {
  return (countryCode && CONTEXT[countryCode.toUpperCase()]) || [];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * El texto sin los nombres de las normas del país («la NOM-035» → «la NOM»), para que sus
 * números no cuenten como cifras sin fuente. Sólo el identificador: las cifras de lo que
 * la norma exige («1 %», «más de 50») siguen necesitando fuente (revisión 19-10).
 */
export function stripTrainingNormIds(text: string, countryCode: string | null | undefined): string {
  let out = text;
  for (const item of trainingContextFor(countryCode)) {
    for (const id of item.ids ?? []) {
      const label = id.replace(/[\d./-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'norma';
      out = out.replace(new RegExp(escapeRegex(id), 'gi'), label);
    }
  }
  return out;
}

/** El bloque para el redactor (o `null` si el país no tiene nada verificado). */
export function renderTrainingContext(countryCode: string | null | undefined, countryName: string | null): string | null {
  const items = trainingContextFor(countryCode);
  if (items.length === 0) return null;
  return [
    `Normas y programas de formación de ${countryName ?? 'este país'} (verificados; úsalos como contexto o pregunta, nombrando la norma y SIN repetir sus cifras, nunca para decir que la empresa incumple):`,
    ...items.map((item) => `- ${item.name}: ${item.what} (aplica a ${item.appliesTo}; ${item.source}).`),
  ].join('\n');
}
