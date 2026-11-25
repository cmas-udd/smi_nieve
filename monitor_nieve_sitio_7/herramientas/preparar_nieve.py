#!/usr/bin/env python3
"""
Convierte la nieve diaria exportada desde Google Earth Engine en los archivos
que usa la página "Datos por fecha".

Entradas aceptadas (valores 0 = nubes o sin dato, 1 = sin nieve, 2 = nieve):
  a) una carpeta con un GeoTIFF por día, nieve_dia_AAAA_MM_DD.tif, con dos bandas:
     "nieve" (nubes rellenadas en GEE) y "nieve_sin_relleno" (tal como se ve).
     Si la carpeta trae linea_nieve_*.csv, también se procesa la línea de nieve.
  b) un GeoTIFF con una banda por día llamada dAAAA_MM_DD (formato anterior).

Salida en datos/:
  nieve_AAAA.js     todo el año en un archivo: fechas, grilla, estadísticas diarias,
                    clases sin rellenar y con relleno de GEE (4 píxeles por byte,
                    comprimidas) y la línea de nieve por zona y ladera (si hay CSV)
  nieve_indice.js   años disponibles

Se guardan como .js para que la página funcione también abierta desde el
computador (file://), donde el navegador no deja leer archivos .json o .bin.

La imagen se reproyecta a Web Mercator (EPSG:3857), la proyección de los mapas
del sitio, para que calce exacto sobre el mapa base.

Uso (desde la carpeta del sitio):
  python herramientas/preparar_nieve.py nieve_linea_diaria/
  python herramientas/preparar_nieve.py nieve_imagen_2023_jun_oct.tif
  python herramientas/preparar_nieve.py carpeta/ --linea otra_linea.csv

Requiere: numpy y rasterio (pip install numpy rasterio).
"""
import argparse
import base64
import csv
import glob
import json
import os
import re
import zlib

import numpy as np
import rasterio
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds

# Revisión de calidad de la línea de nieve (se documenta en el README):
NIEVE_MIN_PCT = 2.0      # con menos nieve visible, la "línea" queda en la cumbre de la zona: se marca sin_nieve
ERROR_DUDOSO_PCT = 15.0  # sobre este error de clasificación la línea se muestra como dudosa
PIXELES_MIN = 1000       # zonas más chicas (unos 250 km²) no se muestran por defecto


