#!/usr/bin/env node
/**
 * scripts/optimizar-imagenes-storage.js
 *
 * Recomprime las imágenes YA subidas al bucket `menu-imagenes`: las descarga,
 * auto-orientan (EXIF), redimensionan y re-codifican a WebP. Sube cada grupo a
 * un path versionado, actualiza `imagen_url` en la base y borra el archivo
 * anterior, salvo que se pase `--keep-old`.
 *
 * Las ofertas usan 1080px (son flyers con texto) y los productos 800px.
 *
 * Las filas que comparten el mismo archivo se procesan como un grupo: se sube
 * una sola versión y se actualizan todas, para no dejar ninguna sin imagen.
 *
 * Es idempotente: los paths ya versionados (`<id>-<13 dígitos>.webp`) se saltan.
 *
 * USO:
 *   node scripts/optimizar-imagenes-storage.js                    # dry-run
 *   node scripts/optimizar-imagenes-storage.js --apply --keep-old  # migra sin borrar
 *   node scripts/optimizar-imagenes-storage.js --purge             # lista huérfanos
 *   node scripts/optimizar-imagenes-storage.js --purge --apply     # borra huérfanos
 *
 *   --limit=N   procesa solo las primeras N filas de cada tabla
 *
 * REQUISITOS PREVIOS:
 *   - .env local (NO commiteado) con:
 *       SUPABASE_URL=https://tu-proyecto.supabase.co
 *       SUPABASE_SECRET_KEY=sb_secret_...
 *
 * Usa la SECRET KEY porque necesita bypassear RLS. Corre solo local/manual.
 * Con `--apply` escribe un respaldo de `imagen_url` en `scripts/backups/`.
 *
 * Tablas: `productos` y `ofertas`.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = "menu-imagenes";
const CACHE_1Y = 31536000;
const TABLAS = ["productos", "ofertas"];
const ANCHO_POR_TABLA = { productos: 800, ofertas: 1080 };
const BACKUP_DIR = "scripts/backups";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en tu .env local.");
  process.exit(1);
}

const APLICAR = process.argv.includes("--apply");
const KEEP_OLD = process.argv.includes("--keep-old");
const PURGE = process.argv.includes("--purge");
const SOLO_MIGRADOS = process.argv.includes("--solo-migrados");
const argLimit = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = argLimit ? parseInt(argLimit.split("=")[1], 10) : Infinity;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const kb = (bytes) => (bytes / 1024).toFixed(0) + " KB";

/** Path del bucket a partir de la URL pública. "" si no pertenece al bucket. */
function pathDeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split(`/object/public/${BUCKET}/`)[1] || "");
  } catch {
    return "";
  }
}

/** true si el path ya fue optimizado por este script. */
function yaOptimizado(p) {
  return /-\d{13}\.webp$/.test(p);
}

/** Último manifiesto escrito por una migración, o null si no hay. */
function leerUltimoManifiesto() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const archivos = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("migrados-") && f.endsWith(".json"))
    .sort();
  if (!archivos.length) return null;
  const destino = path.join(BACKUP_DIR, archivos[archivos.length - 1]);
  return { destino, datos: JSON.parse(fs.readFileSync(destino, "utf8")) };
}

/** Todas las filas con imagen, de las dos tablas. */
async function leerFilas() {
  const filas = [];
  for (const tabla of TABLAS) {
    let q = supabase
      .from(tabla)
      .select("id, imagen_url")
      .not("imagen_url", "is", null);
    if (Number.isFinite(LIMIT)) q = q.limit(LIMIT);
    const { data, error } = await q;
    if (error) {
      console.error(`[${tabla}] No se pudieron leer las filas: ${error.message}`);
      continue;
    }
    for (const f of data || []) filas.push({ tabla, id: f.id, imagen_url: f.imagen_url });
  }
  return filas;
}

async function escribirRespaldo() {
  const filas = await leerFilas();
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const destino = path.join(BACKUP_DIR, `imagen_url-${sello}.json`);
  fs.writeFileSync(destino, JSON.stringify(filas, null, 2));
  console.log(`Respaldo escrito en ${destino} (${filas.length} filas)\n`);
  return filas;
}

async function listarBucket() {
  const archivos = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 1000, offset: cursor });
    if (error || !data || data.length === 0) break;
    for (const carpeta of data) {
      if (carpeta.id) {
        archivos.push(carpeta.name);
        continue;
      }
      const { data: inner } = await supabase.storage
        .from(BUCKET)
        .list(carpeta.name, { limit: 1000 });
      for (const f of inner || []) archivos.push(`${carpeta.name}/${f.name}`);
    }
    if (data.length < 1000) break;
    cursor += 1000;
  }
  return archivos;
}

