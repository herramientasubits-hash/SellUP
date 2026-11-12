// ============================================================
// Asistente de Slack — forma de lo que devuelve cada herramienta (tipos).
// Las claves van en español: es lo que Claude lee para responder.
// ============================================================

export type UsagePeriod = 'hoy' | 'semana' | 'mes';
/** Periodo de creación: `todo` = sin límite de fecha. */
export type CreatedPeriod = UsagePeriod | 'todo';
export type ProspectState = 'por_revisar' | 'descartados' | 'aprobados' | 'duplicados' | 'todos';

export interface AssistantSummary {
  /** De quién son los totales («sólo lo tuyo», «tú y tu equipo»…). */
  alcance: string;
  empresasActivas: number;
  empresasPorEstado: Record<string, number>;
  prospectosPorRevisar: number;
  busquedasEnCurso: number;
  contactos: number;
  enlaces: { empresas: string; porRevisar: string; busquedas: string };
}

export interface AssistantProspect {
  nombre: string;
  estado: string;
  pais: string | null;
  industria: string | null;
  tamano: string | null;
  sitioWeb: string | null;
  nit: string | null;
  busqueda: string | null;
  responsable: string | null;
  creado: string;
  /** Sólo descartados/aprobados: quién decidió, cuándo y por qué. */
  decidioPor?: string | null;
  decidido?: string | null;
  motivo?: string | null;
}

export interface AssistantProspectList {
  estado: ProspectState;
  total: number;
  mostrados: number;
  enlace: string;
  prospectos: AssistantProspect[];
}

export interface AssistantAccount {
  nombre: string;
  estado: string;
  pais: string | null;
  industria: string | null;
  sitioWeb: string | null;
  responsable: string | null;
  contactos: number;
  creada: string;
  enlace: string;
}

export interface AssistantAccountList {
  total: number;
  mostradas: number;
  empresas: AssistantAccount[];
}

export interface AssistantContact {
  nombre: string;
  cargo: string | null;
  area: string | null;
  correo: string | null;
  telefono: string | null;
  linkedin: string | null;
  empresa: string | null;
  enlaceEmpresa: string | null;
}

export interface AssistantContactList {
  total: number;
  mostrados: number;
  contactos: AssistantContact[];
}

export interface AssistantAccountDetail {
  encontrada: boolean;
  /** Otras empresas que también coinciden (para desambiguar). */
  otrasCoincidencias: string[];
  /** No está en Empresas pero sí entre los prospectos (por revisar, descartados, duplicados…). */
  enProspectos?: AssistantProspect[];
  enlaceProspectos?: string;
  /** Lo buscado es el nombre o correo de una persona: sus contactos y empresa. */
  contactosConEseNombre?: AssistantContact[];
  empresa?: {
    id: string;
    nombre: string;
    razonSocial: string | null;
    nit: string | null;
    tipoNit: string | null;
    estado: string;
    subestado: string | null;
    pais: string | null;
    ciudad: string | null;
    region: string | null;
    industria: string | null;
    tamano: string | null;
    sitioWeb: string | null;
    dominio: string | null;
    linkedin: string | null;
    hubspotId: string | null;
    fuente: string | null;
    responsable: string | null;
    creadaPor: string | null;
    creada: string;
    actualizada: string;
    notas: string | null;
    enlace: string;
  };
  contactos?: AssistantContact[];
  totalContactos?: number;
  rumbo?: {
    investigacion: { estado: string; resumen: string | null; fecha: string } | null;
    primerosContactos: Array<{ para: string | null; cargo: string | null; canal: string | null; estado: string; fecha: string }>;
  };
}

export interface AssistantSearch {
  nombre: string;
  estado: string;
  pais: string | null;
  industria: string | null;
  meta: number | null;
  responsable: string | null;
  creada: string;
  candidatos: Record<string, number>;
  enlace: string;
}

export interface AssistantUsage {
  periodo: UsagePeriod;
  desde: string;
  /** Qué abarca: toda la plataforma, el equipo o sólo la persona. */
  alcance: string;
  consultas: number;
  errores: number;
  creditos: number;
  /** `null` si el rol no ve dinero (vendedores: sólo créditos, como en la plataforma). */
  costoUsd: number | null;
  porProveedor: Array<{ proveedor: string; consultas: number; errores: number; creditos: number; costoUsd: number | null }>;
  porPersona: Array<{ persona: string; consultas: number; creditos: number; costoUsd: number | null }>;
  enlace: string;
}

export interface AssistantUser {
  nombre: string;
  correo: string | null;
  rol: string;
  estado: string;
  grupo: string | null;
  jefe: string | null;
  ultimoIngreso: string | null;
}

export interface AssistantUserList {
  total: number;
  porEstado: Record<string, number>;
  usuarios: AssistantUser[];
  enlace: string;
}

export interface AssistantSource {
  nombre: string;
  paises: string[];
  tipo: string;
  prioridad: string;
  estado: string;
  usoEnSellUp: string;
  conexion: string;
  url: string | null;
}

export interface AssistantSourceCatalog {
  total: number;
  porEstado: Record<string, number>;
  fuentes: AssistantSource[];
  enlace: string;
}

export interface AssistantIndustryCatalog {
  version: string | null;
  industrias: Array<{ nombre: string; subindustrias: string[] }>;
}

export interface AssistantBudget {
  mes: string;
  proveedores: Array<{
    proveedor: string;
    unidad: string | null;
    asignacionMensualCreditos: number | null;
    asignacionMensualUsd: number | null;
    usadoMesCreditos: number;
    usadoMesUsd: number;
    saldoInformadoPorProveedor: number | null;
  }>;
  reglasActivas: Array<{ proveedor: string; alcance: string; periodo: string; limiteCreditos: number | null; limiteUsd: number | null; alSuperar: string }>;
  enlace: string;
}
