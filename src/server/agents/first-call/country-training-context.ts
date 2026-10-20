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
  CO: [
    {
      name: 'Decreto 1072 de 2015 (capacitación en SST)',
      ids: ['Decreto 1072 de 2015'],
      what: 'programa de capacitación en SST documentado para todos los niveles, revisado al menos una vez al año, con inducción a todo trabajador nuevo',
      appliesTo: 'todo empleador o contratante',
      source: 'Decreto 1072 de 2015, art. 2.2.4.6.11',
    },
    {
      name: 'Resolución 0312 de 2019 (estándares mínimos del SG-SST)',
      ids: ['Resolución 0312 de 2019', 'Resolución 312 de 2019'],
      what: 'capacitación en promoción y prevención y un plan anual de trabajo; en empresas de 11 a 50 trabajadores de riesgo IV o V, programa de capacitación anual con inducción y reinducción',
      appliesTo: 'empleadores según tamaño y nivel de riesgo',
      source: 'MinTrabajo, Diario Oficial 50.872',
    },
    {
      name: 'Ley 2101 de 2021 (reducción de jornada)',
      ids: ['Ley 2101 de 2021', 'Ley 2101'],
      what: 'la jornada máxima bajó gradualmente y desde el 15-07-2026 es de 42 horas semanales sin reducir el salario',
      appliesTo: 'régimen privado del Código Sustantivo del Trabajo',
      source: 'Ley 2101 de 2021; MinTrabajo, julio de 2026',
    },
    {
      name: 'Ley 2365 de 2024 (acoso sexual laboral)',
      ids: ['Ley 2365 de 2024', 'Ley 2365'],
      what: 'política interna de prevención del acoso sexual en el reglamento, los contratos y los protocolos, ampliamente difundida',
      appliesTo: 'todos los empleadores',
      source: 'Ley 2365 de 2024, art. 11',
    },
    {
      name: 'Resolución 2764 de 2022 (riesgo psicosocial)',
      ids: ['Resolución 2764 de 2022'],
      what: 'evaluación con la batería de riesgo psicosocial: anual si el riesgo es alto y cada dos años si es medio o bajo',
      appliesTo: 'empleadores públicos y privados',
      source: 'MinTrabajo, Diario Oficial 52.106',
    },
    {
      name: 'Ley 2466 de 2025 (reforma laboral)',
      ids: ['Ley 2466 de 2025', 'Ley 2466'],
      what: 'trabajo libre de violencias y acoso, con protocolos, comités y mecanismos de prevención',
      appliesTo: 'relaciones laborales del Código Sustantivo del Trabajo',
      source: 'Ley 2466 de 2025, art. 18',
    },
    {
      name: 'Cuota de aprendices del SENA (Ley 789 de 2002)',
      ids: ['Ley 789 de 2002'],
      what: 'un aprendiz por cada 20 trabajadores',
      appliesTo: 'empresas privadas con 15 o más trabajadores (salvo construcción)',
      source: 'SENA, concepto 9470 de 2025',
    },
  ],
  BO: [
    {
      name: 'Decreto Ley 16998 (Higiene, Seguridad Ocupacional y Bienestar)',
      ids: ['Decreto Ley 16998', 'DL 16998'],
      what: 'el empleador debe promover la capacitación del personal en prevención de riesgos del trabajo',
      appliesTo: 'todos los empleadores',
      source: 'DL 16998, art. 6',
    },
  ],
  GT: [
    {
      name: 'Ley Orgánica del INTECAP (Decreto 17-72)',
      ids: ['Decreto 17-72'],
      what: 'tasa patronal de hasta el 1 % de la planilla, que puede rebajarse hasta un 80 % si la empresa da su propia formación por convenio con el INTECAP',
      appliesTo: 'empresas privadas y entidades públicas con fines de lucro',
      source: 'INTECAP, Decreto 17-72, arts. 28 y 30',
    },
    {
      name: 'Acuerdo Gubernativo 229-2014 (salud y seguridad ocupacional)',
      ids: ['Acuerdo Gubernativo 229-2014'],
      what: 'el patrono debe promover la capacitación de su personal en salud y seguridad ocupacional',
      appliesTo: 'todos los patronos',
      source: 'AG 229-2014, art. 5',
    },
  ],
  HN: [
    {
      name: 'Aporte al INFOP',
      what: 'el empleador aporta el 1 % para la formación profesional',
      appliesTo: 'empleadores',
      source: 'PwC Tax Summaries Honduras, 08-2026',
    },
  ],
  SV: [
    {
      name: 'Ley del INCAF (Decreto 893 de 2023)',
      ids: ['Decreto 893'],
      what: 'cotización del 1 % sobre la planilla para la formación profesional; el INCAF reemplazó al INSAFORP',
      appliesTo: 'patronos privados e instituciones autónomas con 10 o más trabajadores',
      source: 'Decreto 893, art. 19',
    },
    {
      name: 'Ley General de Prevención de Riesgos en los Lugares de Trabajo (Decreto 254)',
      ids: ['Decreto 254'],
      what: 'programa de gestión de prevención con entrenamiento inductor y permanente y sensibilización sobre acoso y riesgos psicosociales actualizada cada año; comité de SSO desde 15 trabajadores',
      appliesTo: 'todos los empleadores',
      source: 'Decreto Legislativo 254, arts. 8 y 13',
    },
  ],
  NI: [
    {
      name: 'Ley 618 (Higiene y Seguridad del Trabajo)',
      ids: ['Ley 618'],
      what: 'capacitación en higiene y seguridad al menos una vez al año, planificada con la Comisión Mixta e impartida por personal acreditado',
      appliesTo: 'todos los empleadores',
      source: 'Ley 618, arts. 19 a 22',
    },
    {
      name: 'Aporte al INATEC',
      ids: ['Decreto 40-94'],
      what: 'aporte mensual del 2 % sobre la planilla para la formación profesional',
      appliesTo: 'todos los empleadores',
      source: 'Decreto 40-94 y Decreto 28-95',
    },
  ],
  PA: [
    {
      name: 'Ley 7 de 2018 (actos discriminatorios y acoso)',
      ids: ['Ley 7 de 2018'],
      what: 'política interna que prevenga y sancione el hostigamiento, el acoso sexual o moral, el racismo y el sexismo, con programas de orientación',
      appliesTo: 'todos los empleadores',
      source: 'Ley 7 de 2018, art. 6',
    },
    {
      name: 'Seguro educativo',
      what: 'cotización del 1,50 % a cargo del empleador y del 1,25 % a cargo del empleado',
      appliesTo: 'empleadores y trabajadores',
      source: 'PwC Tax Summaries Panamá, 08-2026',
    },
  ],
  UY: [
    {
      name: 'INEFOP y el Fondo de Reconversión Laboral (Ley 18.406)',
      ids: ['Ley 18.406'],
      what: 'el INEFOP financia formación profesional con el Fondo de Reconversión Laboral (0,10 % del empleador y 0,10 % del trabajador)',
      appliesTo: 'empleadores y trabajadores del sector privado',
      source: 'IMPO, Ley 18.406; BPS',
    },
    {
      name: 'Ley 18.561 (acoso sexual)',
      ids: ['Ley 18.561'],
      what: 'medidas para prevenir y sancionar el acoso sexual y difundir la política contra el acoso',
      appliesTo: 'empleadores públicos y privados',
      source: 'IMPO, Ley 18.561, art. 6',
    },
  ],
  US: [
    {
      name: 'California SB 553 (Labor Code 6401.9)',
      ids: ['SB 553', 'Labor Code 6401.9'],
      what: 'plan escrito de prevención de violencia laboral y capacitación inicial y anual',
      appliesTo: 'empleadores de California',
      source: 'Cal/OSHA, desde el 01-07-2024',
    },
    {
      name: 'California Gov. Code 12950.1',
      ids: ['Gov. Code 12950.1'],
      what: 'capacitación en prevención del acoso sexual cada dos años: 2 horas a supervisores y 1 hora al resto',
      appliesTo: 'empleadores con 5 o más empleados',
      source: 'California Civil Rights Department, 12-2025',
    },
    {
      name: 'New York Labor Law 201-g',
      ids: ['Labor Law 201-g'],
      what: 'política de prevención del acoso sexual y capacitación interactiva al menos una vez al año',
      appliesTo: 'todos los empleadores de Nueva York',
      source: 'ny.gov, Employer Toolkit',
    },
    {
      name: 'IRC Section 127',
      ids: ['Section 127', 'IRC 127'],
      what: 'hasta 5.250 USD al año de asistencia educativa libre de impuestos bajo un plan escrito del empleador',
      appliesTo: 'empleadores con plan escrito',
      source: 'IRS FS-2026-10',
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
