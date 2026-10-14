/**
 * ve-onapre-posts.ts — cargos presupuestados por órgano y ente público de Venezuela,
 * para el tamaño de la capa de Gobierno.
 *
 * SOURCES-VE-SIZE-2 (14-10-2026, aprobado por la dueña: «sí a las dos»). Puro.
 *
 * Fuente: Ley de Presupuesto 2016 de la ONAPRE (Título II, órganos de la República;
 * Título III, entes descentralizados sin fines empresariales), tabla «Recursos humanos
 * por tipo de cargo y género». Es la última ley publicada (desde 2017 no se publica)
 * y son cargos PRESUPUESTADOS, no nómina real: la ficha muestra el año. No incluye
 * alcaldías, gobernaciones ni empresas del Estado.
 *
 * Cada fila une un ente de la capa gratuita (por su dominio) con su línea de la ley;
 * el cruce se hizo por nombre, clave pública o sigla con coincidencia única y se
 * revisó a mano.
 */

export type VeOnaprePosts = { domain: string; name: string; budgetName: string; posts: number };

/** Año de la Ley de Presupuesto de la que salen los cargos. */
export const VE_ONAPRE_POSTS_YEAR = 2016;

export const VE_ONAPRE_POSTS: readonly VeOnaprePosts[] = Object.freeze([
  { domain: 'abae.gob.ve', name: 'Agencia Bolivariana para Actividades Espaciales (ABAE)', budgetName: 'AGENCIA BOLIVARIANA PARA ACTIVIDADES ESPACIALES (ABAE)', posts: 284 },
  { domain: 'asambleanacional.gob.ve', name: 'Asamblea Nacional', budgetName: 'ASAMBLEA NACIONAL', posts: 2950 },
  { domain: 'bnv.gob.ve', name: 'Instituto Autónomo Biblioteca Nacional y de Servicios de Bibliotecas', budgetName: 'INSTITUTO AUTÓNOMO BIBLIOTECA NACIONAL Y DE SERVICIOS DE BIBLIOTECAS', posts: 1291 },
  { domain: 'cardiologicoinfantil.gob.ve', name: 'Hospital Cardiológico Infantil Latinoamericano Dr. Gilberto Rodríguez Ochoa', budgetName: 'FUNDACIÓN HOSPITAL CARDIOLÓGICO INFANTIL LATINOAMERICANO "DR. GILBERTO RODRÍGUEZ OCHOA"', posts: 398 },
  { domain: 'celarg.org.ve', name: 'Fundación Centro de Estudios Latinoamericanos Rómulo Gallegos (CELARG)', budgetName: 'FUNDACIÓN CENTRO DE ESTUDIOS LATINOAMERICANOS RÓMULO GALLEGOS', posts: 154 },
  { domain: 'cenal.gob.ve', name: 'Centro Nacional del Libro (CENAL)', budgetName: 'CENTRO NACIONAL DEL LIBRO (CNL)', posts: 129 },
  { domain: 'cgr.gob.ve', name: 'Contraloría General de la República', budgetName: 'CONTRALORÍA GENERAL DE LA REPÚBLICA', posts: 865 },
  { domain: 'ciepe.gob.ve', name: 'Fundación Centro de Investigaciones del Estado para la Producción Experimental Agroindustrial (CIEPE)', budgetName: 'FUNDACIÓN CENTRO DE INVESTIGACIONES DEL ESTADO PARA LA PRODUCCIÓN EXPERIMENTAL AGROINDUSTRIAL (CIEPE)', posts: 194 },
  { domain: 'cnc.gob.ve', name: 'Comisión Nacional de Casinos, Salas de Bingo y Máquinas Traganíqueles (CNC)', budgetName: 'COMISIÓN NACIONAL DE CASINOS, SALAS DE BINGO Y MÁQUINAS TRAGANÍQUELES', posts: 87 },
  { domain: 'cnti.gob.ve', name: 'Centro Nacional de Tecnologías de Información (CNTI)', budgetName: 'CENTRO NACIONAL DE TECNOLOGÍAS DE INFORMACIÓN (CNTI)', posts: 274 },
  { domain: 'cntq.gob.ve', name: 'Centro Nacional de Tecnología Química (CNTQ)', budgetName: 'FUNDACIÓN CENTRO NACIONAL DE TECNOLOGÍA QUÍMICA (CNTQ)', posts: 69 },
  { domain: 'cnu.gob.ve', name: 'Consejo Nacional de Universidades (CNU)', budgetName: 'SERVICIO AUTÓNOMO OFICINAS TÉCNICAS DEL CONSEJO NACIONAL DE UNIVERSIDADES (CNU)', posts: 805 },
  { domain: 'conalot.gob.ve', name: 'Comisión Nacional de Lotería (CONALOT)', budgetName: 'SERVICIO AUTÓNOMO COMISIÓN NACIONAL DE LOTERÍA (Conalot)', posts: 116 },
  { domain: 'conatel.gob.ve', name: 'Comisión Nacional de Telecomunicaciones (CONATEL)', budgetName: 'INSTITUTO AUTÓNOMO COMISIÓN NACIONAL DE TELECOMUNICACIONES (CONATEL)', posts: 906 },
  { domain: 'conati.gob.ve', name: 'Comisión Nacional de las Tecnologías de Información (CONATI)', budgetName: 'COMISIÓN NACIONAL DE LAS TECNOLOGÍAS DE INFORMACIÓN', posts: 34 },
  { domain: 'corpocentro.gob.ve', name: 'Corporación de Desarrollo de la Región Central (CORPOCENTRO)', budgetName: 'CORPORACIÓN DE DESARROLLO DE LA REGIÓN CENTRAL (CORPOCENTRO)', posts: 224 },
  { domain: 'defensoria.gob.ve', name: 'Defensoría del Pueblo', budgetName: 'DEFENSORÍA DEL PUEBLO', posts: 822 },
  { domain: 'fonacit.gob.ve', name: 'Fondo Nacional de Ciencia, Tecnología e Innovación (FONACIT)', budgetName: 'FONDO NACIONAL DE CIENCIA, TECNOLOGÍA E INNOVACIÓN (FONACIT)', posts: 459 },
  { domain: 'huc.gob.ve', name: 'Hospital Universitario de Caracas', budgetName: 'INSTITUTO AUTÓNOMO HOSPITAL UNIVERSITARIO DE CARACAS (HUC)', posts: 9339 },
  { domain: 'idea.gob.ve', name: 'Instituto de Estudios Avanzados (IDEA)', budgetName: 'FUNDACIÓN INSTITUTO DE ESTUDIOS AVANZADOS (IDEA)', posts: 397 },
  { domain: 'ife.gob.ve', name: 'Instituto de Ferrocarriles del Estado (IFE)', budgetName: 'INSTITUTO DE FERROCARRILES DEL ESTADO (IFE)', posts: 2992 },
  { domain: 'igvsb.gob.ve', name: 'Instituto Geográfico de Venezuela Simón Bolívar (IGVSB)', budgetName: 'INSTITUTO GEOGRÁFICO DE VENEZUELA "SIMÓN BOLÍVAR"', posts: 419 },
  { domain: 'imprentanacional.gob.ve', name: 'Servicio Autónomo Imprenta Nacional y Gaceta Oficial', budgetName: 'SERVICIO AUTÓNOMO IMPRENTA NACIONAL Y GACETA OFICIAL', posts: 302 },
  { domain: 'inameh.gob.ve', name: 'Instituto Nacional de Meteorología e Hidrología (INAMEH)', budgetName: 'INSTITUTO NACIONAL DE METEOROLOGÍA E HIDROLOGÍA (INAMEH)', posts: 270 },
  { domain: 'inamujer.gob.ve', name: 'Instituto Nacional de la Mujer (INAMUJER)', budgetName: 'INSTITUTO NACIONAL DE LA MUJER (INAMUJER)', posts: 751 },
  { domain: 'inapymi.gob.ve', name: 'Instituto Nacional de Desarrollo de la Pequeña y Mediana Industria (INAPYMI)', budgetName: 'INSTITUTO NACIONAL DE DESARROLLO PARA LA PEQUEÑA Y MEDIANA INDUSTRIA (Inapymi)', posts: 1280 },
  { domain: 'inces.gob.ve', name: 'Instituto Nacional de Capacitación y Educación Socialista (INCES)', budgetName: 'INSTITUTO NACIONAL DE CAPACITACIÓN Y EDUCACIÓN SOCIALISTA (INCES)', posts: 7779 },
  { domain: 'ine.gob.ve', name: 'Instituto Nacional de Estadística (INE)', budgetName: 'INSTITUTO NACIONAL DE ESTADÍSTICA (INE)', posts: 2172 },
  { domain: 'inea.gob.ve', name: 'Instituto Nacional de los Espacios Acuáticos (INEA)', budgetName: 'INSTITUTO NACIONAL DE LOS ESPACIOS ACUÁTICOS (INEA)', posts: 1167 },
  { domain: 'infocentro.gob.ve', name: 'Fundación Infocentro', budgetName: 'FUNDACIÓN INFOCENTRO', posts: 1385 },
  { domain: 'inhrr.gob.ve', name: 'Instituto Nacional de Higiene Rafael Rangel (INHRR)', budgetName: 'INSTITUTO NACIONAL DE HIGIENE "RAFAEL RANGEL" (INHRR)', posts: 978 },
  { domain: 'inia.gob.ve', name: 'Instituto Nacional de Investigaciones Agrícolas (INIA)', budgetName: 'INSTITUTO NACIONAL DE INVESTIGACIONES AGRÍCOLAS (Inia)', posts: 3349 },
  { domain: 'inj.gob.ve', name: 'Instituto Nacional de la Juventud (INJ)', budgetName: 'INSTITUTO NACIONAL DEL PODER POPULAR DE LA JUVENTUD', posts: 344 },
  { domain: 'inparques.gob.ve', name: 'Instituto Nacional de Parques (INPARQUES)', budgetName: 'INSTITUTO NACIONAL DE PARQUES (INPARQUES)', posts: 3310 },
  { domain: 'insai.gob.ve', name: 'Instituto Nacional de Salud Agrícola Integral (INSAI)', budgetName: 'INSTITUTO NACIONAL DE SALUD AGRÍCOLA INTEGRAL (Insai)', posts: 3092 },
  { domain: 'insopesca.gob.ve', name: 'Instituto Socialista de la Pesca y Acuicultura (INSOPESCA)', budgetName: 'INSTITUTO SOCIALISTA DE LA PESCA Y ACUICULTURA (Insopesca)', posts: 1328 },
  { domain: 'inti.gob.ve', name: 'Instituto Nacional de Tierras (INTI)', budgetName: 'INSTITUTO NACIONAL DE TIERRAS (Inti)', posts: 3471 },
  { domain: 'intt.gob.ve', name: 'Instituto Nacional de Transporte Terrestre (INTT)', budgetName: 'INSTITUTO NACIONAL DE TRANSPORTE TERRESTRE (INTT)', posts: 2653 },
  { domain: 'ipasme.gob.ve', name: 'Instituto de Previsión y Asistencia Social para el Personal del Ministerio de Educación (IPASME)', budgetName: 'INSTITUTO DE PREVISIÓN Y ASISTENCIA SOCIAL PARA EL PERSONAL DEL MINISTERIO DE EDUCACIÓN (IPASME)', posts: 14493 },
  { domain: 'ivic.gob.ve', name: 'Instituto Venezolano de Investigaciones Científicas (IVIC)', budgetName: 'INSTITUTO VENEZOLANO DE INVESTIGACIONES CIENTÍFICAS (IVIC)', posts: 2032 },
  { domain: 'ivss.gob.ve', name: 'Instituto Venezolano de los Seguros Sociales (IVSS)', budgetName: 'INSTITUTO VENEZOLANO DE LOS SEGUROS SOCIALES (IVSS)', posts: 51860 },
  { domain: 'libreriasdelsur.gob.ve', name: 'Fundación Librerías del Sur', budgetName: 'FUNDACIÓN LIBRERÍAS DEL SUR', posts: 171 },
  { domain: 'minagricultura.gob.ve', name: 'Ministerio del Poder Popular para la Agricultura y Tierras', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA AGRICULTURA Y TIERRAS', posts: 4347 },
  { domain: 'mincultura.gob.ve', name: 'Ministerio del Poder Popular para la Cultura', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA CULTURA', posts: 3157 },
  { domain: 'minhvi.gob.ve', name: 'Ministerio del Poder Popular para Hábitat y Vivienda', budgetName: 'MINISTERIO DEL PODER POPULAR PARA HÁBITAT Y VIVIENDA', posts: 3129 },
  { domain: 'minmujer.gob.ve', name: 'Ministerio del Poder Popular para la Mujer y la Igualdad de Género', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA MUJER Y LA IGUALDAD DE GÉNERO', posts: 752 },
  { domain: 'minpal.gob.ve', name: 'Ministerio del Poder Popular para la Alimentación', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA ALIMENTACIÓN', posts: 783 },
  { domain: 'minpi.gob.ve', name: 'Ministerio del Poder Popular para los Pueblos Indígenas', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LOS PUEBLOS INDÍGENAS', posts: 596 },
  { domain: 'mintur.gob.ve', name: 'Ministerio del Poder Popular para el Turismo', budgetName: 'MINISTERIO DEL PODER POPULAR PARA EL TURISMO', posts: 1064 },
  { domain: 'mippci.gob.ve', name: 'Ministerio del Poder Popular para la Comunicación y la Información', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA COMUNICACIÓN Y LA INFORMACIÓN', posts: 1275 },
  { domain: 'misionjosegregoriohernandez.gob.ve', name: 'Fundación Misión José Gregorio Hernández', budgetName: 'FUNDACIÓN MISIÓN JOSÉ GREGORIO HERNÁNDEZ', posts: 222 },
  { domain: 'misionpiar.gob.ve', name: 'Fundación Misión Piar', budgetName: 'FUNDACIÓN MISIÓN PIAR', posts: 108 },
  { domain: 'misionsucre.gob.ve', name: 'Fundación Misión Sucre', budgetName: 'FUNDACIÓN MISIÓN SUCRE', posts: 954 },
  { domain: 'mppee.gob.ve', name: 'Ministerio del Poder Popular para la Energía Eléctrica', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA ENERGÍA ELÉCTRICA', posts: 1429 },
  { domain: 'mppp.gob.ve', name: 'Ministerio del Poder Popular de Planificación', budgetName: 'MINISTERIO DEL PODER POPULAR DE PLANIFICACIÓN', posts: 486 },
  { domain: 'mpprijp.gob.ve', name: 'Ministerio del Poder Popular para Relaciones Interiores, Justicia y Paz', budgetName: 'MINISTERIO DEL PODER POPULAR PARA RELACIONES INTERIORES, JUSTICIA Y PAZ', posts: 49628 },
  { domain: 'mpps.gob.ve', name: 'Ministerio del Poder Popular para la Salud', budgetName: 'MINISTERIO DEL PODER POPULAR PARA LA SALUD', posts: 155764 },
  { domain: 'mppsp.gob.ve', name: 'Ministerio del Poder Popular para el Servicio Penitenciario', budgetName: 'MINISTERIO DEL PODER POPULAR PARA EL SERVICIO PENITENCIARIO', posts: 9961 },
  { domain: 'oncti.gob.ve', name: 'Observatorio Nacional de Ciencia, Tecnología e Innovación (ONCTI)', budgetName: 'OBSERVATORIO NACIONAL DE CIENCIA, TECNOLOGÍA E INNOVACIÓN (ONCTI)', posts: 105 },
  { domain: 'pgr.gob.ve', name: 'Procuraduría General de la República', budgetName: 'PROCURADURÍA GENERAL DE LA REPÚBLICA', posts: 462 },
  { domain: 'sacs.gob.ve', name: 'Servicio Autónomo de Contraloría Sanitaria (SACS)', budgetName: 'SERVICIO AUTÓNOMO DE CONTRALORÍA SANITARIA (SACS)', posts: 465 },
  { domain: 'safonapp.gob.ve', name: 'Servicio Fondo Nacional del Poder Popular (SAFONAPP)', budgetName: 'SERVICIO FONDO NACIONAL DEL PODER POPULAR (SAFONAPP)', posts: 370 },
  { domain: 'sahum.gob.ve', name: 'Servicio Autónomo Hospital Universitario de Maracaibo (SAHUM)', budgetName: 'SERVICIO AUTÓNOMO HOSPITAL UNIVERSITARIO DE MARACAIBO (SAHUM)', posts: 5933 },
  { domain: 'sapi.gob.ve', name: 'Servicio Autónomo de la Propiedad Intelectual (SAPI)', budgetName: 'SERVICIO AUTÓNOMO DE LA PROPIEDAD INTELECTUAL (Sapi)', posts: 223 },
  { domain: 'saren.gob.ve', name: 'Servicio Autónomo de Registros y Notarías (SAREN)', budgetName: 'SERVICIO AUTÓNOMO DE REGISTROS Y NOTARÍAS (SAREN)', posts: 9952 },
  { domain: 'sudeaseg.gob.ve', name: 'Superintendencia de la Actividad Aseguradora (SUDEASEG)', budgetName: 'SUPERINTENDENCIA DE LA ACTIVIDAD ASEGURADORA', posts: 771 },
  { domain: 'sunai.gob.ve', name: 'Superintendencia Nacional de Auditoría Interna (SUNAI)', budgetName: 'SUPERINTENDENCIA NACIONAL DE AUDITORÍA INTERNA', posts: 96 },
  { domain: 'suscerte.gob.ve', name: 'Superintendencia de Servicios de Certificación Electrónica (SUSCERTE)', budgetName: 'SUPERINTENDENCIA DE SERVICIOS DE CERTIFICACIÓN ELECTRÓNICA (SUSCERTE)', posts: 67 },
  { domain: 'udo.education', name: 'Universidad de Oriente (UDO)', budgetName: 'UNIVERSIDAD DE ORIENTE (UDO)', posts: 7139 },
  { domain: 'unearte.edu.ve', name: 'Universidad Nacional Experimental de las Artes (UNEARTE)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL DE LAS ARTES (UNEARTE)', posts: 827 },
  { domain: 'unefa.edu.ve', name: 'Universidad Nacional Experimental Politécnica de la Fuerza Armada Nacional (UNEFA)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL POLITÉCNICA DE LA FUERZA ARMADA NACIONAL (UNEFA)', posts: 16662 },
  { domain: 'unefm.edu.ve', name: 'Universidad Nacional Experimental Francisco de Miranda (UNEFM)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL FRANCISCO DE MIRANDA (UNEFM)', posts: 5844 },
  { domain: 'uneg.edu.ve', name: 'Universidad Nacional Experimental de Guayana (UNEG)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL DE GUAYANA (UNEG)', posts: 1131 },
  { domain: 'unerg.edu.ve', name: 'Universidad Nacional Experimental Rómulo Gallegos (UNERG)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL DE LOS LLANOS CENTRALES RÓMULO GALLEGOS (UNERG)', posts: 3937 },
  { domain: 'unermb.web.ve', name: 'Universidad Nacional Experimental Rafael María Baralt', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL RAFAEL MARÍA BARALT (UNERMB)', posts: 2602 },
  { domain: 'unet.edu.ve', name: 'Universidad Nacional Experimental del Táchira (UNET)', budgetName: 'UNIVERSIDAD NACIONAL EXPERIMENTAL DEL TÁCHIRA (UNET)', posts: 1656 },
  { domain: 'upel.edu.ve', name: 'Universidad Pedagógica Experimental Libertador (UPEL)', budgetName: 'UNIVERSIDAD PEDAGÓGICA EXPERIMENTAL LIBERTADOR (UPEL)', posts: 16340 },
  { domain: 'uptm.edu.ve', name: 'Universidad Politécnica Territorial del Estado Mérida Kléber Ramírez (UPTM)', budgetName: 'UNIVERSIDAD POLITÉCNICA TERRITORIAL DEL ESTADO MÉRIDA "KLÉBER RAMIREZ"', posts: 830 },
]);
