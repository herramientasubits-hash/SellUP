/**
 * AGENT1-TAVILY-QUERY-SPACE-1 — regiones de primer nivel por país (puro, datos).
 *
 * Una búsqueda nacional («ministerio Colombia») devuelve siempre las mismas ~15
 * entidades más conocidas: Prod 30-09, la 2.ª corrida de CO×Gobierno (lote
 * fb530d9b) trajo 16 resultados, casi todos ya vistos. Combinar cada término con
 * cada región multiplica el espacio de búsqueda y saca a la luz organizaciones
 * regionales que la búsqueda nacional nunca muestra.
 *
 * Primer nivel administrativo (departamento, estado, provincia, región), más la
 * capital cuando es una entidad propia. Nombres como se escriben localmente: es
 * lo que aparece en los sitios que Tavily indexa.
 */

export const TAVILY_COUNTRY_REGIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  CO: [
    'Bogotá', 'Antioquia', 'Valle del Cauca', 'Cundinamarca', 'Atlántico', 'Santander',
    'Bolívar', 'Boyacá', 'Caldas', 'Risaralda', 'Quindío', 'Tolima', 'Huila', 'Meta',
    'Nariño', 'Cauca', 'Córdoba', 'Sucre', 'Cesar', 'Magdalena', 'La Guajira',
    'Norte de Santander', 'Casanare', 'Caquetá', 'Chocó', 'Putumayo', 'Arauca',
    'San Andrés', 'Amazonas', 'Guaviare', 'Vichada', 'Vaupés', 'Guainía',
  ],
  MX: [
    'Ciudad de México', 'Estado de México', 'Jalisco', 'Nuevo León', 'Puebla', 'Guanajuato',
    'Querétaro', 'Veracruz', 'Chihuahua', 'Baja California', 'Coahuila', 'Sonora',
    'Tamaulipas', 'Sinaloa', 'Yucatán', 'Quintana Roo', 'San Luis Potosí', 'Aguascalientes',
    'Michoacán', 'Hidalgo', 'Morelos', 'Oaxaca', 'Chiapas', 'Guerrero', 'Tabasco',
    'Durango', 'Zacatecas', 'Campeche', 'Tlaxcala', 'Nayarit', 'Colima', 'Baja California Sur',
  ],
  AR: [
    'Buenos Aires', 'Ciudad de Buenos Aires', 'Córdoba', 'Santa Fe', 'Mendoza', 'Tucumán',
    'Entre Ríos', 'Salta', 'Neuquén', 'Chubut', 'Río Negro', 'Misiones', 'Corrientes',
    'San Juan', 'Jujuy', 'Santiago del Estero', 'Chaco', 'San Luis', 'La Pampa',
    'Catamarca', 'La Rioja', 'Formosa', 'Santa Cruz', 'Tierra del Fuego',
  ],
  PE: [
    'Lima', 'Arequipa', 'La Libertad', 'Piura', 'Lambayeque', 'Cusco', 'Junín', 'Callao',
    'Ica', 'Áncash', 'Cajamarca', 'Puno', 'Loreto', 'Tacna', 'San Martín', 'Ucayali',
    'Huánuco', 'Ayacucho', 'Moquegua', 'Tumbes', 'Pasco', 'Apurímac', 'Amazonas',
    'Huancavelica', 'Madre de Dios',
  ],
  CL: [
    'Santiago', 'Región Metropolitana', 'Valparaíso', 'Biobío', 'Antofagasta', 'Maule',
    "O'Higgins", 'La Araucanía', 'Los Lagos', 'Coquimbo', 'Atacama', 'Tarapacá',
    'Ñuble', 'Los Ríos', 'Magallanes', 'Arica y Parinacota', 'Aysén',
  ],
  EC: [
    'Quito', 'Guayaquil', 'Pichincha', 'Guayas', 'Azuay', 'Manabí', 'El Oro', 'Tungurahua',
    'Loja', 'Los Ríos', 'Imbabura', 'Chimborazo', 'Cotopaxi', 'Santo Domingo de los Tsáchilas',
    'Esmeraldas', 'Santa Elena', 'Sucumbíos', 'Orellana', 'Cañar', 'Bolívar', 'Carchi',
    'Napo', 'Pastaza', 'Morona Santiago', 'Zamora Chinchipe', 'Galápagos',
  ],
  UY: [
    'Montevideo', 'Canelones', 'Maldonado', 'Salto', 'Paysandú', 'Colonia', 'Rivera',
    'San José', 'Soriano', 'Tacuarembó', 'Cerro Largo', 'Florida', 'Rocha', 'Durazno',
    'Artigas', 'Río Negro', 'Lavalleja', 'Treinta y Tres', 'Flores',
  ],
  PY: [
    'Asunción', 'Central', 'Alto Paraná', 'Itapúa', 'Caaguazú', 'San Pedro', 'Cordillera',
    'Paraguarí', 'Guairá', 'Amambay', 'Canindeyú', 'Concepción', 'Misiones', 'Ñeembucú',
    'Caazapá', 'Presidente Hayes', 'Boquerón', 'Alto Paraguay',
  ],
  BO: [
    'La Paz', 'Santa Cruz', 'Cochabamba', 'Chuquisaca', 'Oruro', 'Potosí', 'Tarija',
    'Beni', 'Pando',
  ],
  VE: [
    'Caracas', 'Miranda', 'Zulia', 'Carabobo', 'Lara', 'Aragua', 'Anzoátegui', 'Bolívar',
    'Táchira', 'Mérida', 'Falcón', 'Monagas', 'Sucre', 'Portuguesa', 'Barinas',
    'Nueva Esparta', 'Guárico', 'Trujillo', 'Yaracuy', 'Cojedes', 'Apure', 'Vargas',
    'Delta Amacuro', 'Amazonas',
  ],
  GT: [
    'Ciudad de Guatemala', 'Guatemala', 'Quetzaltenango', 'Escuintla', 'Sacatepéquez',
    'Alta Verapaz', 'Petén', 'Izabal', 'Huehuetenango', 'San Marcos', 'Chimaltenango',
    'Suchitepéquez', 'Retalhuleu', 'Jutiapa', 'Zacapa', 'Chiquimula', 'Santa Rosa',
    'Jalapa', 'El Progreso', 'Baja Verapaz', 'Quiché', 'Sololá', 'Totonicapán',
  ],
  HN: [
    'Tegucigalpa', 'San Pedro Sula', 'Francisco Morazán', 'Cortés', 'Atlántida', 'Yoro',
    'Comayagua', 'Choluteca', 'Olancho', 'Copán', 'Colón', 'Santa Bárbara', 'El Paraíso',
    'Valle', 'Intibucá', 'La Paz', 'Lempira', 'Ocotepeque', 'Islas de la Bahía', 'Gracias a Dios',
  ],
  SV: [
    'San Salvador', 'La Libertad', 'Santa Ana', 'San Miguel', 'Sonsonate', 'La Paz',
    'Usulután', 'Ahuachapán', 'Cuscatlán', 'Chalatenango', 'La Unión', 'San Vicente',
    'Cabañas', 'Morazán',
  ],
  NI: [
    'Managua', 'León', 'Masaya', 'Chinandega', 'Granada', 'Matagalpa', 'Estelí', 'Jinotega',
    'Carazo', 'Rivas', 'Boaco', 'Chontales', 'Nueva Segovia', 'Madriz', 'Río San Juan',
    'Costa Caribe Norte', 'Costa Caribe Sur',
  ],
  CR: ['San José', 'Alajuela', 'Heredia', 'Cartago', 'Puntarenas', 'Guanacaste', 'Limón'],
  PA: [
    'Ciudad de Panamá', 'Panamá', 'Panamá Oeste', 'Colón', 'Chiriquí', 'Coclé', 'Veraguas',
    'Herrera', 'Los Santos', 'Bocas del Toro', 'Darién',
  ],
  DO: [
    'Santo Domingo', 'Distrito Nacional', 'Santiago', 'La Altagracia', 'San Cristóbal',
    'La Vega', 'Puerto Plata', 'San Pedro de Macorís', 'La Romana', 'Duarte', 'Espaillat',
    'Peravia', 'Azua', 'Monseñor Nouel', 'San Juan', 'Barahona', 'Monte Plata',
    'Sánchez Ramírez', 'Valverde', 'María Trinidad Sánchez', 'Samaná', 'Hato Mayor',
  ],
  ES: [
    'Madrid', 'Cataluña', 'Barcelona', 'Andalucía', 'Comunidad Valenciana', 'País Vasco',
    'Galicia', 'Castilla y León', 'Castilla-La Mancha', 'Aragón', 'Murcia', 'Canarias',
    'Baleares', 'Asturias', 'Navarra', 'Extremadura', 'Cantabria', 'La Rioja',
  ],
  BR: [
    'São Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Paraná', 'Rio Grande do Sul',
    'Santa Catarina', 'Bahia', 'Pernambuco', 'Ceará', 'Goiás', 'Distrito Federal',
    'Espírito Santo', 'Pará', 'Amazonas', 'Mato Grosso', 'Mato Grosso do Sul', 'Maranhão',
    'Paraíba', 'Rio Grande do Norte', 'Alagoas', 'Piauí', 'Sergipe', 'Rondônia',
    'Tocantins', 'Acre', 'Amapá', 'Roraima',
  ],
  US: [
    'California', 'Texas', 'Florida', 'New York', 'Illinois', 'Pennsylvania', 'Ohio',
    'Georgia', 'North Carolina', 'Michigan', 'New Jersey', 'Virginia', 'Washington',
    'Arizona', 'Massachusetts', 'Tennessee', 'Indiana', 'Missouri', 'Maryland', 'Colorado',
    'Wisconsin', 'Minnesota', 'South Carolina', 'Alabama', 'Louisiana', 'Kentucky', 'Oregon',
    'Oklahoma', 'Connecticut', 'Utah', 'Iowa', 'Nevada', 'Arkansas', 'Mississippi', 'Kansas',
    'New Mexico', 'Nebraska', 'Idaho', 'West Virginia', 'Hawaii', 'New Hampshire', 'Maine',
    'Montana', 'Rhode Island', 'Delaware', 'South Dakota', 'North Dakota', 'Alaska',
    'Vermont', 'Wyoming', 'District of Columbia',
  ],
});

/** Regiones del país; lista vacía cuando no hay datos (el plan queda nacional). */
export function resolveTavilyCountryRegions(countryCode: string | null | undefined): readonly string[] {
  const code = countryCode?.trim().toUpperCase() ?? '';
  return TAVILY_COUNTRY_REGIONS[code] ?? [];
}
