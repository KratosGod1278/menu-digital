/* ============================================================
   supabaseClient.js — Inicializa el cliente de Supabase
   Sin bundler: carga vía CDN + variables en window.__ENV__
   ============================================================ */

(function () {
  "use strict";

  const env = window.__ENV__ || {};
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error(
      "[supabaseClient] Faltan SUPABASE_URL o SUPABASE_ANON_KEY en window.__ENV__"
    );
    return;
  }

  if (typeof supabase === "undefined" || !supabase.createClient) {
    console.error(
      "[supabaseClient] El SDK de Supabase no está cargado. Agregá el <script> del CDN antes de este archivo."
    );
    return;
  }

  window.sb = supabase.createClient(url, key);
})();
