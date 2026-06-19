/**
 * Socrata Colombia Connector — Normalizers
 *
 * Un normalizador por dataset. Mapea campos conocidos al tipo común.
 * No guarda raw completo. No incluye PII innecesaria.
 * Los campos pueden variar por dataset — se accede con coerción segura.
 */

import { SOCRATA_COLOMBIA_DATASETS } from './datasets';
import type { NormalizedColombiaCompanySample } from './types';

type RawRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

// ─── CIIU Rev.4 — Descripción de sectores (Colombia / DANE) ──────────────────
// Lookup estático de los códigos CIIU más frecuentes en el RUES colombiano.
// Fuente: DANE CIIU Rev.4 adaptación Colombia (dato público verificable).
// No es exhaustivo — cubre las secciones más relevantes para targeting B2B.

const CIIU_SECTOR_DESCRIPTIONS: Record<string, string> = {
  // Sección A — Agricultura, ganadería, silvicultura y pesca
  '0111': 'Cultivo de cereales', '0112': 'Cultivo de arroz', '0113': 'Cultivo de hortalizas',
  '0114': 'Cultivo de tabaco', '0119': 'Otros cultivos agrícolas', '0121': 'Cultivo de uvas',
  '0122': 'Cultivo de frutas tropicales', '0123': 'Cultivo de cítricos', '0124': 'Cultivo de frutas',
  '0125': 'Cultivos mixtos', '0126': 'Cultivo de palma de aceite', '0127': 'Cultivo de plantas aromáticas',
  '0128': 'Especias y cultivos industriales', '0129': 'Otros cultivos permanentes',
  '0141': 'Cría de ganado bovino', '0142': 'Cría de caballos', '0143': 'Cría de camellos',
  '0144': 'Cría de ovejas y cabras', '0145': 'Cría de cerdos', '0146': 'Cría de aves de corral',
  '0149': 'Cría de otros animales', '0150': 'Cultivo de productos agrícolas en combinación con cría de animales',
  '0161': 'Actividades de apoyo a la agricultura', '0162': 'Actividades de apoyo a la ganadería',
  '0163': 'Actividades poscosecha', '0170': 'Caza ordinaria', '0210': 'Silvicultura',
  '0220': 'Extracción de madera', '0240': 'Servicios de apoyo a la silvicultura',
  '0311': 'Pesca marítima', '0312': 'Pesca de agua dulce', '0321': 'Acuicultura marítima',
  '0322': 'Acuicultura de agua dulce',
  // Sección B — Explotación de minas y canteras
  '0510': 'Extracción de carbón', '0520': 'Extracción de lignito', '0610': 'Extracción de petróleo crudo',
  '0620': 'Extracción de gas natural', '0710': 'Extracción de minerales de hierro',
  '0721': 'Extracción de minerales de uranio', '0729': 'Extracción de otros minerales metalíferos no ferrosos',
  '0811': 'Extracción de piedra, arena y arcilla', '0899': 'Extracción de otros minerales no metálicos',
  '0910': 'Actividades de apoyo para la extracción de petróleo y gas natural',
  '0990': 'Actividades de apoyo para otras actividades de explotación de minas y canteras',
  // Sección C — Industrias manufactureras
  '1011': 'Procesamiento y conservación de carne', '1012': 'Procesamiento y conservación de pescado',
  '1020': 'Procesamiento y conservación de frutas y verduras', '1030': 'Elaboración de aceites y grasas',
  '1040': 'Elaboración de productos lácteos', '1050': 'Elaboración de productos de molinería',
  '1061': 'Trilla de café', '1062': 'Descafeinado, tostión y molienda del café',
  '1063': 'Otros derivados del café', '1071': 'Elaboración y refinación de azúcar',
  '1072': 'Elaboración de panela', '1081': 'Elaboración de productos de panadería',
  '1082': 'Elaboración de cacao y chocolate', '1083': 'Elaboración de macarrones y fideos',
  '1084': 'Elaboración de comidas y platos preparados', '1089': 'Elaboración de otros productos alimenticios',
  '1090': 'Elaboración de alimentos preparados para animales', '1101': 'Destilación de bebidas alcohólicas',
  '1102': 'Elaboración de bebidas fermentadas no destiladas', '1103': 'Producción de malta',
  '1104': 'Elaboración de bebidas no alcohólicas', '1200': 'Elaboración de productos de tabaco',
  '1310': 'Preparación e hilatura de fibras textiles', '1320': 'Tejeduría de productos textiles',
  '1330': 'Acabado de productos textiles', '1391': 'Fabricación de tejidos de punto y ganchillo',
  '1392': 'Confección de artículos con materiales textiles', '1393': 'Fabricación de tapices',
  '1399': 'Fabricación de otros productos textiles', '1410': 'Confección de prendas de vestir',
  '1420': 'Fabricación de artículos de piel', '1430': 'Fabricación de artículos de punto y ganchillo',
  '1511': 'Curtido y recurtido de cueros', '1512': 'Fabricación de artículos de viaje',
  '1521': 'Fabricación de calzado de cuero', '1522': 'Fabricación de calzado de materiales textiles',
  '1610': 'Aserrado, acepillado e impregnación de la madera',
  '1620': 'Fabricación de hojas de madera para enchapado',
  '1630': 'Fabricación de partes y piezas de madera para la construcción',
  '1640': 'Fabricación de recipientes de madera', '1690': 'Fabricación de otros productos de madera',
  '1701': 'Fabricación de pulpa (pasta) celulósica',
  '1702': 'Fabricación de papel y cartón ondulado',
  '1709': 'Fabricación de otros artículos de papel y cartón',
  '1811': 'Actividades de impresión', '1812': 'Actividades de servicios relacionados con la impresión',
  '1820': 'Reproducción de grabaciones',
  '1910': 'Fabricación de productos de hornos de coque',
  '1921': 'Fabricación de productos de la refinación del petróleo',
  '2011': 'Fabricación de sustancias y productos químicos básicos',
  '2012': 'Fabricación de abonos y compuestos inorgánicos nitrogenados',
  '2013': 'Fabricación de plásticos en formas primarias',
  '2021': 'Fabricación de plaguicidas y productos agroquímicos',
  '2022': 'Fabricación de pinturas, barnices y revestimientos similares',
  '2023': 'Fabricación de jabones y preparados para limpiar',
  '2029': 'Fabricación de otros productos químicos',
  '2030': 'Fabricación de fibras sintéticas',
  '2100': 'Fabricación de productos farmacéuticos',
  '2211': 'Fabricación de llantas y neumáticos de caucho',
  '2212': 'Reencauche de llantas usadas',
  '2219': 'Fabricación de otros productos de caucho',
  '2221': 'Fabricación de formas básicas de plástico',
  '2229': 'Fabricación de artículos de plástico',
  '2310': 'Fabricación de vidrio y productos de vidrio',
  '2391': 'Fabricación de productos refractarios',
  '2392': 'Fabricación de materiales de arcilla para la construcción',
  '2393': 'Fabricación de otros artículos de cerámica',
  '2394': 'Fabricación de cemento, cal y yeso',
  '2395': 'Fabricación de artículos de hormigón',
  '2396': 'Corte, tallado y acabado de la piedra',
  '2399': 'Fabricación de otros productos minerales no metálicos',
  '2410': 'Industrias básicas de hierro y de acero',
  '2421': 'Industrias básicas de metales preciosos',
  '2429': 'Industrias básicas de otros metales no ferrosos',
  '2431': 'Fundición de hierro y acero',
  '2511': 'Fabricación de productos metálicos para uso estructural',
  '2512': 'Fabricación de tanques, depósitos y recipientes de metal',
  '2591': 'Forja, prensado, estampado y laminado de metal',
  '2599': 'Fabricación de otros productos elaborados de metal',
  '2610': 'Fabricación de componentes y tableros electrónicos',
  '2620': 'Fabricación de computadoras y equipo periférico',
  '2630': 'Fabricación de equipos de comunicación',
  '2640': 'Fabricación de aparatos electrónicos de consumo',
  '2651': 'Fabricación de instrumentos y aparatos para medir',
  '2660': 'Fabricación de equipo de irradiación',
  '2670': 'Fabricación de instrumentos ópticos',
  '2680': 'Fabricación de medios magnéticos y ópticos',
  '2711': 'Fabricación de motores eléctricos',
  '2712': 'Fabricación de aparatos de distribución y control de energía',
  '2720': 'Fabricación de pilas, baterías y acumuladores',
  '2731': 'Fabricación de cables de fibra óptica',
  '2732': 'Fabricación de otros hilos y cables eléctricos',
  '2733': 'Fabricación de dispositivos de cableado',
  '2740': 'Fabricación de equipos eléctricos de iluminación',
  '2750': 'Fabricación de aparatos de uso doméstico',
  '2790': 'Fabricación de otros tipos de equipo eléctrico',
  '2811': 'Fabricación de motores y turbinas',
  '2812': 'Fabricación de equipos de potencia hidráulica y neumática',
  '2813': 'Fabricación de otras bombas y compresores',
  '2814': 'Fabricación de cojinetes, engranajes y partes de transmisión',
  '2815': 'Fabricación de hornos, calderas industriales',
  '2816': 'Fabricación de equipo de elevación y manipulación',
  '2817': 'Fabricación de maquinaria y equipo de oficina',
  '2818': 'Fabricación de herramientas manuales con motor',
  '2819': 'Fabricación de otros tipos de maquinaria de uso general',
  '2821': 'Fabricación de maquinaria agropecuaria',
  '2822': 'Fabricación de máquinas herramienta para trabajar metales',
  '2823': 'Fabricación de maquinaria para la metalurgia',
  '2824': 'Fabricación de maquinaria para minería',
  '2825': 'Fabricación de maquinaria para la elaboración de alimentos',
  '2826': 'Fabricación de maquinaria para la elaboración de textiles',
  '2829': 'Fabricación de otros tipos de maquinaria de uso especial',
  '2910': 'Fabricación de vehículos automotores',
  '2920': 'Fabricación de carrocerías para vehículos automotores',
  '2930': 'Fabricación de partes, piezas y accesorios para vehículos',
  '3011': 'Construcción de barcos y estructuras flotantes',
  '3020': 'Fabricación de locomotoras y de material rodante para ferrocarriles',
  '3030': 'Fabricación de aeronaves, naves espaciales',
  '3040': 'Fabricación de vehículos militares de combate',
  '3091': 'Fabricación de motocicletas', '3092': 'Fabricación de bicicletas',
  '3099': 'Fabricación de otros tipos de equipo de transporte',
  '3100': 'Fabricación de muebles', '3211': 'Fabricación de joyas y artículos conexos',
  '3212': 'Fabricación de bisutería', '3220': 'Fabricación de instrumentos musicales',
  '3230': 'Fabricación de artículos y equipos para la práctica del deporte',
  '3240': 'Fabricación de juegos y juguetes',
  '3250': 'Fabricación de instrumentos y materiales médicos y odontológicos',
  '3290': 'Otras industrias manufactureras',
  '3311': 'Mantenimiento y reparación especializada de productos elaborados de metal',
  '3312': 'Mantenimiento y reparación especializada de maquinaria y equipo',
  '3313': 'Mantenimiento y reparación especializada de equipo electrónico',
  '3320': 'Instalación especializada de maquinaria y equipo industrial',
  // Sección D — Suministro de electricidad, gas, vapor y aire acondicionado
  '3511': 'Generación de energía eléctrica', '3512': 'Transmisión de energía eléctrica',
  '3513': 'Distribución de energía eléctrica', '3514': 'Comercialización de energía eléctrica',
  '3520': 'Producción de gas, distribución de combustibles gaseosos',
  '3530': 'Suministro de vapor y de aire acondicionado',
  // Sección E — Distribución de agua, evacuación y tratamiento de aguas
  '3600': 'Captación, tratamiento y distribución de agua',
  '3700': 'Evacuación y tratamiento de aguas residuales',
  '3811': 'Recolección de desechos no peligrosos',
  '3812': 'Recolección de desechos peligrosos',
  '3821': 'Tratamiento y disposición de desechos no peligrosos',
  '3822': 'Tratamiento y disposición de desechos peligrosos',
  '3830': 'Recuperación de materiales', '3900': 'Actividades de saneamiento ambiental',
  // Sección F — Construcción
  '4111': 'Construcción de edificios residenciales',
  '4112': 'Construcción de edificios no residenciales',
  '4210': 'Construcción de carreteras y líneas de ferrocarril',
  '4220': 'Construcción de proyectos de servicio público',
  '4290': 'Construcción de otras obras de ingeniería civil',
  '4311': 'Demolición', '4312': 'Preparación del terreno',
  '4321': 'Instalaciones eléctricas', '4322': 'Instalaciones de fontanería',
  '4329': 'Otras instalaciones especializadas para edificios',
  '4330': 'Terminación y acabado de edificios y obras de ingeniería civil',
  '4390': 'Otras actividades especializadas de construcción',
  // Sección G — Comercio al por mayor y al por menor
  '4511': 'Comercio de vehículos automotores nuevos',
  '4512': 'Comercio de vehículos automotores usados',
  '4520': 'Mantenimiento y reparación de vehículos automotores',
  '4530': 'Comercio de partes, piezas y accesorios para vehículos automotores',
  '4541': 'Comercio de motocicletas nuevas', '4542': 'Comercio de motocicletas usadas',
  '4543': 'Mantenimiento y reparación de motocicletas',
  '4611': 'Intermediarios del comercio de materias primas agropecuarias',
  '4612': 'Intermediarios del comercio de combustibles',
  '4613': 'Intermediarios del comercio de madera y materiales de construcción',
  '4614': 'Intermediarios del comercio de maquinaria',
  '4615': 'Intermediarios del comercio de muebles',
  '4616': 'Intermediarios del comercio de productos textiles',
  '4617': 'Intermediarios del comercio de alimentos',
  '4618': 'Intermediarios del comercio de productos especializados',
  '4619': 'Intermediarios del comercio de mercancías varias',
  '4620': 'Comercio al por mayor de materias primas agropecuarias',
  '4631': 'Comercio al por mayor de productos alimenticios',
  '4632': 'Comercio al por mayor de bebidas y tabaco',
  '4641': 'Comercio al por mayor de productos textiles',
  '4642': 'Comercio al por mayor de prendas de vestir',
  '4643': 'Comercio al por mayor de aparatos electrodomésticos',
  '4644': 'Comercio al por mayor de aparatos e instrumentos médicos',
  '4645': 'Comercio al por mayor de productos farmacéuticos',
  '4649': 'Comercio al por mayor de otros enseres domésticos',
  '4651': 'Comercio al por mayor de computadoras y equipos de telecomunicaciones',
  '4652': 'Comercio al por mayor de maquinaria y equipo',
  '4653': 'Comercio al por mayor de madera y materiales de construcción',
  '4654': 'Comercio al por mayor de materiales ferretería',
  '4659': 'Comercio al por mayor de otros tipos de maquinaria',
  '4661': 'Comercio al por mayor de combustibles',
  '4662': 'Comercio al por mayor de metales y minerales',
  '4663': 'Comercio al por mayor de materiales de construcción',
  '4664': 'Comercio al por mayor de productos químicos',
  '4665': 'Comercio al por mayor de desperdicios y desechos',
  '4669': 'Comercio al por mayor de otros productos',
  '4690': 'Comercio al por mayor no especializado',
  '4711': 'Comercio al por menor en establecimientos de alimentos',
  '4712': 'Comercio al por menor de productos alimenticios',
  '4713': 'Comercio al por menor en grandes superficies',
  '4719': 'Comercio al por menor no especializado',
  '4721': 'Comercio al por menor de productos alimenticios',
  '4722': 'Comercio al por menor de bebidas',
  '4723': 'Comercio al por menor de tabaco',
  '4731': 'Comercio al por menor de combustibles',
  '4741': 'Comercio al por menor de computadoras',
  '4742': 'Comercio al por menor de equipos de telecomunicaciones',
  '4743': 'Comercio al por menor de equipos de audio y video',
  '4751': 'Comercio al por menor de productos textiles',
  '4752': 'Comercio al por menor de ferretería',
  '4753': 'Comercio al por menor de tapices y alfombras',
  '4754': 'Comercio al por menor de electrodomésticos',
  '4755': 'Comercio al por menor de muebles y colchones',
  '4759': 'Comercio al por menor de otros artículos domésticos',
  '4761': 'Comercio al por menor de libros',
  '4762': 'Comercio al por menor de periódicos',
  '4763': 'Comercio al por menor de equipos deportivos',
  '4764': 'Comercio al por menor de juegos y juguetes',
  '4771': 'Comercio al por menor de prendas de vestir',
  '4772': 'Comercio al por menor de calzado',
  '4773': 'Comercio al por menor de productos farmacéuticos',
  '4774': 'Comercio al por menor de artículos médicos',
  '4775': 'Comercio al por menor de cosméticos',
  '4781': 'Comercio al por menor de alimentos en puestos móviles',
  '4789': 'Comercio al por menor en otros puestos de venta',
  '4791': 'Comercio al por menor por correo y por internet',
  '4792': 'Comercio al por menor de otros artículos de venta',
  '4799': 'Otros tipos de comercio al por menor',
  // Sección H — Transporte y almacenamiento
  '4911': 'Transporte férreo de pasajeros', '4912': 'Transporte férreo de carga',
  '4921': 'Transporte de pasajeros por vía terrestre',
  '4922': 'Transporte mixto de pasajeros por vía terrestre',
  '4923': 'Transporte de carga por carretera',
  '4924': 'Transporte de carga por carretera especializado',
  '4930': 'Transporte por oleoductos y gasoductos',
  '5011': 'Transporte marítimo y de cabotaje de pasajeros',
  '5012': 'Transporte marítimo y de cabotaje de carga',
  '5021': 'Transporte fluvial de pasajeros', '5022': 'Transporte fluvial de carga',
  '5111': 'Transporte aéreo nacional de pasajeros',
  '5112': 'Transporte aéreo internacional de pasajeros',
  '5121': 'Transporte aéreo nacional de carga',
  '5122': 'Transporte aéreo internacional de carga',
  '5210': 'Almacenamiento y depósito', '5221': 'Actividades de servicios para el transporte terrestre',
  '5222': 'Actividades de servicios para el transporte acuático',
  '5223': 'Actividades de servicios para el transporte aéreo',
  '5224': 'Manipulación de carga', '5229': 'Otras actividades complementarias al transporte',
  '5310': 'Actividades postales', '5320': 'Actividades de mensajería',
  // Sección I — Alojamiento y servicios de comida
  '5511': 'Alojamiento en hoteles', '5512': 'Alojamiento en apartahoteles',
  '5513': 'Alojamiento en centros vacacionales',
  '5514': 'Alojamiento rural', '5519': 'Otros tipos de alojamiento',
  '5520': 'Actividades de zonas de camping y parques para vehículos',
  '5530': 'Servicio por horas', '5590': 'Otros tipos de alojamiento',
  '5611': 'Expendio a la mesa de comidas preparadas',
  '5612': 'Expendio por autoservicio de comidas preparadas',
  '5613': 'Expendio de comidas preparadas en cafeterías',
  '5619': 'Otros tipos de expendio de comidas preparadas',
  '5621': 'Catering para eventos', '5629': 'Actividades de otros servicios de comidas',
  '5630': 'Expendio de bebidas alcohólicas para el consumo dentro del establecimiento',
  // Sección J — Información y comunicaciones
  '5811': 'Edición de libros', '5812': 'Edición de directorios y listas de correo',
  '5813': 'Edición de periódicos y revistas', '5819': 'Otros trabajos de edición',
  '5820': 'Edición de programas de informática (software)',
  '5911': 'Actividades de producción de películas cinematográficas',
  '5912': 'Actividades de posproducción de películas',
  '5913': 'Actividades de distribución de películas cinematográficas',
  '5914': 'Actividades de exhibición de películas cinematográficas',
  '5920': 'Actividades de grabación de sonido y edición de música',
  '6010': 'Actividades de programación y transmisión de radio',
  '6020': 'Actividades de programación y transmisión de televisión',
  '6110': 'Actividades de telecomunicaciones alámbricas',
  '6120': 'Actividades de telecomunicaciones inalámbricas',
  '6130': 'Actividades de telecomunicación satelital',
  '6190': 'Otras actividades de telecomunicaciones',
  '6201': 'Actividades de desarrollo de sistemas informáticos',
  '6202': 'Actividades de consultoría informática',
  '6209': 'Otras actividades de tecnología de la información',
  '6311': 'Procesamiento de datos, alojamiento (hosting) y actividades relacionadas',
  '6312': 'Portales web',
  '6391': 'Actividades de agencias de noticias',
  '6399': 'Otras actividades de servicios de información',
  // Sección K — Actividades financieras y de seguros
  '6411': 'Banco Central', '6412': 'Bancos comerciales', '6421': 'Actividades de las corporaciones financieras',
  '6422': 'Actividades de las compañías de financiamiento',
  '6423': 'Banca de segundo piso', '6424': 'Actividades de las cooperativas de ahorro y crédito',
  '6431': 'Fondos de cesantías', '6432': 'Fondos de pensiones',
  '6491': 'Arrendamiento financiero (leasing financiero)',
  '6492': 'Actividades financieras de fondos de empleados',
  '6493': 'Actividades de compañías de factoring', '6494': 'Otras actividades de crédito',
  '6499': 'Otras actividades de servicios financieros',
  '6511': 'Seguros generales', '6512': 'Seguros de vida',
  '6513': 'Seguros de salud', '6521': 'Reaseguros',
  '6531': 'Fondos de riesgos laborales', '6532': 'Actividades de fondos de pensiones',
  '6611': 'Administración de mercados financieros',
  '6612': 'Corretaje de valores y de contratos de productos básicos',
  '6613': 'Otras actividades relacionadas con el mercado de valores',
  '6621': 'Actividades de agentes y corredores de seguros',
  '6629': 'Otras actividades auxiliares de las actividades de seguros',
  '6630': 'Actividades de administración de fondos',
  // Sección L — Actividades inmobiliarias
  '6810': 'Actividades inmobiliarias realizadas con bienes propios o arrendados',
  '6820': 'Actividades inmobiliarias realizadas a cambio de una retribución o por contrato',
  // Sección M — Actividades profesionales, científicas y técnicas
  '6910': 'Actividades jurídicas', '6920': 'Actividades de contabilidad y auditoría',
  '7010': 'Actividades de administración empresarial',
  '7020': 'Actividades de relaciones públicas y comunicación',
  '7110': 'Actividades de arquitectura e ingeniería',
  '7120': 'Ensayos y análisis técnicos',
  '7210': 'Investigación y desarrollo experimental en el campo de las ciencias naturales',
  '7220': 'Investigación y desarrollo experimental en el campo de las ciencias sociales',
  '7310': 'Publicidad', '7320': 'Estudios de mercado y encuestas de opinión pública',
  '7410': 'Actividades especializadas de diseño',
  '7420': 'Actividades de fotografía', '7490': 'Otras actividades profesionales, científicas y técnicas',
  '7500': 'Actividades veterinarias',
  // Sección N — Actividades de servicios administrativos y de apoyo
  '7710': 'Alquiler y arrendamiento de vehículos automotores',
  '7721': 'Alquiler y arrendamiento de equipo recreativo y deportivo',
  '7722': 'Alquiler de videos y discos', '7729': 'Alquiler y arrendamiento de otros efectos personales',
  '7730': 'Alquiler y arrendamiento de otros tipos de maquinaria',
  '7740': 'Arrendamiento de propiedad intelectual',
  '7810': 'Actividades de agencias de empleo',
  '7820': 'Actividades de agencias de empleo temporal',
  '7830': 'Otras actividades de dotación de recursos humanos',
  '7911': 'Actividades de agencias de viajes',
  '7912': 'Actividades de operadores turísticos',
  '7990': 'Otros servicios de reserva y actividades relacionadas',
  '8010': 'Actividades de seguridad privada',
  '8020': 'Actividades de sistemas de seguridad',
  '8030': 'Actividades de detectives e investigadores privados',
  '8110': 'Actividades combinadas de apoyo a instalaciones',
  '8121': 'Limpieza general de edificios', '8129': 'Otras actividades de limpieza de edificios',
  '8130': 'Actividades de paisajismo y servicios de mantenimiento conexos',
  '8211': 'Actividades combinadas de servicios administrativos de oficina',
  '8219': 'Fotocopiado, preparación de documentos y otras actividades especializadas',
  '8220': 'Actividades de centros de llamadas', '8230': 'Organización de eventos',
  '8291': 'Actividades de agencias de cobranza',
  '8292': 'Actividades de envase y empaque', '8299': 'Otras actividades de servicio de apoyo a las empresas',
  // Sección O — Administración pública
  '8411': 'Actividades legislativas de la administración pública',
  '8412': 'Actividades ejecutivas de la administración pública',
  '8413': 'Regulación de las actividades de organismos que prestan servicios públicos',
  '8421': 'Relaciones exteriores', '8422': 'Actividades de defensa',
  '8423': 'Actividades de mantenimiento del orden público',
  '8424': 'Actividades de administración de justicia',
  '8430': 'Actividades de planes de seguridad social',
  // Sección P — Educación
  '8511': 'Educación de la primera infancia',
  '8512': 'Educación básica primaria', '8513': 'Educación básica secundaria',
  '8521': 'Educación media académica', '8522': 'Educación media técnica y de formación laboral',
  '8530': 'Establecimientos que combinan diferentes niveles de educación',
  '8541': 'Educación técnica y tecnológica superior',
  '8542': 'Educación universitaria', '8543': 'Educación de posgrado',
  '8549': 'Otros tipos de educación de nivel superior',
  '8551': 'Formación para el trabajo', '8552': 'Formación académica no formal',
  '8553': 'Enseñanza deportiva y recreativa',
  '8559': 'Otros tipos de educación no formal',
  '8560': 'Actividades de apoyo a la educación',
  // Sección Q — Actividades de atención de la salud humana
  '8610': 'Actividades de hospitales y clínicas',
  '8621': 'Actividades de la práctica médica, sin internación',
  '8622': 'Actividades de la práctica odontológica',
  '8691': 'Actividades de apoyo diagnóstico',
  '8692': 'Actividades de apoyo terapéutico', '8699': 'Otras actividades de atención relacionadas con la salud',
  '8710': 'Actividades de atención residencial medicalizada de tipo general',
  '8720': 'Actividades de atención residencial, déficit cognitivo',
  '8730': 'Actividades de atención en instituciones para adultos mayores',
  '8790': 'Otras actividades de atención en instituciones con alojamiento',
  '8810': 'Actividades de asistencia social sin alojamiento para personas mayores',
  '8890': 'Otras actividades de asistencia social sin alojamiento',
  // Sección R — Actividades artísticas, de entretenimiento y recreación
  '9001': 'Creación literaria', '9002': 'Creación musical', '9003': 'Creación teatral',
  '9004': 'Creación audiovisual', '9005': 'Artes plásticas y visuales',
  '9006': 'Actividades teatrales', '9007': 'Músicos y cantantes',
  '9008': 'Otras actividades artísticas', '9101': 'Actividades de bibliotecas',
  '9102': 'Actividades de museos', '9103': 'Actividades de jardines botánicos y zoológicos',
  '9200': 'Actividades de juegos de azar y apuestas',
  '9311': 'Gestión de instalaciones deportivas',
  '9312': 'Actividades de clubes deportivos', '9319': 'Otras actividades deportivas',
  '9321': 'Actividades de parques de atracciones y parques temáticos',
  '9329': 'Otras actividades recreativas y de esparcimiento',
  // Sección S — Otras actividades de servicios
  '9411': 'Actividades de organizaciones empresariales y de empleadores',
  '9412': 'Actividades de organizaciones profesionales',
  '9420': 'Actividades de sindicatos de empleados',
  '9491': 'Actividades de organizaciones religiosas',
  '9492': 'Actividades de organizaciones políticas',
  '9499': 'Actividades de otras organizaciones',
  '9511': 'Mantenimiento y reparación de computadoras y equipos periféricos',
  '9512': 'Mantenimiento y reparación de equipos de comunicación',
  '9521': 'Mantenimiento y reparación de aparatos electrónicos de consumo',
  '9522': 'Mantenimiento y reparación de aparatos y equipos domésticos',
  '9523': 'Reparación de calzado y artículos de cuero',
  '9524': 'Reparación de muebles y accesorios para el hogar',
  '9529': 'Mantenimiento y reparación de otros efectos personales',
  '9601': 'Lavado y limpieza de prendas de tela y de piel',
  '9602': 'Peluquería y otros tratamientos de belleza',
  '9603': 'Pompas fúnebres y actividades relacionadas',
  '9609': 'Otras actividades de servicios personales',
};

