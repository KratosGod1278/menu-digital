#!/usr/bin/env node
/**
 * scripts/migrar-base64-a-storage.js
 *
 * Migra las imágenes base64 del array `DATA` (hoy hardcodeado dentro de
 * menu-digital.html) hacia Supabase Storage, y crea/actualiza las filas
 * correspondientes en las tablas `categorias` y `productos`.
 *
 * USO:
 *   node scripts/migrar-base64-a-storage.js <slug-del-negocio> <archivo.html>
 *
 * Ejemplo:
 *   node scripts/migrar-base64-a-storage.js sq1 menu-digital.html
 *
 * REQUISITOS PREVIOS:
 *   - El negocio (slug) y su menú ya deben existir en la tabla `negocios`/`menus`
 *     (el schema.sql de ejemplo ya crea "sq1" con un menú "Menú principal").
 *   - .env local (NO commiteado) con:
 *       SUPABASE_URL=https://tu-proyecto.supabase.co
 *       SUPABASE_SECRET_KEY=sb_secret_...
 *
 * Este script usa la SECRET KEY porque necesita bypassear RLS para insertar
 * datos administrativamente. Por eso corre solo local/manual — nunca se
 * ejecuta en el navegador ni se sube el .env al repo.
 *
 * Es idempotente: si lo corres dos veces, no duplica categorías ni productos
 * ya migrados (se identifican por nombre de categoría y nombre de archivo
 * de imagen).
 */

import "dotenv/config";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = "menu-imagenes";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en tu .env local.");
  process.exit(1);
}

const NEGOCIO_SLUG = process.argv[2];
const HTML_FILE = process.argv[3];

if (!NEGOCIO_SLUG || !HTML_FILE) {
  console.error(
    "Uso: node scripts/migrar-base64-a-storage.js <slug-negocio> <archivo.html>"
  );
  process.exit(1);
}

// Cliente con secret key: bypassa RLS. Solo se usa aquí, nunca en el navegador.
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Extrae el array `DATA` del HTML como objeto JS real (no JSON estricto). */
function extraerDataArray(htmlPath) {
  const contenido = fs.readFileSync(htmlPath, "utf-8");
  const inicio = contenido.indexOf("const DATA = [");
  if (inicio === -1)
    throw new Error(`No se encontró "const DATA = [" en ${htmlPath}`);
  const finMarcador = contenido.indexOf("];", inicio);
  if (finMarcador === -1)
    throw new Error('No se encontró el cierre "];" del array DATA');
  const arrayTexto = contenido.slice(
    inicio + "const DATA = ".length,
    finMarcador + 1
  );
  // Evaluamos el literal como JS (archivo local de confianza, no input externo).
  return new Function(`return ${arrayTexto}`)();
}

async function subirImagen(b64, nombreArchivo) {
  const buffer = Buffer.from(b64, "base64");
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(nombreArchivo, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(nombreArchivo);
  return data.publicUrl;
}

async function obtenerONegocioYMenu() {
  const { data: negocio, error: errNegocio } = await supabase
    .from("negocios")
    .select("id")
    .eq("slug", NEGOCIO_SLUG)
    .single();
  if (errNegocio || !negocio) {
    throw new Error(
      `No existe un negocio con slug "${NEGOCIO_SLUG}". Créalo primero en Supabase.`
    );
  }

  const { data: menu, error: errMenu } = await supabase
    .from("menus")
    .select("id")
    .eq("negocio_id", negocio.id)
    .limit(1)
    .single();
  if (errMenu || !menu) {
    throw new Error(
      `El negocio "${NEGOCIO_SLUG}" no tiene ningún menú creado. Créalo primero.`
    );
  }

  return { negocio, menu };
}

async function obtenerOCrearCategoria(menuId, nombre) {
  const { data: existente } = await supabase
    .from("categorias")
    .select("id")
    .eq("menu_id", menuId)
    .eq("nombre", nombre)
    .maybeSingle();

  if (existente) return existente.id;

  const { data: nueva, error } = await supabase
    .from("categorias")
    .insert({ menu_id: menuId, nombre })
    .select("id")
    .single();
  if (error) throw error;
  return nueva.id;
}

async function main() {
  console.log(
    `Migrando "${HTML_FILE}" hacia el negocio "${NEGOCIO_SLUG}"...\n`
  );

  const { menu } = await obtenerONegocioYMenu();
  const grupos = extraerDataArray(HTML_FILE);

  let creados = 0;
  let omitidos = 0;

  for (const grupo of grupos) {
    const categoriaId = await obtenerOCrearCategoria(menu.id, grupo.label);
    console.log(`Categoría: ${grupo.label}`);

    for (let i = 0; i < grupo.images.length; i++) {
      const img = grupo.images[i];
      const nombreArchivo = `${grupo.id}-${i + 1}.jpg`;

      // Idempotencia: si ya existe un producto con esta imagen en esta categoría, se omite.
      const { data: existente } = await supabase
        .from("productos")
        .select("id")
        .eq("categoria_id", categoriaId)
        .like("imagen_url", `%${nombreArchivo}`)
        .maybeSingle();

      if (existente) {
        console.log(`  omitido (ya existe): ${nombreArchivo}`);
        omitidos++;
        continue;
      }

      const url = await subirImagen(img.b64, nombreArchivo);

      const { error: errProd } = await supabase.from("productos").insert({
        categoria_id: categoriaId,
        nombre: `${grupo.label} #${i + 1}`,
        descripcion: "",
        imagen_url: url,
        disponible: true,
        orden: i,
      });
      if (errProd) throw errProd;

      console.log(`  migrado: ${nombreArchivo}`);
      creados++;
    }
  }

  console.log(
    `\nListo. ${creados} productos creados, ${omitidos} ya existían.`
  );
  console.log(
    "IMPORTANTE: los nombres son placeholders — corrígelos desde el backoffice."
  );
}

main().catch((err) => {
  console.error("\nError en la migración:", err.message);
  process.exit(1);
});