def fecha_de(texto):
    m = re.search(r"(\d{4})[_-](\d{2})[_-](\d{2})", texto or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def leer_carpeta(carpeta):
    archivos = sorted(glob.glob(os.path.join(carpeta, "nieve_dia_*.tif")))
    if not archivos:
        raise SystemExit("La carpeta no tiene archivos nieve_dia_AAAA_MM_DD.tif")
    fechas, crudas, gee = [], [], []
    perfil = None
    for f in archivos:
        with rasterio.open(f) as src:
            if perfil is None:
                perfil = (src.crs, src.transform, src.width, src.height, src.bounds, src.res)
            elif (src.width, src.height, src.transform) != (perfil[2], perfil[3], perfil[1]):
                raise SystemExit(f"{os.path.basename(f)} no tiene la misma grilla que el primer archivo")
            nombres = list(src.descriptions)
            b = src.read()
            i_cruda = nombres.index("nieve_sin_relleno") if "nieve_sin_relleno" in nombres else (1 if src.count > 1 else 0)
            i_gee = nombres.index("nieve") if "nieve" in nombres else 0
            crudas.append(b[i_cruda]); gee.append(b[i_gee])
        fechas.append(fecha_de(os.path.basename(f)))
    orden = np.argsort(fechas)
    fechas = [fechas[i] for i in orden]
    return fechas, np.stack([crudas[i] for i in orden]), np.stack([gee[i] for i in orden]), perfil


def leer_tif(ruta):
    with rasterio.open(ruta) as src:
        fechas = []
        for i, n in enumerate(src.descriptions):
            f = fecha_de(n)
            if not f:
                raise SystemExit(f"La banda {i + 1} no tiene fecha en el nombre ({n!r}); se esperaba dAAAA_MM_DD.")
            fechas.append(f)
        return fechas, src.read(), None, (src.crs, src.transform, src.width, src.height, src.bounds, src.res)


def a_mercator(pila, perfil):
    crs, transform, width, height, bounds, _ = perfil
    tr, W, H = calculate_default_transform(crs, "EPSG:3857", width, height, *bounds)
    destino = np.full((pila.shape[0], H, W), 255, np.uint8)
    for i in range(pila.shape[0]):
        reproject(pila[i], destino[i], src_transform=transform, src_crs=crs, dst_transform=tr,
                  dst_crs="EPSG:3857", resampling=Resampling.nearest, src_nodata=None, dst_nodata=255)
    destino[:, destino[0] == 255] = 0
    return destino, tr, W, H


def empaquetar(pila):
    plano = pila.reshape(pila.shape[0], -1)
    pad = (-plano.shape[1]) % 4
    if pad:
        plano = np.pad(plano, ((0, 0), (0, pad)))
    q = plano.reshape(plano.shape[0], -1, 4)
    return zlib.compress((q[..., 0] | (q[..., 1] << 2) | (q[..., 2] << 4) | (q[..., 3] << 6)).astype(np.uint8).tobytes(), 9)


def estadisticas(fechas, cruda, gee, km2):
    n_tot = cruda.shape[1] * cruda.shape[2]
    ultimo = np.zeros(cruda.shape[1:], np.uint8)
    stats = []
    for i, f in enumerate(fechas):
        b = cruda[i]
        desp = b > 0
        ultimo[desp] = b[desp]
        nie, sin, nub = int((b == 2).sum()), int((b == 1).sum()), int((b == 0).sum())
        s = {"f": f, "nieve_km2": round(nie * km2, 1), "sin_nieve_km2": round(sin * km2, 1),
             "nubes_pct": round(100 * nub / n_tot, 1),
             "nieve_estimada_km2": round(int((ultimo == 2).sum()) * km2, 1),
             "nieve_sobre_despejado_pct": round(100 * nie / (nie + sin), 1) if nie + sin else None}
        if gee is not None:
            g = gee[i]
            s["nieve_gee_km2"] = round(int((g == 2).sum()) * km2, 1)
            s["nubes_gee_pct"] = round(100 * int((g == 0).sum()) / n_tot, 1)
        stats.append(s)
    return stats


def preparar_linea(ruta, anio):
    """CSV de GEE: fecha, zona, ladera, linea_nieve_m, calidad, nieve_pct, nube_pct, nube_cruda_pct, error_pct, pixeles."""
    filas = list(csv.DictReader(open(ruta, encoding="utf-8-sig")))
    num = lambda v: float(v) if v not in (None, "", "nan", "NaN") else None
    zonas, idx_zona, fechas, idx_fecha = [], {}, [], {}
    LADERAS, CALIDADES = ["todas", "norte", "sur"], ["ok", "dudosa", "nubes", "sin_nieve", "sin_datos"]
    datos, corregidas = [], 0
    for r in filas:
        z = r["zona"].strip()
        if z not in idx_zona:
            m = re.search(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)", z)
            idx_zona[z] = len(zonas)
            zonas.append({"id": z, "lat": float(m.group(1)) if m else None, "lon": float(m.group(2)) if m else None,
                          "nombre": r.get("nombre") or r.get("zona_nombre") or "", "pixeles": num(r.get("pixeles"))})
        f = r["fecha"][:10]
        if f not in idx_fecha:
            idx_fecha[f] = len(fechas); fechas.append(f)
        linea, cal = num(r.get("linea_nieve_m")), (r.get("calidad") or "sin_datos").strip()
        nie, nub, err = num(r.get("nieve_pct")), num(r.get("nube_pct")), num(r.get("error_pct"))
        if cal == "ok" and nie is not None and nie < NIEVE_MIN_PCT:
            cal, linea = "sin_nieve", None; corregidas += 1
        elif cal == "ok" and err is not None and err > ERROR_DUDOSO_PCT:
            cal = "dudosa"
        if cal not in CALIDADES:
            CALIDADES.append(cal)
        datos.append([idx_fecha[f], idx_zona[z], LADERAS.index(r["ladera"]) if r["ladera"] in LADERAS else 0,
                      linea, CALIDADES.index(cal), nie, nub, err])
    for z in zonas:
        z["pequena"] = bool(z["pixeles"] is not None and z["pixeles"] < PIXELES_MIN)
    out = {"anio": anio, "archivo_origen": os.path.basename(ruta), "fechas": fechas, "zonas": zonas,
           "laderas": LADERAS, "calidades": CALIDADES,
           "reglas": {"nieve_min_pct": NIEVE_MIN_PCT, "error_dudoso_pct": ERROR_DUDOSO_PCT, "pixeles_min": PIXELES_MIN},
           "columnas": ["fecha", "zona", "ladera", "linea_m", "calidad", "nieve_pct", "nube_pct", "error_pct"], "datos": datos}
    print(f"línea de nieve: {len(zonas)} zonas, {len(fechas)} días; {corregidas} valores 'ok' con menos de "
          f"{NIEVE_MIN_PCT} % de nieve pasaron a sin_nieve")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada", help="carpeta con nieve_dia_*.tif o un GeoTIFF con una banda por día")
    ap.add_argument("--linea", help="CSV de línea de nieve (por defecto, linea_nieve_*.csv de la carpeta)")
    ap.add_argument("--anio", type=int, help="año (por defecto, el de la primera fecha)")
    ap.add_argument("--salida", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datos"))
    args = ap.parse_args()

    if os.path.isdir(args.entrada):
        fechas, cruda, gee, perfil = leer_carpeta(args.entrada)
        if not args.linea:
            csvs = sorted(glob.glob(os.path.join(args.entrada, "linea_nieve_*.csv")))
            args.linea = csvs[0] if csvs else None
    else:
        fechas, cruda, gee, perfil = leer_tif(args.entrada)
    anio = args.anio or int(fechas[0][:4])
    crs, _, _, _, _, res = perfil
    km2 = abs(res[0] * res[1]) / 1e6 if crs and crs.is_projected else 0.25

    os.makedirs(args.salida, exist_ok=True)
    base = os.path.join(args.salida, f"nieve_{anio}")
    m_cruda, tr, W, H = a_mercator(cruda, perfil)
    b_cruda = empaquetar(m_cruda)
    b_gee = empaquetar(a_mercator(gee, perfil)[0]) if gee is not None else None
    oeste, norte = tr.c, tr.f
    este, sur = oeste + tr.a * W, norte + tr.e * H
    lon_o, lat_s, lon_e, lat_n = transform_bounds("EPSG:3857", "EPSG:4326", oeste, sur, este, norte)
    meta = {
        "anio": anio, "fuente": "MODIS (Google Earth Engine)", "archivo_origen": os.path.basename(os.path.normpath(args.entrada)),
        "clases": {"0": "nubes o sin dato", "1": "sin nieve", "2": "nieve"}, "relleno_gee": gee is not None,
        "W": W, "H": H, "crs": "EPSG:3857", "mercator": [oeste, sur, este, norte],
        "latlon": [lon_o, lat_s, lon_e, lat_n], "km2_px_origen": km2,
        "fechas": fechas, "stats": estadisticas(fechas, cruda, gee, km2),
    }
    linea = preparar_linea(args.linea, anio) if args.linea else None
    datos = {"meta": meta, "cruda": base64.b64encode(b_cruda).decode(),
             "gee": base64.b64encode(b_gee).decode() if b_gee else None, "linea": linea}
    with open(base + ".js", "w", encoding="utf-8") as fh:
        fh.write(f"/* Nieve MODIS {anio}: generado por herramientas/preparar_nieve.py */\n")
        fh.write("window.NIEVE_ANIO=window.NIEVE_ANIO||{};\n")
        fh.write(f"window.NIEVE_ANIO[{anio}]=" + json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"{len(fechas)} días de {fechas[0]} a {fechas[-1]}, grilla {W} x {H}" + (", con relleno de GEE" if gee is not None else ""))
    print(f"listo: {base}.js ({os.path.getsize(base + '.js') / 1e6:.1f} MB)")
    # años disponibles: todos los nieve_AAAA.js de la carpeta
    anios = sorted(int(m.group(1)) for f in os.listdir(args.salida) for m in [re.fullmatch(r"nieve_(\d{4})\.js", f)] if m)
    with open(os.path.join(args.salida, "nieve_indice.js"), "w", encoding="utf-8") as fh:
        fh.write(f"window.NIEVE_INDICE={json.dumps(anios)};\n")
    print(f"datos/nieve_indice.js: {anios}")


if __name__ == "__main__":
    main()