/**
 * Retorna la descripción del sector CIIU dado un código de 4 dígitos.
 * Primero busca match exacto; luego la sección por los primeros 2 dígitos.
 * Fuente: DANE CIIU Rev.4 (dato público). No inventa datos.
 */
export function getCiiuSectorDescription(code: string | null): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  const exact = CIIU_SECTOR_DESCRIPTIONS[trimmed];
  if (exact) return exact;
  // Intentar por primeros 3 dígitos (grupo)
  const group3 = trimmed.slice(0, 3);
  const byGroup3 = Object.entries(CIIU_SECTOR_DESCRIPTIONS).find(
    ([k]) => k.startsWith(group3)
  );
  if (byGroup3) return byGroup3[1];
  // Intentar por primeros 2 dígitos (clase)
  const class2 = trimmed.slice(0, 2);
  const byClass2 = Object.entries(CIIU_SECTOR_DESCRIPTIONS).find(
    ([k]) => k.startsWith(class2)
  );
  if (byClass2) return byClass2[1];
  return null;
}

// ─── Cámara de Comercio → Ciudad (Colombia) ──────────────────────────────────
// El campo camara_comercio del RUES contiene el nombre de la Cámara de Comercio
// que corresponde directamente a la ciudad donde está registrada la empresa.

const CAMARA_TO_CITY: Record<string, string> = {
  'BOGOTA': 'Bogotá', 'BOGOTÁ': 'Bogotá', 'BOGOTA D.C': 'Bogotá',
  'BOGOTÁ D.C': 'Bogotá', 'BOGOTA DC': 'Bogotá', 'BOGOTÁ DC': 'Bogotá',
  'MEDELLIN': 'Medellín', 'MEDELLÍN': 'Medellín',
  'CALI': 'Cali', 'BARRANQUILLA': 'Barranquilla',
  'CARTAGENA': 'Cartagena', 'CARTAGENA DE INDIAS': 'Cartagena',
  'BUCARAMANGA': 'Bucaramanga', 'CUCUTA': 'Cúcuta', 'CÚCUTA': 'Cúcuta',
  'PEREIRA': 'Pereira', 'ARMENIA': 'Armenia', 'MANIZALES': 'Manizales',
  'IBAGUE': 'Ibagué', 'IBAGUÉ': 'Ibagué',
  'SANTA MARTA': 'Santa Marta', 'VILLAVICENCIO': 'Villavicencio',
  'MONTERIA': 'Montería', 'MONTERÍA': 'Montería',
  'PASTO': 'Pasto', 'NEIVA': 'Neiva', 'TUNJA': 'Tunja',
  'POPAYAN': 'Popayán', 'POPAYÁN': 'Popayán',
  'VALLEDUPAR': 'Valledupar', 'SINCELEJO': 'Sincelejo',
  'FLORENCIA': 'Florencia', 'QUIBDO': 'Quibdó', 'QUIBDÓ': 'Quibdó',
  'RIOHACHA': 'Riohacha', 'SAN ANDRES': 'San Andrés', 'SAN ANDRÉS': 'San Andrés',
  'YOPAL': 'Yopal', 'ARAUCA': 'Arauca', 'MOCOA': 'Mocoa',
  'LETICIA': 'Leticia', 'INIRIDA': 'Inírida', 'INÍRIDA': 'Inírida',
  'MITU': 'Mitú', 'MITÚ': 'Mitú', 'PUERTO CARRENO': 'Puerto Carreño',
  'PUERTO CARREÑO': 'Puerto Carreño',
  'BELLO': 'Bello', 'ITAGUI': 'Itagüí', 'ITAGÜÍ': 'Itagüí',
  'ENVIGADO': 'Envigado', 'SOLEDAD': 'Soledad',
  'SOACHA': 'Soacha', 'PALMIRA': 'Palmira', 'BUENAVENTURA': 'Buenaventura',
  'BARRANCABERMEJA': 'Barrancabermeja',
  'GIRARDOT': 'Girardot', 'SOGAMOSO': 'Sogamoso', 'DUITAMA': 'Duitama',
  'BUGA': 'Buga', 'TULUA': 'Tuluá', 'TULUÁ': 'Tuluá',
  'CARTAGO': 'Cartago', 'APARTADO': 'Apartadó', 'APARTADÓ': 'Apartadó',
};

