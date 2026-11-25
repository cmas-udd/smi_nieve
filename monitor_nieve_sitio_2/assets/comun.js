/* Funciones comunes del monitor de nieve: configuración, capas, mapa y gráficos. */
(function(){
'use strict';

/* ---------- Configuración ---------- */
const CONFIG = {
  // Clave de OpenWeatherMap. Se puede pegar aquí o ingresar en la página de pronóstico.
  // Ojo: en GitHub Pages esta clave queda visible para cualquiera que abra el código.
  OWM_API_KEY: 'd7acd3d8dbc634bc97eadbe2bbe3a54a',
  AOI: {s:-34.43, w:-70.88, n:-32.665, e:-69.074},
  ACTUALIZAR_MIN: 30,
  // Comentarios con IA: modelo de Anthropic. No pongas aquí una clave de API: el sitio es público.
  // Cada persona ingresa su clave en la página y queda guardada solo en su navegador.
  IA_MODELO: 'claude-haiku-5-5',
  // Línea de nieve en tormenta = isoterma 0 °C menos este desfase (Schauwecker et al. 2022).
  DESFASE_LINEA_NIEVE: 280
};

/* Subcuencas objetivo: punto de pronóstico en la parte alta de cada una. */
const CUENCAS = [
  {id:'aco', nom:'Aconcagua alto', lat:-32.87, lon:-70.15, cumbre:6000, ajuste:150, texto:/aconcagua|juncal|los andes/i},
  {id:'map', nom:'Mapocho alto',   lat:-33.30, lon:-70.25, cumbre:5400, ajuste:50,  texto:/mapocho|barnechea|farellones/i},
  {id:'mai', nom:'Maipo alto',     lat:-33.82, lon:-70.06, cumbre:6000, ajuste:0,   texto:/maipo|volc[aá]n|yeso/i},
  {id:'cac', nom:'Cachapoal alto', lat:-34.22, lon:-70.22, cumbre:5100, ajuste:-200, texto:/cachapoal|coya|teniente/i}
];
/* Línea de nieve de referencia por mes (m s.n.m.), aproximada para los Andes centrales.
   Es un supuesto de la maqueta: se reemplazará por la línea de nieve observada con MODIS o Sentinel-2. */
const LINEA_NIEVE_MES = [3900,4000,3900,3500,2900,2400,2200,2200,2400,2800,3200,3600];
function lineaNieveReferencia(c, fecha){
  const m = (fecha || new Date()).getMonth();
  return Math.round((LINEA_NIEVE_MES[m] + c.ajuste)/50)*50;
}

/* Lugares de estudio: donde se sufren las consecuencias, y cuenca alta donde se originan. */
const LUGARES = [
  {id:'portillo', nom:'Paso Los Libertadores y Portillo', corto:'Portillo', sitio:'Paso Los Libertadores / Portillo', origen:'aco', lat:-32.836, lon:-70.129},
  {id:'losandes', nom:'Los Andes y Calle Larga', corto:'Los Andes', lado:'izq', sitio:'Los Andes / Calle Larga', origen:'aco', lat:-32.834, lon:-70.598},
  {id:'farellones', nom:'Lo Barnechea y Farellones', corto:'Farellones', sitio:'Lo Barnechea / Farellones', origen:'map', lat:-33.357, lon:-70.312},
  {id:'santiago', nom:'Santiago y precordillera', corto:'Santiago', lado:'izq', sitio:'Santiago y precordillera', origen:'map', lat:-33.42, lon:-70.48},
  {id:'sjmaipo', nom:'San José de Maipo', corto:'San José de Maipo', sitio:'San José de Maipo', origen:'mai', lat:-33.641, lon:-70.352},
  {id:'coya', nom:'Machalí y Coya', corto:'Coya', sitio:'Machalí / Coya', origen:'cac', lat:-34.20, lon:-70.53},
  {id:'teniente', nom:'El Teniente', corto:'El Teniente', lado:'izq', sitio:'El Teniente', origen:'cac', lat:-34.084, lon:-70.383},
  {id:'donihue', nom:'Doñihue y Las Cabras', corto:'Doñihue', sitio:'Doñihue / Las Cabras', origen:'cac', lat:-34.23, lon:-70.96}
];
/* Consecuencias reconocidas en el texto de las noticias. */
const CONSECUENCIAS = [
  {k:'aluvion', nom:'Aluvión, alud o rodados', re:/aluvi|alud|deslizam|rodado|socav|ca[ií]da de roca/i},
  {k:'crecida', nom:'Crecida o desborde de río', re:/crecid|desbord|aumento del caudal/i},
  {k:'agua', nom:'Corte de agua potable por turbiedad', re:/turbied|corte de agua|cort[oó] el agua|esval|aguas andinas/i},
  {k:'ruta', nom:'Cierre o corte de rutas', re:/cierr|cerr[oóa]|suspend|bloque|interrump|cortad|ruta/i},
  {k:'aislados', nom:'Personas aisladas, evacuadas o rescatadas', re:/aislad|evacu|atrapad|rescat/i},
  {k:'avalancha', nom:'Avalancha', re:/avalanch|alud de nieve/i},
  {k:'luz', nom:'Cortes de electricidad', re:/luz|el[eé]ctric/i}
];
function consecuenciasDe(e){ const t = (e.tipo||'')+' '+(e.desc||''); return CONSECUENCIAS.filter(c=>c.re.test(t)).map(c=>c.k); }
function distanciaKm(a, b){
  const R = 6371, r = Math.PI/180, dLa = (b.lat-a.lat)*r, dLo = (b.lon-a.lon)*r;
  const h = Math.sin(dLa/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function rumbo(a, b){ // grados desde el norte, de a hacia b
  const r = Math.PI/180, y = Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);
  const x = Math.cos(a.lat*r)*Math.sin(b.lat*r) - Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);
  return (Math.atan2(y, x)/r + 360) % 360;
}
function difAngulo(a, b){ const d = Math.abs(a-b) % 360; return d > 180 ? 360-d : d; }

const FUENTES = [
  {nom:'Los Bronces (Anglo American)', cuenca:'Mapocho alto', lat:-33.15, lon:-70.29, part:'Polvo mineral; carbono negro diésel', patron:'Gradiente desde rajo y botaderos, a sotavento', estado:'Por mapear'},
  {nom:'Andina (Codelco)', cuenca:'Aconcagua alto', lat:-33.13, lon:-70.25, part:'Polvo mineral; carbono negro', patron:'Gradiente superpuesto al de Los Bronces', estado:'Por mapear'},
  {nom:'El Teniente (Codelco)', cuenca:'Cachapoal alto', lat:-34.09, lon:-70.38, part:'Polvo mineral; emisiones de fundición', patron:'Gradiente desde faena y fundición', estado:'Por mapear'},
  {nom:'Ruta CH-60, Paso Los Libertadores', cuenca:'Aconcagua alto', lat:-32.86, lon:-70.15, part:'Carbono negro de tránsito pesado', patron:'Mayor concentración a menos de 1 km del camino', estado:'Documentada (Aranda et al. 2023)'}
];

/* ---------- Colores ---------- */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = {};
['cat-a','cat-b','cat-c','cat-d','cat-e','e1','e2','e3','e4','rio','camino','fuente','borde-cuenca','estudio','hielo','roca','roca-2','roca-3','neblina','riesgo-alto','riesgo-medio','riesgo-bajo'].forEach(k=>COL[k]=css('--'+k));
const CAT = {
  A:{nom:'Lluvia sobre nieve', col:COL['cat-a']},
  B:{nom:'Tormenta cálida posible', col:COL['cat-b']},
  C:{nom:'Nieve fresca', col:COL['cat-c']},
  D:{nom:'Avalancha', col:COL['cat-d']},
  E:{nom:'Sin fenómeno', col:COL['cat-e']}
};
const BANDAS = [
  {k:'E1', nom:'E1, bajo 3.000 m', col:COL.e1},
  {k:'E2', nom:'E2, 3.000 a 4.000 m', col:COL.e2},
  {k:'E3', nom:'E3, 4.000 a 5.000 m', col:COL.e3},
  {k:'E4', nom:'E4, sobre 5.000 m', col:COL.e4}
];
// Paleta categórica validada (orden fijo, nunca se recicla; el resto va a "Otros").
const CATEGORICA = [COL['cat-c'], COL['cat-a'], COL['cat-b'], COL['cat-d']];
const OTROS = COL['cat-e'];
// Escala secuencial de un solo tono para conteos.
const SECUENCIAL = ['#E3EDF4','#A9C3D6','#6F97B6','#3F6E93','#1F4766'];

/* ---------- Formato ---------- */
const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIA = ['dom','lun','mar','mié','jue','vie','sáb'];
function num(v, dec=0){
  if (v==null || !isFinite(v)) return 'sin dato';
  return Number(v).toLocaleString('es-CL',{minimumFractionDigits:dec, maximumFractionDigits:dec});
}
function parseFecha(s){
  if (s instanceof Date) return s.getTime();
  if (typeof s === 'number') return s;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s||'');
  if (!m) return NaN;
  return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)).getTime();
}
function fecha(t, conHora){
  const d = new Date(typeof t==='number'?t:parseFecha(t));
  if (isNaN(d)) return 'sin fecha';
  let s = d.getDate()+' '+MES[d.getMonth()]+' '+d.getFullYear();
  if (conHora) s = DIA[d.getDay()]+' '+d.getDate()+' '+MES[d.getMonth()]+', '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return s;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Navegación ---------- */
function encabezado(actual){
  const paginas = [['index.html','Predicción','prediccion'],['fechas.html','Datos por fecha','fechas']];
  const h = document.createElement('header');
  h.className = 'top';
  h.innerHTML = `<div class="marca"><h1>Monitor de nieve, Andes centrales</h1><span class="sub">Lluvia sobre nieve, polvo y pérdida de nieve en Aconcagua, Mapocho, Maipo y Cachapoal</span></div>
    <nav class="nav" aria-label="Secciones">${paginas.map(([u,t,k])=>`<a href="${u}"${k===actual?' aria-current="page"':''}>${t}</a>`).join('')}
      ${actual==='estudios' ? '' : `<label class="interruptor" title="Muestra u oculta las referencias a papers en mapas, fichas y textos"><input type="checkbox" id="sw-papers"> Info de papers</label>`}</nav>`;
  document.body.prepend(h);
  const sw = h.querySelector('#sw-papers');
  document.body.classList.toggle('con-papers', papersActivos());
  if (sw){ sw.checked = papersActivos(); sw.addEventListener('change', ()=>fijarPapers(sw.checked)); }
}
/* Interruptor global de la información de papers: apagado por defecto. */
function papersActivos(){ try{ return localStorage.getItem('nieve.papers')==='true'; }catch(e){ return false; } }
function fijarPapers(v){
  try{ localStorage.setItem('nieve.papers', String(!!v)); }catch(e){}
  document.body.classList.toggle('con-papers', !!v);
  const sw = document.getElementById('sw-papers'); if (sw) sw.checked = !!v;
  document.dispatchEvent(new CustomEvent('nieve:papers', {detail:!!v}));
}

/* ---------- Capas geográficas ---------- */
const MMA = 'https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_DIVISION_CUENCA/MapServer';
const CAPAS = {
  subcuencas: {
    etiqueta:'Subcuencas DGA',
    fuentes:[
      {tipo:'local', url:'datos/subcuencas.geojson', nom:'archivo del sitio (DGA vía MMA)'},
      {tipo:'arcgis', base:MMA, capa:1, offset:0.002, nom:'servicio MMA, división de cuencas DGA'}
    ]
  },
  rios: {
    etiqueta:'Ríos',
    fuentes:[
      {tipo:'local', url:'datos/rios.geojson', nom:'archivo del sitio'},
      {tipo:'arcgis', base:'https://wservice-sit.mop.gov.cl/ArcGIS/rest/services/MAPA_BASE/RED_HIDROGRAFICA/MapServer', capa:16, offset:0.001, nom:'red hidrográfica MOP 1:250.000'},
      {tipo:'overpass', consulta:'way["waterway"="river"]', nom:'OpenStreetMap'}
    ]
  },
  caminos: {
    etiqueta:'Caminos',
    fuentes:[
      {tipo:'local', url:'datos/caminos.geojson', nom:'archivo del sitio'},
      {tipo:'arcgis', base:'https://services3.arcgis.com/Dhl01RVOOnbjTdY7/ArcGIS/rest/services/RED_VIAL_MOP/FeatureServer', capa:0, offset:0.0005, nom:'red vial MOP (Vialidad)'},
      {tipo:'arcgis', base:'https://rest-sit.mop.gob.cl/arcgis/rest/services/VIALIDAD/Red_Vial_Estructurante/MapServer', capa:0, offset:0.0005, nom:'red vial estructurante MOP'},
      {tipo:'overpass', consulta:'way["highway"~"^(primary|secondary|tertiary|unclassified)$"]', este:-70.55, nom:'OpenStreetMap'}
    ]
  },
  faenas: {
    etiqueta:'Faenas mineras',
    fuentes:[
      {tipo:'local', url:'datos/faenas.geojson', nom:'archivo del sitio (SMA)'},
      {tipo:'arcgis', base:'https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Industria_y_actividades/MapServer', capa:2, nom:'SMA, faenas mineras'}
    ]
  },
  relaves: {
    etiqueta:'Depósitos de relaves',
    fuentes:[
      {tipo:'local', url:'datos/relaves.geojson', nom:'archivo del sitio (SERNAGEOMIN)'},
      {tipo:'arcgis', base:'https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Industria_y_actividades/MapServer', capa:4, nom:'SERNAGEOMIN vía SMA, relaves'}
    ]
  },
  volcanes: {
    etiqueta:'Volcanes activos',
    fuentes:[
      {tipo:'local', url:'datos/volcanes.geojson', nom:'archivo del sitio (SERNAGEOMIN)'},
      {tipo:'arcgis', base:'https://sdngsig.sernageomin.cl/gissdng/rest/services/Publico/Ranking_Volcanes_Chile/MapServer', capa:0, nom:'SERNAGEOMIN, ranking de volcanes activos'},
      {tipo:'estatico', nom:'lista fija (coordenadas del Global Volcanism Program)', features:[
        ['Tupungatito', -33.3939, -69.8227, 5682], ['Tupungato', -33.3583, -69.7700, 6570],
        ['San José', -33.7864, -69.8987, 5856], ['Maipo', -34.1610, -69.8330, 5264]
      ].map(([n,la,lo,z])=>({type:'Feature', properties:{nombre:n, altura_m:z}, geometry:{type:'Point', coordinates:[lo,la]}}))}
    ]
  },
  cambio: {etiqueta:'Lugares de cambio (embeddings)', fuentes:[{tipo:'local', url:'datos/lugares_cambio.geojson', nom:'script GEE de embeddings'}]},
  cambio_anual: {etiqueta:'Lugares de cambio por año', fuentes:[{tipo:'local', url:'datos/lugares_cambio_por_anio.geojson', nom:'script GEE de embeddings'}]},
  susceptibles: {etiqueta:'Puntos susceptibles (modelo)', fuentes:[{tipo:'local', url:'datos/puntos_susceptibles.geojson', nom:'notebook de entrenamiento'}]},
  alertas_dga: {
    etiqueta:'Estaciones fluviométricas DGA (en línea)',
    fuentes:[
      {tipo:'arcgis', base:'https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/ALERTAS/MapServer', capa:0, nom:'DGA, alertas de crecida'}
    ]
  }
};

function esriAGeoJSON(f){
  const g = f.geometry || {};
  let geom = null;
  if (g.rings) geom = {type:'Polygon', coordinates:g.rings};          // anillos en regla par-impar
  else if (g.paths) geom = {type:'MultiLineString', coordinates:g.paths};
  else if (g.x!=null) geom = {type:'Point', coordinates:[g.x,g.y]};
  return {type:'Feature', properties:f.attributes||{}, geometry:geom};
}
async function json(url, opciones={}){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), opciones.timeout||25000);
  try{
    const r = await fetch(url, Object.assign({signal:ctl.signal}, opciones));
    if (!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function desdeArcgis(src){
  const a = CONFIG.AOI, todas = [];
  let offset = 0;
  for (let pagina=0; pagina<15; pagina++){
    const p = new URLSearchParams({where:'1=1', geometry:`${a.w},${a.s},${a.e},${a.n}`, geometryType:'esriGeometryEnvelope',
      inSR:'4326', spatialRel:'esriSpatialRelIntersects', outFields:'*', returnGeometry:'true', outSR:'4326', f:'json'});
    if (src.offset) p.set('maxAllowableOffset', src.offset);
    if (offset) p.set('resultOffset', offset);
    const d = await json(`${src.base}/${src.capa}/query?${p}`);
    if (d.error) throw new Error(d.error.message||'error del servicio');
    const feats = (d.features||[]).map(esriAGeoJSON).filter(f=>f.geometry);
    todas.push(...feats);
    if (!d.exceededTransferLimit || !feats.length) break;
    offset += feats.length;
  }
  if (!todas.length) throw new Error('sin elementos en la zona');
  return {type:'FeatureCollection', features:todas};
}
async function desdeOverpass(src){
  const a = CONFIG.AOI, e = src.este!=null ? Math.max(a.w, src.este) : a.w;
  const q = `[out:json][timeout:90];(${src.consulta}(${a.s},${e},${a.n},${a.e}););out geom;`;
  const d = await json('https://overpass-api.de/api/interpreter', {method:'POST', body:'data='+encodeURIComponent(q), headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:90000});
  const feats = (d.elements||[]).filter(x=>x.geometry).map(x=>({type:'Feature',
    properties:Object.assign({fuente:'OSM', osm_id:x.id}, x.tags||{}),
    geometry:{type:'LineString', coordinates:x.geometry.map(p=>[p.lon,p.lat])}}));
  if (!feats.length) throw new Error('sin elementos');
  return {type:'FeatureCollection', features:feats};
}
const cacheCapas = {};
function cargarCapa(nombre){
  if (cacheCapas[nombre]) return cacheCapas[nombre];
  const def = CAPAS[nombre];
  cacheCapas[nombre] = (async ()=>{
    const fallas = [];
    for (const src of def.fuentes){
      try{
        let fc;
        if (src.tipo==='local'){
          if (location.protocol==='file:') throw new Error('no se leen archivos locales sin servidor');
          fc = await json(src.url, {timeout:15000});
        }
        else if (src.tipo==='arcgis') fc = await desdeArcgis(src);
        else if (src.tipo==='estatico') fc = {type:'FeatureCollection', features:src.features};
        else fc = await desdeOverpass(src);
        if (!fc.features || !fc.features.length) throw new Error('archivo vacío');
        fc.features.forEach(f=>{ f.bbox = f.bbox || bboxDe(f.geometry); });
        return {fc, fuente:src.nom};
      }catch(err){ fallas.push(src.nom+': '+(err.name==='AbortError'?'sin respuesta':err.message)); }
    }
    const e = new Error('No se pudo cargar '+def.etiqueta.toLowerCase());
    e.detalle = fallas;
    throw e;
  })();
  return cacheCapas[nombre];
}

/* Geometría */
function recorrer(geom, fn){
  if (!geom) return;
  const c = geom.coordinates;
  if (geom.type==='Point') fn(c);
  else if (geom.type==='LineString' || geom.type==='MultiPoint') c.forEach(fn);
  else if (geom.type==='Polygon' || geom.type==='MultiLineString') c.forEach(r=>r.forEach(fn));
  else if (geom.type==='MultiPolygon') c.forEach(p=>p.forEach(r=>r.forEach(fn)));
}
function bboxDe(geom){
  const b = [Infinity,Infinity,-Infinity,-Infinity];
  recorrer(geom, p=>{ if(p[0]<b[0])b[0]=p[0]; if(p[1]<b[1])b[1]=p[1]; if(p[0]>b[2])b[2]=p[0]; if(p[1]>b[3])b[3]=p[1]; });
  return b;
}
function dentro(lon, lat, f){
  const b = f.bbox || bboxDe(f.geometry);
  if (lon<b[0]||lon>b[2]||lat<b[1]||lat>b[3]) return false;
  const g = f.geometry;
  const polis = g.type==='Polygon' ? [g.coordinates] : g.type==='MultiPolygon' ? g.coordinates : [];
  let c = false;
  for (const poli of polis) for (const r of poli)
    for (let i=0, j=r.length-1; i<r.length; j=i++){
      const xi=r[i][0], yi=r[i][1], xj=r[j][0], yj=r[j][1];
      if (((yi>lat)!==(yj>lat)) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) c = !c;
    }
  return c;
}
function poligonoQueContiene(fc, lon, lat){
  if (!fc || lon==null || lat==null) return null;
  // Si hay varios (capas anidadas), se queda con el más pequeño.
  let mejor = null, area = Infinity;
  for (const f of fc.features){
    if (!dentro(lon, lat, f)) continue;
    const b = f.bbox, a = (b[2]-b[0])*(b[3]-b[1]);
    if (a < area){ area = a; mejor = f; }
  }
  return mejor;
}
function nombreDe(props){
  if (!props) return '';
  const pref = ['faena','Sistema_volcánico','SISTEMA_VOLCANICO','Sistema_volcanico','NOMBRE_VOLCAN','NOM_SSUBC','NOM_SUBC','NOMBRE_SUBCUENCA','NOM_CUEN','NOMBRE','NOMBRE_CAMINO','NOM_RIO','name','nombre','Nombre'];
  for (const k of pref) if (props[k] && typeof props[k]==='string') return props[k];
  const k = Object.keys(props).find(k=>/nom|name|volc/i.test(k) && typeof props[k]==='string' && props[k].trim());
  return k ? props[k] : '';
}
function tablaPropiedades(props, max=10){
  const filas = Object.entries(props||{}).filter(([k,v])=>v!=null && v!=='' && !/^(OBJECTID|FID|Shape|GlobalID|SHAPE)/i.test(k)).slice(0,max);
  return filas.map(([k,v])=>`<div><span class="muted">${esc(k)}:</span> ${esc(v)}</div>`).join('');
}

/* ---------- Mapa base ---------- */
function crearMapa(id){
  const a = CONFIG.AOI;
  if (!window.L){
    document.getElementById(id).innerHTML = '<p class="error" style="margin:24px">No se pudo cargar la librería del mapa. Revisa la conexión a internet.</p>';
    return null;
  }
  const m = L.map(id, {scrollWheelZoom:false, zoomSnap:.25}).fitBounds([[a.s,a.w],[a.n,a.e]]);
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const satelite = L.tileLayer(esri+'World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:17, attribution:'Imagen: Esri, Maxar, Earthstar Geographics'});
  const relieve = L.tileLayer(esri+'World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', {maxZoom:13, attribution:'Relieve: Esri'});
  const nombres = L.tileLayer(esri+'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom:17, pane:'overlayPane', opacity:.85});
  satelite.addTo(m); nombres.addTo(m);
  L.control.layers({'Satélite':satelite, 'Relieve':relieve}, {'Nombres de lugares':nombres}, {position:'topleft', collapsed:true}).addTo(m);
  L.rectangle([[a.s,a.w],[a.n,a.e]], {color:'#FFFFFF', weight:1.2, opacity:.8, dashArray:'5 5', fill:false, interactive:false}).addTo(m);
  m.createPane('cuencas'); m.getPane('cuencas').style.zIndex = 390;
  m.createPane('lineas'); m.getPane('lineas').style.zIndex = 410;
  return m;
}
/* Panel de capas con estado de carga. items: [{id, etiqueta, muestra, capa, activo}] */
function panelCapas(mapa, items, abierto){
  const ctl = L.control({position:'topright'});
  const estados = {};
  ctl.onAdd = ()=>{
    const d = L.DomUtil.create('details','capas-mapa');
    d.open = abierto!=null ? abierto : window.innerWidth > 700;
    d.innerHTML = '<summary>Capas</summary>' + items.map(it=>`
      <label><input type="checkbox" data-capa="${it.id}" ${it.activo!==false?'checked':''}> ${it.muestra||''} ${esc(it.etiqueta)}</label>
      <div class="estado-capa" data-estado="${it.id}"></div><div class="control-capa" data-control="${it.id}"></div>`).join('');
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    d.addEventListener('change', e=>{
      const it = items.find(x=>x.id===e.target.dataset.capa);
      if (!it || !it.capa) return;
      e.target.checked ? it.capa.addTo(mapa) : it.capa.remove();
    });
    return d;
  };
  ctl.addTo(mapa);
  /* El panel nunca más alto que el mapa: si no caben todas las capas, se desplaza. */
  const ajustarAlto = ()=>{ const c = ctl.getContainer(); if (c) c.style.maxHeight = Math.max(160, mapa.getSize().y - 24)+'px'; };
  ajustarAlto(); mapa.on('resize', ajustarAlto); window.addEventListener('resize', ()=>setTimeout(ajustarAlto, 50));
  items.forEach(it=>{ if (it.capa && it.activo!==false) it.capa.addTo(mapa); });
  return {
    estado(id, texto){ const el = ctl.getContainer().querySelector(`[data-estado="${id}"]`); if (el) el.textContent = texto; },
    control(id){ return ctl.getContainer().querySelector(`[data-control="${id}"]`); },
    fijar(id, v){
      const it = items.find(x=>x.id===id); if (!it || !it.capa) return;
      const cb = ctl.getContainer().querySelector(`[data-capa="${id}"]`); if (cb) cb.checked = v;
      v ? it.capa.addTo(mapa) : it.capa.remove();
    }
  };
}
/* Estudios de referencia con área de estudio en la zona. */
const ALCANCE = {zona:'En el área de estudio', regional:'Regional (Chile central)', otra:'Otra zona o método'};
function popupEstudio(e){
  const evs = (e.eventos||[]).map(id=>{ const ev = (window.DATA && DATA.cat || []).find(x=>x.id===id); return ev ? `<a href="fechas.html?evento=${id}">${esc(fecha(ev.d0))}: ${esc(ev.tipo)}</a>` : ''; }).filter(Boolean);
  return `<div class="pop-titulo">${esc(e.cita)}</div><div class="muted small">${esc(e.titulo)}. ${esc(e.revista||'')}</div>
    <div style="margin-top:6px"><span class="muted">Zona:</span> ${esc(e.zona)}</div>
    <div style="margin-top:4px">${esc(e.hallazgo)}</div>
    <div style="margin-top:4px"><span class="muted">En la plataforma:</span> ${esc(e.uso)}</div>
    ${evs.length ? `<div style="margin-top:4px"><span class="muted">Eventos del catastro:</span><br>${evs.join('<br>')}</div>` : ''}
    <div style="margin-top:6px">${e.doi ? `<a href="https://doi.org/${esc(e.doi)}" target="_blank" rel="noopener">Abrir el artículo</a><br>` : ''}<a href="estudios.html#${esc(e.id)}">Ver en la página Estudios</a></div>`;
}
function capaEstudios(){
  const g = L.layerGroup(), col = COL.estudio || '#C9A8F5';
  (window.ESTUDIOS||[]).filter(e=>e.geom).forEach(e=>{
    const pop = popupEstudio(e), estilo = {color:col, weight:2, dashArray:'3 5', fillColor:col, fillOpacity:.07, pane:'lineas'};
    const chip = (lat, lon, txt)=>L.marker([lat,lon], {icon:L.divIcon({className:'', html:`<div class="chip-estudio">${esc(txt)}</div>`, iconSize:null}), keyboard:false}).bindPopup(pop, {maxWidth:340}).addTo(g);
    if (e.geom.tipo==='caja'){ L.rectangle([[e.geom.s,e.geom.w],[e.geom.n,e.geom.e]], estilo).bindPopup(pop, {maxWidth:340}).addTo(g); chip(e.geom.n-0.06, (e.geom.w+e.geom.e)/2, e.cita); }
    else if (e.geom.tipo==='puntos') e.geom.pts.forEach(([la,lo,n])=>{ L.circle([la,lo], Object.assign({radius:e.geom.radio*1000}, estilo)).bindPopup(pop, {maxWidth:340}).addTo(g); chip(la, lo, e.cita+', '+n); });
    else { L.circle([e.geom.lat,e.geom.lon], Object.assign({radius:e.geom.radio*1000}, estilo)).bindPopup(pop, {maxWidth:340}).addTo(g); chip(e.geom.lat, e.geom.lon, e.cita); }
  });
  return g;
}

/* Agrega ríos, caminos y fuentes de partículas, con su estado en el panel. */
function capasReferencia(mapa, extra=[], opciones={}){
  const g = {rios:L.layerGroup(), caminos:L.layerGroup(), fuentes:L.layerGroup(), faenas:L.layerGroup(), relaves:L.layerGroup(), volcanes:L.layerGroup()};
  FUENTES.forEach(f=>{
    L.marker([f.lat,f.lon], {icon:L.divIcon({className:'', html:'<div class="mk-fuente"></div>', iconSize:[13,13]}), title:f.nom, pane:'markerPane'})
      .bindPopup(`<div class="pop-titulo">${esc(f.nom)}</div>${esc(f.part)}<br><span class="muted">${esc(f.patron)}</span>`).addTo(g.fuentes);
  });
  const items = [
    ...extra,
    {id:'rios', etiqueta:'Ríos', muestra:`<span class="linea" style="background:${COL.rio}"></span>`, capa:g.rios},
    {id:'caminos', etiqueta:'Caminos', muestra:`<span class="linea" style="background:${COL.camino}"></span>`, capa:g.caminos, activo:opciones.caminos!==false},
    {id:'fuentes', etiqueta:'Fuentes de partículas', muestra:`<span class="cuadro" style="background:${COL.fuente}"></span>`, capa:g.fuentes, activo:opciones.fuentes!==false},
    {id:'faenas', etiqueta:'Faenas mineras', muestra:'<span class="mk-faena" style="display:inline-block"></span>', capa:g.faenas},
    {id:'relaves', etiqueta:'Depósitos de relaves', muestra:'<span class="mk-relave" style="display:inline-block"></span>', capa:g.relaves, activo:false},
    {id:'volcanes', etiqueta:'Volcanes activos', muestra:'<span class="mk-volcan" style="display:inline-block"></span>', capa:g.volcanes}
  ];
  g.cambio = L.layerGroup(); g.susceptibles = L.layerGroup();
  items.push({id:'susceptibles', etiqueta:'Puntos susceptibles (modelo)', muestra:'<span class="punto" style="background:#B4232C;box-shadow:0 0 0 2px #fff"></span>', capa:g.susceptibles});
  items.push({id:'cambio', etiqueta:'Lugares de cambio (embeddings)', muestra:'<span class="punto" style="background:transparent;border:2.5px solid #FFD84D"></span>', capa:g.cambio});
  if (window.ESTUDIOS){ g.estudios = capaEstudios(); items.push({id:'estudios', etiqueta:'Estudios (papers)', muestra:`<span class="cuadro" style="background:transparent;border:1.5px dashed ${COL.estudio}"></span>`, capa:g.estudios, activo:papersActivos()}); }
  const panel = panelCapas(mapa, items, opciones.abierto);
  if (window.ESTUDIOS){
    panel.estado('estudios', `${ESTUDIOS.filter(e=>e.geom).length} con sitio en la zona; ${ESTUDIOS.length} en total (ver página Estudios).`);
    document.addEventListener('nieve:papers', ev=>panel.fijar('estudios', ev.detail));
  }
  [['rios',{color:COL.rio, weight:1.6, opacity:.95}], ['caminos',{color:COL.camino, weight:1.5, opacity:.9, dashArray:'6 3'}]].forEach(([k,estilo])=>{
    panel.estado(k, 'Cargando...');
    cargarCapa(k).then(({fc,fuente})=>{
      L.geoJSON(fc, {pane:'lineas', style:()=>estilo, onEachFeature:(f,l)=>{ const n = nombreDe(f.properties); if (n) l.bindTooltip(esc(n), {sticky:true}); }}).addTo(g[k]);
      panel.estado(k, 'Fuente: '+fuente);
    }).catch(err=>panel.estado(k, 'No disponible. '+(err.detalle||[]).join('; ')));
  });
  const gps = (lat, lon) => `<div style="margin-top:4px"><span class="muted">GPS:</span> ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
  const prop = (p, k, dec, suf) => p[k]!=null && isFinite(p[k]) ? num(+p[k], dec)+(suf||'') : 'sin dato';
  [['susceptibles', f=>{ const p = f.properties, v = +(p.prob_max ?? p.prob_media ?? 0); const col = v>=0.8 ? COL['riesgo-alto'] : COL['riesgo-medio'];
      return {marca: L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {radius:6, color:'#fff', weight:2, fillColor:col, fillOpacity:1, pane:'markerPane'}),
        pop:`<div class="pop-titulo">Punto susceptible</div><div>Probabilidad máxima ${prop(p,'prob_max',2)}, media ${prop(p,'prob_media',2)}</div><div>Altura ${prop(p,'altura',0,' m')}, pendiente ${prop(p,'pendiente',0,'°')}, días con nieve ${p.frec_nieve!=null?num(p.frec_nieve*100,0)+' %':'sin dato'}</div><div>Área ${prop(p,'area_ha',1,' ha')}; embeddings ${esc(p.anio_embedding||'')}</div>${gps(f.geometry.coordinates[1], f.geometry.coordinates[0])}<div class="muted small" style="margin-top:4px">Modelo del notebook de entrenamiento: revisar en terreno o con imágenes antes de usar.</div>`}; }]
  ].forEach(([k, fn])=>{
    panel.estado(k, 'Buscando archivo...');
    cargarCapa(k).then(({fc})=>{
      fc.features.filter(f=>f.geometry && f.geometry.type==='Point').forEach(f=>{ const {marca, pop} = fn(f); marca.bindPopup(pop, {maxWidth:320}).addTo(g[k]); });
      panel.estado(k, `${fc.features.length} puntos desde ${k==='cambio'?'datos/lugares_cambio.geojson':'datos/puntos_susceptibles.geojson'}.`);
    }).catch(()=>panel.estado(k, 'Aún sin datos: saldrá del notebook de entrenamiento (datos/puntos_susceptibles.geojson).'));
  });
  /* Lugares de cambio: por año (lugares_cambio_por_anio.geojson) o resumen (lugares_cambio.geojson). */
  const popCambio = f=>{ const p = f.properties, anual = p.tipo==='anual' || p.anio_previo!=null && p.cambio_medio==null;
    return `<div class="pop-titulo">Lugar de cambio ${anual ? esc(p.anio_previo||'')+' a '+esc(p.anio||'') : '(resumen)'}</div>`+
      (anual ? `<div>Cambio ${prop(p,'cambio',2)} (umbral de ese año ${prop(p,'umbral',2)})</div>`
             : `<div>Cambio máximo ${prop(p,'cambio',2)} en ${esc(p.anio||'')} (media de todos los años ${prop(p,'cambio_medio',2)})</div>`)+
      `<div>Altura ${prop(p,'altura',0,' m')}, pendiente ${prop(p,'pendiente',0,'°')}, días con nieve ${p.frec_nieve!=null?num(p.frec_nieve*100,0)+' %':'sin dato'}</div><div>Área ${prop(p,'area_ha',1,' ha')}</div>${gps(f.geometry.coordinates[1], f.geometry.coordinates[0])}<div class="muted small" style="margin-top:4px">Cambio entre embeddings anuales: puede ser una remoción en masa, una faena, un glaciar o nieve persistente. Revisar con imágenes.</div>`; };
  const cambioDatos = {resumen:null, anual:null};
  const pintarCambio = sel=>{
    g.cambio.clearLayers();
    const feats = sel==='resumen' ? (cambioDatos.resumen||[]) : (cambioDatos.anual||[]).filter(f=>sel==='todos' || String(Math.round(f.properties.anio))===sel);
    feats.forEach(f=>L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {radius:5, color:'#FFD84D', weight:2.5, fillOpacity:0, pane:'markerPane'}).bindPopup(popCambio(f), {maxWidth:320}).addTo(g.cambio));
    panel.estado('cambio', `${feats.length} puntos ${sel==='resumen' ? 'del resumen de todos los años' : sel==='todos' ? 'de todos los años' : 'con cambio de '+(+sel-1)+' a '+sel}.`);
    guardado.escribir('cambio_anio', sel);
  };
  panel.estado('cambio', 'Buscando archivos...');
  const pt = fc=>fc.features.filter(f=>f.geometry && f.geometry.type==='Point');
  Promise.allSettled([cargarCapa('cambio_anual'), cargarCapa('cambio')]).then(([a, r])=>{
    if (a.status==='fulfilled') cambioDatos.anual = pt(a.value.fc);
    if (r.status==='fulfilled') cambioDatos.resumen = pt(r.value.fc);
    if (!cambioDatos.anual && !cambioDatos.resumen){ panel.estado('cambio', 'Aún sin datos: corre herramientas/gee_embeddings_cambio.js y copia lugares_cambio_por_anio.geojson y lugares_cambio.geojson a datos/.'); return; }
    const anios = [...new Set((cambioDatos.anual||[]).map(f=>Math.round(f.properties.anio)).filter(isFinite))].sort((x,y)=>x-y);
    const ops = [...(cambioDatos.resumen ? [['resumen','Resumen de todos los años']] : []), ...(anios.length ? [['todos','Todos los años juntos']] : []), ...anios.map(y=>[String(y), `${y-1} a ${y}`])];
    const box = panel.control('cambio');
    box.innerHTML = `<select aria-label="Año de los lugares de cambio">${ops.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>`;
    const selEl = box.querySelector('select');
    const previo = guardado.leer('cambio_anio', null);
    selEl.value = ops.some(o=>o[0]===previo) ? previo : (anios.length ? String(anios[anios.length-1]) : 'resumen');
    selEl.addEventListener('change', ()=>pintarCambio(selEl.value));
    pintarCambio(selEl.value);
  });
  const PUNTOS = {
    faenas:{clase:f=>/activ/i.test(f.properties.situacion||'') || !f.properties.situacion ? 'mk-faena' : 'mk-faena inactiva', tam:12,
      pop:p=>`<div class="pop-titulo">${esc(p.faena||nombreDe(p)||'Faena minera')}</div>${[['Empresa',p.empresa],['Tipo',p.tipo_faena],['Mineral',p.pasta],['Situación',p.situacion],['Categoría',p.categoria],['Comuna',p.comuna]].filter(x=>x[1]).map(([k,v])=>`<div><span class="muted">${k}:</span> ${esc(v)}</div>`).join('')}`},
    relaves:{clase:()=>'mk-relave', tam:10, pop:p=>`<div class="pop-titulo">${esc(nombreDe(p)||'Depósito de relaves')}</div>${p.Snippet?esc(p.Snippet):''}`},
    volcanes:{clase:()=>'mk-volcan', tam:16, pop:p=>`<div class="pop-titulo">Volcán ${esc(nombreDe(p)||'')}</div>${tablaPropiedades(Object.fromEntries(Object.entries(p).filter(([k])=>!/^(nombre)$/i.test(k))), 8)}`}
  };
  Object.entries(PUNTOS).forEach(([k,cfg])=>{
    panel.estado(k, 'Cargando...');
    cargarCapa(k).then(({fc,fuente})=>{
      const pts = fc.features.filter(f=>f.geometry && f.geometry.type==='Point');
      pts.forEach(f=>{
        const [lon,lat] = f.geometry.coordinates;
        L.marker([lat,lon], {icon:L.divIcon({className:'', html:`<div class="${cfg.clase(f)}"></div>`, iconSize:[cfg.tam,cfg.tam]}), title:nombreDe(f.properties)||'', keyboard:false})
          .bindPopup(cfg.pop(f.properties)).addTo(g[k]);
      });
      panel.estado(k, `${pts.length} en la zona. Fuente: ${fuente}`);
    }).catch(err=>panel.estado(k, 'No disponible. '+(err.detalle||[]).join('; ')));
  });
  return {grupos:g, panel};
}

/* ---------- Gráfico SVG genérico ---------- */
function ticksBonitos(min, max, n=5){
  if (!(max>min)) { max = min+1; }
  const paso0 = (max-min)/n, mag = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1,2,2.5,5,10].map(k=>k*mag).find(p=>p>=paso0) || 10*mag;
  const t = [];
  for (let v=Math.ceil(min/paso)*paso; v<=max+1e-9; v+=paso) t.push(+v.toFixed(10));
  return t;
}
function ticksFecha(min, max){
  const dia = 864e5, span = (max-min)/dia, t = [];
  const d = new Date(min); d.setHours(0,0,0,0);
  if (span <= 6){ for (let x=d.getTime(); x<=max; x+=dia) if (x>=min) t.push({x, txt:DIA[new Date(x).getDay()]+' '+new Date(x).getDate()}); }
  else if (span <= 45){ for (let x=d.getTime(); x<=max; x+=dia){ const z=new Date(x); if (x>=min && (span<=14 || z.getDay()===1)) t.push({x, txt:z.getDate()+' '+MES[z.getMonth()]}); } }
  else if (span <= 800){ d.setDate(1); for (let z=new Date(d); z.getTime()<=max; z.setMonth(z.getMonth()+(span>400?3:1))) if (z.getTime()>=min) t.push({x:z.getTime(), txt:MES[z.getMonth()]+(z.getMonth()===0||span>400?' '+z.getFullYear():'')}); }
  else { const y0 = new Date(min).getFullYear(), y1 = new Date(max).getFullYear(), salto = Math.ceil((y1-y0+1)/12);
    for (let y=y0; y<=y1; y+=salto){ const x = new Date(y,0,1).getTime(); if (x>=min) t.push({x, txt:String(y)}); } }
  return t;
}
/*
 cfg: {alto, x:{tipo:'fecha'|'num'|'cat', min, max, cats, etiqueta}, y:{min, max, etiqueta, dec},
       series:[{nombre, color, tipo:'linea'|'barras'|'puntos', datos:[{x,y,...}], discontinua, hueco}],
       refs:[{y, texto, color, discontinua}], franjas:[{x0,x1,texto}], ahora, tooltip(p,s), alClic(p,s)}
*/
function grafico(cont, cfg){
  cont.querySelectorAll('.lienzo').forEach(n=>n.remove());
  const W = Math.max(480, Math.round(cont.clientWidth ? cont.clientWidth-2 : 1000)), H = cfg.alto||220, ML = cfg.margenIzq||58, MR = 18, MT = 12, MB = 30;
  const todos = cfg.series.flatMap(s=>s.datos);
  const tipoX = cfg.x.tipo||'num';
  let cats = cfg.x.cats || (tipoX==='cat' ? [...new Set(todos.map(p=>p.x))] : null);
  let x0 = cfg.x.min, x1 = cfg.x.max;
  if (tipoX!=='cat'){
    const xs = todos.map(p=>p.x).filter(isFinite);
    if (x0==null) x0 = Math.min(...xs); if (x1==null) x1 = Math.max(...xs);
    if (!(x1>x0)) { x0 -= 1; x1 += 1; }
    const hayBarras = cfg.series.some(s=>s.tipo==='barras');
    if (hayBarras){ const pad = (x1-x0)/Math.max(20, xs.length)*0.6; x0 -= pad; x1 += pad; }
  }
  const ys = todos.map(p=>p.y).filter(isFinite).concat((cfg.refs||[]).map(r=>r.y));
  let y0 = cfg.y.min!=null ? cfg.y.min : Math.min(0, ...ys), y1 = cfg.y.max!=null ? cfg.y.max : Math.max(...ys);
  if (!ys.length){ y0 = 0; y1 = 1; }
  if (!(y1>y0)) y1 = y0 + 1;
  const ticksY = ticksBonitos(y0, y1, cfg.y.ticks||4);
  if (cfg.y.max==null) y1 = Math.max(y1, ticksY[ticksY.length-1]);
  if (cfg.y.min==null) y0 = Math.min(y0, ticksY[0]);
  const ancho = W-ML-MR, banda = cats ? ancho/Math.max(1,cats.length) : 0;
  const X = v => cats ? ML + banda*(cats.indexOf(v)+.5) : ML + (v-x0)/(x1-x0)*ancho;
  const Y = v => MT + (y1-v)/(y1-y0)*(H-MT-MB);
  const pasoY = ticksY.length>1 ? Math.abs(ticksY[1]-ticksY[0]) : 1;
  const dec = cfg.y.dec!=null ? cfg.y.dec : (pasoY<0.1 ? 2 : pasoY%1 ? 1 : 0);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.titulo||'Gráfico')}">`;
  (cfg.franjas||[]).forEach(f=>{ const a = X(f.x0), b = X(f.x1); s += `<rect x="${Math.min(a,b)}" y="${MT}" width="${Math.max(3,Math.abs(b-a))}" height="${H-MT-MB}" fill="${f.color||COL['cat-a']}" opacity=".12"/>`; if (f.texto) s += `<text x="${Math.min(a,b)+4}" y="${MT+12}" font-size="11" fill="var(--roca-2)">${esc(f.texto)}</text>`; });
  if (cfg.y.etiquetas) Object.entries(cfg.y.etiquetas).forEach(([v,t])=>{ s += `<line x1="${ML}" x2="${W-MR}" y1="${Y(+v)}" y2="${Y(+v)}" stroke="var(--neblina)"/><text x="${ML-8}" y="${Y(+v)+4}" font-size="12" text-anchor="end" fill="var(--roca-2)">${esc(t)}</text>`; });
  else ticksY.forEach(v=>{ s += `<line x1="${ML}" x2="${W-MR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--neblina)"/><text x="${ML-8}" y="${Y(v)+4}" font-size="12" text-anchor="end" fill="var(--roca-2)">${num(v,dec)}</text>`; });
  if (cfg.y.etiqueta) s += `<text x="${ML-8}" y="${MT-1}" font-size="11" text-anchor="end" fill="var(--roca-3)">${esc(cfg.y.etiqueta)}</text>`;
  if (tipoX==='fecha') ticksFecha(x0, x1).forEach(t=>{ s += `<line x1="${X(t.x)}" x2="${X(t.x)}" y1="${MT}" y2="${H-MB+4}" stroke="var(--neblina)"/><text x="${X(t.x)+3}" y="${H-10}" font-size="12" fill="var(--roca-2)">${esc(t.txt)}</text>`; });
  else if (tipoX==='num') ticksBonitos(x0, x1, 6).forEach(v=>{ s += `<line x1="${X(v)}" x2="${X(v)}" y1="${H-MB}" y2="${H-MB+4}" stroke="var(--roca-3)"/><text x="${X(v)}" y="${H-10}" font-size="12" text-anchor="middle" fill="var(--roca-2)">${num(v, Math.abs(x1-x0)<10?1:0)}</text>`; });
  else { const paso = Math.ceil(cats.length/14); cats.forEach((c,i)=>{ if (i%paso===0) s += `<text x="${X(c)}" y="${H-10}" font-size="12" text-anchor="middle" fill="var(--roca-2)">${esc(String(c).slice(0,16))}</text>`; }); }
  if (cfg.x.etiqueta) s += `<text x="${W-MR}" y="${H-MB-4}" font-size="11" text-anchor="end" fill="var(--roca-3)">${esc(cfg.x.etiqueta)}</text>`;
  if (!cfg.y.etiquetas) s += `<line x1="${ML}" x2="${W-MR}" y1="${Y(Math.max(y0,Math.min(0,y1)))}" y2="${Y(Math.max(y0,Math.min(0,y1)))}" stroke="var(--roca-3)"/>`;
  if (cfg.ahora!=null && cfg.ahora>=x0 && cfg.ahora<=x1) s += `<line x1="${X(cfg.ahora)}" x2="${X(cfg.ahora)}" y1="${MT}" y2="${H-MB}" stroke="var(--roca)" stroke-dasharray="2 3"/><text x="${X(cfg.ahora)+4}" y="${H-MB-6}" font-size="11" fill="var(--roca)">ahora</text>`;
  const puntos = [];
  const nBar = cfg.series.filter(z=>z.tipo==='barras').length || 1;
  let iBar = 0;
  cfg.series.forEach(se=>{
    const d = se.datos.filter(p=>isFinite(p.y) && (cats || isFinite(p.x))).sort((a,b)=>cats?0:a.x-b.x);
    if (se.tipo==='barras'){
      let bw;
      if (cats) bw = banda*0.7/nBar;
      else { let m = Infinity; for (let i=1;i<d.length;i++) m = Math.min(m, X(d[i].x)-X(d[i-1].x)); bw = Math.max(2, Math.min(28, (isFinite(m)?m:20)*0.72))/nBar; }
      const desp = (iBar-(nBar-1)/2)*(bw+2); iBar++;
      d.forEach(p=>{ const cx = X(p.x)+desp, y = Y(Math.max(p.y,y0)), base = Y(Math.max(y0,Math.min(0,y1))); const h = Math.max(0, base-y);
        s += `<rect x="${cx-bw/2}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(3,bw/3)}" fill="${se.color}"/>`; puntos.push({x:cx, y, p, se}); });
    } else if (se.tipo==='puntos'){
      d.forEach(p=>{ const cx = X(p.x), cy = Y(p.y), r = p.r||4.5;
        s += se.hueco ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--papel)" stroke="${p.color||se.color}" stroke-width="2"/>` : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.color||se.color}" stroke="#fff" stroke-width="1.5"/>`;
        puntos.push({x:cx, y:cy, p, se}); });
    } else {
      // líneas: se cortan donde hay saltos grandes de tiempo
      let tramo = [], tramos = [];
      d.forEach((p,i)=>{ if (i && se.corte && p.x-d[i-1].x > se.corte){ tramos.push(tramo); tramo = []; } tramo.push(p); });
      tramos.push(tramo);
      tramos.forEach(tr=>{ if (tr.length) s += `<polyline fill="none" stroke="${se.color}" stroke-width="${se.grosor||2}" ${se.discontinua?'stroke-dasharray="6 4"':''} stroke-linejoin="round" points="${tr.map(p=>X(p.x)+','+Y(p.y)).join(' ')}"/>`; });
      if (se.marcas) d.forEach(p=>{ s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="${se.color}" stroke="#fff" stroke-width="1"/>`; });
      d.forEach(p=>puntos.push({x:X(p.x), y:Y(p.y), p, se}));
    }
  });
  (cfg.refs||[]).forEach(r=>{ s += `<line x1="${ML}" x2="${W-MR}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.color||'var(--roca)'}" stroke-width="2" ${r.discontinua?'stroke-dasharray="6 4"':''}/>`; if (r.texto) s += `<text x="${W-MR-4}" y="${Y(r.y)-5}" font-size="11.5" text-anchor="end" fill="var(--roca)" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(r.texto)}</text>`; });
  s += '</svg>';
  const lienzo = document.createElement('div');
  lienzo.className = 'lienzo';
  lienzo.innerHTML = s + '<div class="tooltip" role="status"></div>';
  cont.appendChild(lienzo);
  const svg = lienzo.querySelector('svg'), tip = lienzo.querySelector('.tooltip');
  const buscar = ev=>{
    const r = svg.getBoundingClientRect(), k = W/r.width, mx = (ev.clientX-r.left)*k, my = (ev.clientY-r.top)*k;
    let mejor = null, dm = Infinity;
    puntos.forEach(q=>{ const dd = cfg.hoverX ? Math.abs(q.x-mx) : Math.hypot(q.x-mx, (q.y-my)*0.6); if (dd<dm){ dm = dd; mejor = q; } });
    return dm < 26 ? {q:mejor, k} : null;
  };
  svg.addEventListener('mousemove', ev=>{
    const b = buscar(ev);
    if (!b || !cfg.tooltip){ tip.classList.remove('on'); svg.style.cursor=''; return; }
    tip.innerHTML = cfg.tooltip(b.q.p, b.q.se);
    tip.style.left = (b.q.x/b.k)+'px'; tip.style.top = (b.q.y/b.k)+'px';
    tip.classList.add('on');
    svg.style.cursor = cfg.alClic ? 'pointer' : '';
  });
  svg.addEventListener('mouseleave', ()=>tip.classList.remove('on'));
  if (cfg.alClic) svg.addEventListener('click', ev=>{ const b = buscar(ev); if (b) cfg.alClic(b.q.p, b.q.se); });
  return {X, Y};
}
function leyenda(el, items){
  el.innerHTML = items.map(i=>`<span><span class="${i.forma||'linea'}" style="background:${i.color}${i.borde?';border:2px solid '+i.borde+';background:var(--papel)':''}"></span>${esc(i.texto)}</span>`).join('');
}

/* ---------- CSV ---------- */
function aCSV(filas, cols){
  const q = v => { v = v==null ? '' : String(v); return /[",\n;]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  return [cols.join(','), ...filas.map(f=>cols.map(c=>q(f[c])).join(','))].join('\n');
}
function descargar(nombre, texto, tipo='text/csv'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], {type:tipo+';charset=utf-8'}));
  a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
function leerCSV(texto){
  texto = texto.replace(/^﻿/, '');
  const prim = texto.split('\n')[0];
  const sep = [',',';','\t'].sort((a,b)=>prim.split(b).length-prim.split(a).length)[0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i=0; i<texto.length; i++){
    const c = texto[i];
    if (comillas){ if (c==='"'){ if (texto[i+1]==='"'){ campo += '"'; i++; } else comillas = false; } else campo += c; }
    else if (c==='"') comillas = true;
    else if (c===sep){ fila.push(campo); campo = ''; }
    else if (c==='\n'){ fila.push(campo.replace(/\r$/,'')); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length){ fila.push(campo.replace(/\r$/,'')); filas.push(fila); }
  const cab = filas.shift().map(h=>h.trim());
  return filas.filter(f=>f.length>1 || (f[0]||'').trim()).map(f=>Object.fromEntries(cab.map((h,i)=>[h, f[i]])));
}

/* ---------- Almacenamiento liviano ---------- */
const guardado = {
  leer(k, def){ try{ const v = localStorage.getItem('nieve.'+k); return v==null ? def : JSON.parse(v); }catch(e){ return def; } },
  escribir(k, v){ try{ localStorage.setItem('nieve.'+k, JSON.stringify(v)); }catch(e){} }
};

window.NIEVE = {papersActivos, fijarPapers, ALCANCE, popupEstudio, CONFIG, CUENCAS, FUENTES, LUGARES, CONSECUENCIAS, consecuenciasDe, distanciaKm, rumbo, difAngulo, CAT, BANDAS, COL, CATEGORICA, OTROS, SECUENCIAL, MES,
  lineaNieveReferencia, num, fecha, parseFecha, esc, encabezado, cargarCapa, CAPAS, poligonoQueContiene,
  dentro, bboxDe, nombreDe, tablaPropiedades, crearMapa, panelCapas, capasReferencia, grafico, leyenda,
  aCSV, descargar, leerCSV, guardado, json};
})();