// ── Purga de huérfanos ─────────────────────────────────────
if (PURGE) {
  const filas = await leerFilas();
  const referenciados = new Set(filas.map((f) => pathDeUrl(f.imagen_url)).filter(Boolean));
  const enBucket = await listarBucket();
  let huerfanos = enBucket.filter((p) => !referenciados.has(p));

  if (SOLO_MIGRADOS) {
    const manifiesto = leerUltimoManifiesto();
    if (!manifiesto) {
      console.error("No hay manifiestos de migración en " + BACKUP_DIR + ".");
      process.exit(1);
    }
    const mios = new Set(manifiesto.datos.map((m) => m.original));
    const fuera = huerfanos.filter((p) => !mios.has(p));
    huerfanos = huerfanos.filter((p) => mios.has(p));
    console.log(`Manifiesto: ${manifiesto.destino}`);
    console.log(
      `Se dejan intactos ${fuera.length} huérfanos ajenos a la migración:\n` +
        (fuera.map((p) => `  ${p}`).join("\n") || "  (ninguno)")
    );
  }

  console.log(`En el bucket: ${enBucket.length}`);
  console.log(`Referenciados en la base: ${referenciados.size}`);
  console.log(`Huérfanos: ${huerfanos.length}`);
  huerfanos.forEach((p) => console.log(`  ${p}`));

  if (!APLICAR) {
    const como = SOLO_MIGRADOS ? "--purge --solo-migrados --apply" : "--purge --apply";
    console.log(`\nDry-run: no se borró nada. Corré con ${como} para borrarlos.`);
  } else if (huerfanos.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(huerfanos);
    if (error) {
      console.error(`No se pudieron borrar: ${error.message}`);
      process.exit(1);
    }
    console.log(`\nBorrados ${huerfanos.length} huérfanos.`);
  }
  process.exit(0);
}

// ── Migración ──────────────────────────────────────────────
const lineas = await leerFilas();

// Un grupo por archivo compartido, para subir una sola versión.
const grupos = new Map();
for (const fila of lineas) {
  const p = pathDeUrl(fila.imagen_url);
  if (!p || yaOptimizado(p)) continue;
  if (!grupos.has(p)) grupos.set(p, []);
  grupos.get(p).push(fila);
}

if (APLICAR) await escribirRespaldo();

let antes = 0;
let despues = 0;
let saltadas = 0;
let fallos = 0;
let procesadas = 0;
const manifiesto = [];

for (const [pathViejo, filas] of grupos) {
  const ancho = ANCHO_POR_TABLA[filas[0].tabla] || 800;
  const { data: blob, error: errDl } = await supabase.storage
    .from(BUCKET)
    .download(pathViejo);

  if (errDl || !blob) {
    console.error(`${pathViejo}: no se pudo descargar (${errDl?.message}).`);
    fallos++;
    continue;
  }

  const original = Buffer.from(await blob.arrayBuffer());

  let optimizada;
  try {
    optimizada = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width: ancho, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error(`${pathViejo}: no se pudo procesar (${e.message}).`);
    fallos++;
    continue;
  }

  if (optimizada.length >= original.length) {
    console.log(`${pathViejo}: ya es liviana (${kb(original.length)}), se omite.`);
    saltadas++;
    continue;
  }

  antes += original.length;
  despues += optimizada.length;
  procesadas++;

  const carpeta = pathViejo.includes("/")
    ? pathViejo.split("/")[0]
    : { productos: "productos", ofertas: "ofertas" }[filas[0].tabla];
  const nuevoPath = `${carpeta}/${filas[0].id}-${Date.now()}.webp`;
  const nuevaUrl = supabase.storage.from(BUCKET).getPublicUrl(nuevoPath).data.publicUrl;
  const donde = filas.map((f) => f.tabla).join("+");

  if (!APLICAR) {
    console.log(
      `  ${pathViejo} [${ancho}px, ${donde}]: ${kb(original.length)} -> ${kb(optimizada.length)}`
    );
    continue;
  }

  const { error: errUp } = await supabase.storage
    .from(BUCKET)
    .upload(nuevoPath, optimizada, {
      contentType: "image/webp",
      cacheControl: String(CACHE_1Y),
    });

  if (errUp) {
    console.error(`${pathViejo}: falló la subida (${errUp.message}).`);
    fallos++;
    continue;
  }

  let actualizadas = 0;
  for (const fila of filas) {
    const { error: errDb } = await supabase
      .from(fila.tabla)
      .update({ imagen_url: nuevaUrl })
      .eq("id", fila.id);
    if (errDb) {
      console.error(`${fila.tabla}/${fila.id}: falló el update (${errDb.message}).`);
      continue;
    }
    actualizadas++;
  }

  if (actualizadas < filas.length) {
    console.error(
      `${pathViejo}: solo se actualizaron ${actualizadas}/${filas.length} filas; no se borra el original.`
    );
    fallos++;
    continue;
  }

  manifiesto.push({
    original: pathViejo,
    nuevo: nuevoPath,
    filas: filas.map((f) => ({ tabla: f.tabla, id: f.id })),
  });

  if (KEEP_OLD) {
    console.log(`${pathViejo} -> ${nuevoPath} [${actualizadas} filas] (original conservado)`);
  } else {
    await supabase.storage.from(BUCKET).remove([pathViejo]);
    console.log(`${pathViejo} -> ${nuevoPath} [${actualizadas} filas]`);
  }
}

console.log(`\nprocesadas: ${procesadas}  omitidas: ${saltadas}  fallos: ${fallos}`);
if (procesadas) {
  console.log(
    `total: ${kb(antes)} -> ${kb(despues)}  (ahorro ${((1 - despues / antes) * 100).toFixed(1)}%)`
  );
}
if (APLICAR && manifiesto.length) {
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const destino = path.join(BACKUP_DIR, `migrados-${sello}.json`);
  fs.writeFileSync(destino, JSON.stringify(manifiesto, null, 2));
  console.log(`\nManifiesto escrito en ${destino} (${manifiesto.length} originales)`);
}

if (!APLICAR) {
  console.log("\nDry-run: no se cambió nada.");
} else if (KEEP_OLD && procesadas) {
  console.log(
    "\n originales conservados. Verificá el menú y después:\n  node scripts/optimizar-imagenes-storage.js --purge --solo-migrados --apply"
  );
}