const CAMARA_TO_DEPARTMENT: Record<string, string> = {
  'BOGOTA': 'Cundinamarca', 'BOGOTÁ': 'Cundinamarca', 'BOGOTA D.C': 'Bogotá D.C.',
  'MEDELLIN': 'Antioquia', 'MEDELLÍN': 'Antioquia',
  'CALI': 'Valle del Cauca', 'BARRANQUILLA': 'Atlántico',
  'CARTAGENA': 'Bolívar', 'BUCARAMANGA': 'Santander',
  'CUCUTA': 'Norte de Santander', 'PEREIRA': 'Risaralda',
  'ARMENIA': 'Quindío', 'MANIZALES': 'Caldas',
  'IBAGUE': 'Tolima', 'SANTA MARTA': 'Magdalena',
  'VILLAVICENCIO': 'Meta', 'MONTERIA': 'Córdoba',
  'PASTO': 'Nariño', 'NEIVA': 'Huila', 'TUNJA': 'Boyacá',
  'POPAYAN': 'Cauca', 'VALLEDUPAR': 'Cesar', 'SINCELEJO': 'Sucre',
  'FLORENCIA': 'Caquetá', 'QUIBDO': 'Chocó',
  'RIOHACHA': 'La Guajira', 'SAN ANDRES': 'San Andrés y Providencia',
  'YOPAL': 'Casanare', 'ARAUCA': 'Arauca', 'MOCOA': 'Putumayo',
  'LETICIA': 'Amazonas', 'INIRIDA': 'Guainía',
  'MITU': 'Vaupés', 'PUERTO CARRENO': 'Vichada',
  'BELLO': 'Antioquia', 'ITAGUI': 'Antioquia', 'ENVIGADO': 'Antioquia',
  'SOLEDAD': 'Atlántico', 'SOACHA': 'Cundinamarca',
  'PALMIRA': 'Valle del Cauca', 'BUENAVENTURA': 'Valle del Cauca',
  'BARRANCABERMEJA': 'Santander', 'GIRARDOT': 'Cundinamarca',
  'SOGAMOSO': 'Boyacá', 'DUITAMA': 'Boyacá',
  'TULUA': 'Valle del Cauca', 'CARTAGO': 'Valle del Cauca',
  'APARTADO': 'Antioquia',
};

