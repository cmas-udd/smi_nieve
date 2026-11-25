#!/usr/bin/env python3
"""
Descarga las capas base del monitor de nieve y las guarda en datos/ como GeoJSON.

Capas:
  subcuencas.geojson  Subcuencas DGA (servicio de división de cuencas del MMA)
  cuencas.geojson     Cuencas DGA (mismo servicio, nivel superior)
  rios.geojson        Red hidrográfica MOP 1:250.000, o ríos de OpenStreetMap si falla
  caminos.geojson     Red vial MOP (Vialidad), o caminos de OpenStreetMap si falla
  faenas.geojson      Faenas mineras (IDE de la Superintendencia del Medio Ambiente)
  relaves.geojson     Depósitos de relaves (SERNAGEOMIN, publicado por la SMA)
  volcanes.geojson    Volcanes activos, ranking de riesgo SERNAGEOMIN

Uso (desde la carpeta del sitio):
  python herramientas/descargar_capas.py
  python herramientas/descargar_capas.py --capas subcuencas rios

Solo usa la biblioteca estándar de Python 3.8 o superior. Después de correrlo,
sube la carpeta datos/ al repositorio junto con las páginas.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

AOI = dict(s=-34.43, w=-70.88, n=-32.665, e=-69.074)
MMA = "https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_DIVISION_CUENCA/MapServer"
OVERPASS = "https://overpass-api.de/api/interpreter"
DECIMALES = 5

FUENTES = {
    "subcuencas": [
        ("arcgis", dict(base=MMA, capa=1, offset=0.001, nom="MMA, subcuencas DGA")),
    ],
    "cuencas": [
        ("arcgis", dict(base=MMA, capa=0, offset=0.002, nom="MMA, cuencas DGA")),
    ],
    "rios": [
        ("arcgis", dict(base="https://wservice-sit.mop.gov.cl/ArcGIS/rest/services/MAPA_BASE/RED_HIDROGRAFICA/MapServer", capa=16, offset=0.0005, nom="MOP, red hidrográfica 1:250.000")),
        ("arcgis", dict(base="https://wservice-sit.mop.gov.cl/ArcGIS/rest/services/MAPA_BASE/RED_HIDROGRAFICA/MapServer", capa=13, offset=0.0005, nom="MOP, red hidrográfica 1:500.000")),
        ("overpass", dict(consulta='way["waterway"="river"]', nom="OpenStreetMap, ríos")),
    ],
    "faenas": [
        ("arcgis", dict(base="https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Industria_y_actividades/MapServer", capa=2, offset=0, nom="SMA, faenas mineras")),
    ],
    "relaves": [
        ("arcgis", dict(base="https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Industria_y_actividades/MapServer", capa=4, offset=0, nom="SERNAGEOMIN vía SMA, depósitos de relaves")),
    ],
    "volcanes": [
        ("arcgis", dict(base="https://sdngsig.sernageomin.cl/gissdng/rest/services/Publico/Ranking_Volcanes_Chile/MapServer", capa=0, offset=0, nom="SERNAGEOMIN, ranking de volcanes activos")),
    ],
    "caminos": [
        ("arcgis", dict(base="https://services3.arcgis.com/Dhl01RVOOnbjTdY7/ArcGIS/rest/services/RED_VIAL_MOP/FeatureServer", capa=0, offset=0.0003, nom="MOP Vialidad, red vial")),
        ("arcgis", dict(base="https://rest-sit.mop.gob.cl/arcgis/rest/services/VIALIDAD/Red_Vial_Estructurante/MapServer", capa=0, offset=0.0003, nom="MOP Vialidad, red vial estructurante")),
        ("overpass", dict(consulta='way["highway"~"^(primary|secondary|tertiary|unclassified|track)$"]', este=-70.55, nom="OpenStreetMap, caminos")),
    ],
}


def pedir(url, datos=None, intentos=3, espera=60):
    cab = {"User-Agent": "monitor-nieve-andes/1.0 (uso academico)"}
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, data=datos, headers=cab)
            with urllib.request.urlopen(req, timeout=espera) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == intentos - 1:
                raise
            print(f"    reintento {i + 1} tras error: {e}")
            time.sleep(3 * (i + 1))


def area_firmada(anillo):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(anillo, anillo[1:] + anillo[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2


def punto_en_anillo(p, anillo):
    x, y = p
    dentro = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i]
        xj, yj = anillo[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def redondear(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], DECIMALES), round(c[1], DECIMALES)]
    return [redondear(x) for x in c]


def anillos_a_multipoligono(anillos):
    """Esri: exteriores en sentido horario, agujeros antihorario. GeoJSON: al revés."""
    ext, agu = [], []
    for a in anillos:
        if len(a) < 4:
            continue
        (ext if area_firmada(a) < 0 else agu).append(a)
    if not ext:  # orientación inesperada: todo como exterior
        ext, agu = agu, []
    polis = [[list(reversed(e))] for e in ext]
    for h in agu:
        for k, e in enumerate(ext):
            if punto_en_anillo(h[0], e):
                polis[k].append(h)
                break
    return {"type": "MultiPolygon", "coordinates": redondear(polis)}


def esri_a_geojson(f):
    g = f.get("geometry") or {}
    if "rings" in g:
        geom = anillos_a_multipoligono(g["rings"])
    elif "paths" in g:
        geom = {"type": "MultiLineString", "coordinates": redondear(g["paths"])}
    elif "x" in g:
        geom = {"type": "Point", "coordinates": redondear([g["x"], g["y"]])}
    else:
        return None
    props = {k: v for k, v in (f.get("attributes") or {}).items()
             if not k.lower().startswith(("shape", "globalid", "created_", "last_edited"))}
    return {"type": "Feature", "properties": props, "geometry": geom}


def desde_arcgis(base, capa, offset, nom):
    a = AOI
    todas, desde = [], 0
    for _ in range(30):
        p = dict(where="1=1", geometry=f"{a['w']},{a['s']},{a['e']},{a['n']}",
                 geometryType="esriGeometryEnvelope", inSR="4326",
                 spatialRel="esriSpatialRelIntersects", outFields="*",
                 returnGeometry="true", outSR="4326", f="json",
                 )
        if offset:
            p["maxAllowableOffset"] = str(offset)
        if desde:
            p["resultOffset"] = str(desde)
        d = pedir(f"{base}/{capa}/query?" + urllib.parse.urlencode(p))
        if "error" in d:
            raise RuntimeError(d["error"].get("message", "error del servicio"))
        feats = [x for x in (esri_a_geojson(f) for f in d.get("features", [])) if x]
        todas += feats
        if not d.get("exceededTransferLimit") or not feats:
            break
        desde += len(feats)
    return todas


def desde_overpass(consulta, nom, este=None):
    a = AOI
    w = max(a["w"], este) if este is not None else a["w"]
    q = f'[out:json][timeout:180];({consulta}({a["s"]},{w},{a["n"]},{a["e"]}););out geom;'
    d = pedir(OVERPASS, datos=urllib.parse.urlencode({"data": q}).encode(), espera=200)
    feats = []
    for x in d.get("elements", []):
        if "geometry" not in x:
            continue
        tags = x.get("tags", {})
        props = {k: tags[k] for k in ("name", "ref", "highway", "waterway", "surface") if k in tags}
        props["fuente"] = "OSM"
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString",
                                   "coordinates": redondear([[p["lon"], p["lat"]] for p in x["geometry"]])}})
    return feats


def descargar(nombre, carpeta):
    print(f"\n{nombre}")
    for tipo, cfg in FUENTES[nombre]:
        print(f"  probando {cfg['nom']}...")
        try:
            if tipo == "arcgis":
                feats = desde_arcgis(cfg["base"], cfg["capa"], cfg["offset"], cfg["nom"])
            else:
                feats = desde_overpass(cfg["consulta"], cfg["nom"], cfg.get("este"))
            if not feats:
                raise RuntimeError("sin elementos en la zona")
            fc = {"type": "FeatureCollection", "fuente": cfg["nom"],
                  "descargado": time.strftime("%Y-%m-%d"), "features": feats}
            ruta = os.path.join(carpeta, nombre + ".geojson")
            with open(ruta, "w", encoding="utf-8") as fh:
                json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))
            print(f"  listo: {len(feats)} elementos, {os.path.getsize(ruta) / 1e6:.1f} MB en {ruta}")
            return True
        except Exception as e:  # noqa: BLE001
            print(f"  no funcionó: {e}")
    print(f"  ninguna fuente respondió para {nombre}")
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--capas", nargs="+", choices=list(FUENTES), default=list(FUENTES))
    ap.add_argument("--salida", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datos"))
    args = ap.parse_args()
    os.makedirs(args.salida, exist_ok=True)
    ok = [descargar(c, args.salida) for c in args.capas]
    print("\nResumen:", ", ".join(f"{c} {'ok' if k else 'falló'}" for c, k in zip(args.capas, ok)))
    sys.exit(0 if all(ok) else 1)


if __name__ == "__main__":
    main()