/**
 * Extrae ciudad y departamento del campo camara_comercio del RUES.
 * Normaliza quitando acentos y espacios extra antes de buscar en la tabla.
 * Solo retorna valores conocidos — no inventa datos.
 */
function parseCamaraComercio(raw: string | null): { city: string | null; department: string | null } {
  if (!raw) return { city: null, department: null };

  // Normalizar: trim, uppercase, sin acentos para lookup
  const normalized = raw.trim().toUpperCase()
    .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
    .replace(/Ó/g, 'O').replace(/Ú/g, 'U').replace(/Ü/g, 'U');

  // Intentar match directo
  const directCity = CAMARA_TO_CITY[normalized] ?? CAMARA_TO_CITY[raw.trim().toUpperCase()];
  if (directCity) {
    const dept = CAMARA_TO_DEPARTMENT[normalized] ?? CAMARA_TO_DEPARTMENT[raw.trim().toUpperCase()] ?? null;
    return { city: directCity, department: dept };
  }

  // Intentar match por prefijo (el campo puede tener sufijos como " D.C.")
  const base = normalized.replace(/\s+D\.?C\.?$/, '').trim();
  const prefixCity = CAMARA_TO_CITY[base];
  if (prefixCity) {
    const dept = CAMARA_TO_DEPARTMENT[base] ?? null;
    return { city: prefixCity, department: dept };
  }

  // Si no hay match conocido, usar el valor original como city (mejor que null)
  // Se tituliza para presentación
  const titleCase = raw.trim().split(' ').map(
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
  return { city: titleCase, department: null };
}

// ─── RUES / Registro Mercantil ────────────────────────────────────────────────

export function normalizeRuesRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.rues;
  const camaraRaw = str(record.camara_comercio);
  const { city, department } = parseCamaraComercio(camaraRaw);
  const sectorCode = str(record.cod_ciiu_act_econ_pri);
  const sectorDescription = getCiiuSectorDescription(sectorCode);

  let taxId = str(record.numero_identificacion) || str(record.nit);
  const dv = str(record.digito_verificacion);
  if (taxId && dv) {
    taxId = `${taxId}-${dv}`;
  }

  return {
    source: 'rues',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.razon_social),
    taxId,
    legalStatus: str(record.estado_matricula),
    sectorCode,
    sectorDescription,
    city,
    department,
    address: null,
    email: null,
    phone: null,
    website: null,
    rawRecordId: str(record.matricula),
    sourceMetadata: {
      organizacion_juridica: str(record.organizacion_juridica),
      camara_comercio: camaraRaw,
      tipo_sociedad: str(record.tipo_sociedad),
      cod_ciiu_secundario: str(record.cod_ciiu_act_econ_sec),
    },
  };
}

// ─── SECOP Integrado ──────────────────────────────────────────────────────────

export function normalizeSecopRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.secop2;
  return {
    source: 'secop2',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.nom_raz_social_contratista),
    taxId: str(record.documento_proveedor),
    legalStatus: null,
    sectorCode: null,
    sectorDescription: str(record.objeto_a_contratar),
    city: str(record.municipio_entidad),
    department: str(record.departamento_entidad),
    address: null,
    email: null,
    phone: null,
    website: null,
    rawRecordId: str(record.id_contrato) ?? str(record.referencia_del_contrato),
    sourceMetadata: {
      tipo_documento_proveedor: str(record.tipo_documento_proveedor),
      valor_contrato: typeof record.valor_contrato === 'number' ? record.valor_contrato : null,
      entidad_contratante: str(record.nombre_entidad),
    },
  };
}

// ─── REPS MinSalud ────────────────────────────────────────────────────────────

export function normalizeRepsRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.reps;
  return {
    source: 'reps',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.nombreprestador),
    taxId: str(record.numeroidentificacion),
    legalStatus: str(record.estado),
    sectorCode: str(record.claseprestador),
    sectorDescription: str(record.tipoprestador),
    city: str(record.municipioprestadordesc),
    department: str(record.departamentoprestadordesc),
    address: str(record.direccionprestador),
    email: str(record.email_prestador),
    phone: str(record.telefonoprestador),
    website: null,
    rawRecordId: str(record.codigoprestador) ?? str(record.id),
    sourceMetadata: {
      naturaleza_juridica: str(record.naturalezajuridica),
      tipo_id: str(record.tipoid),
      clase_prestador: str(record.claseprestador),
    },
  };
}

// ─── Superfinanciera ──────────────────────────────────────────────────────────

export function normalizeSuperfinancieraRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.superfinanciera;
  return {
    source: 'superfinanciera',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.razon_social),
    taxId: str(record.numeroidentificacion) ?? str(record.nit),
    legalStatus: str(record.estado),
    sectorCode: str(record.tipo_entidad),
    sectorDescription: str(record.actividad_economica),
    city: str(record.ciudad),
    department: str(record.departamento),
    address: str(record.direccion),
    email: str(record.emailprincipal),
    phone: str(record.telefono),
    website: str(record.uripaginaweb),
    rawRecordId: str(record.id) ?? str(record.codigo_entidad),
    sourceMetadata: {
      representante_legal: str(record.representante_legal),
    },
  };
}

export function normalizeSecop2ProveedoresRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.secop2_proveedores;
  return {
    source: 'secop2_proveedores',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.nombre),
    taxId: str(record.nit),
    legalStatus: str(record.esta_activa),
    sectorCode: str(record.codigo_categoria_principal),
    sectorDescription: str(record.descripcion_categoria_principal),
    city: str(record.municipio),
    department: str(record.departamento),
    address: str(record.direccion),
    email: str(record.correo),
    phone: str(record.telefono),
    website: str(record.sitio_web),
    rawRecordId: str(record.nit),
    sourceMetadata: {
      tipo_empresa: str(record.tipo_empresa),
      espyme: str(record.espyme),
      nombre_representante_legal: str(record.nombre_representante_legal),
    },
  };
}

// ─── Personas Jurídicas Cámaras de Comercio ──────────────────────────────────

export function normalizePersonasJuridicasCCRecord(
  record: RawRecord,
): NormalizedColombiaCompanySample {
  const meta = SOCRATA_COLOMBIA_DATASETS.personas_juridicas_cc;
  const camaraRaw = str(record.camara_comercio);
  const { city, department } = parseCamaraComercio(camaraRaw);
  // Dataset uses cod_ciiu_act_econ_pri; accept also codigo_ciiu_act_econ_pri variant
  const sectorCode =
    str(record.codigo_ciiu_act_econ_pri) ?? str(record.cod_ciiu_act_econ_pri);
  const sectorDescription = getCiiuSectorDescription(sectorCode);

  return {
    source: 'personas_juridicas_cc',
    sourceKey: meta.sourceKey,
    datasetId: meta.datasetId,
    companyName: str(record.razon_social),
    taxId: str(record.numero_identificacion),
    legalStatus: str(record.estado_matricula),
    sectorCode,
    sectorDescription,
    city,
    department,
    address: null,
    email: null,
    phone: null,
    website: null,
    rawRecordId: str(record.numero_identificacion),
    sourceMetadata: {
      organizacion_juridica: str(record.organizacion_juridica),
      categoria_matricula: str(record.categoria_matricula),
      camara_comercio: camaraRaw,
      ultimo_ano_renovado: str(record.ultimo_ano_renovado),
    },
  };
}
