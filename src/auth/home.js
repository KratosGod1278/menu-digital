/* ============================================================
   home.js — Dashboard "Inicio" post-login del backoffice
   Muestra: resumen, Negocios, Populares, Productos, Imagenes.
   Reutiliza tokens de color de home.html y las consultas a Supabase.
   Toda la lógica de datos (Supabase) se conserva sin cambios;
   lo nuevo es: skeletons de carga, estados de error con reintento
   y las tarjetas de resumen.
   ============================================================ */

(function () {
  "use strict";

  const CACHE_KEY = "bo_session";
  const MANAGE = "backoffice.html?view=productos";

  let currentUser = null;

  // ── Helpers de escape / formato ─────────────────────────
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    const s = String(name || "?");
    const parts = s.trim().split(/\s+/);
    const c = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
    return (c || "?").toUpperCase();
  }

  // ── Estados de sección: vacío / error con reintento ─────
  function stateBlock(container, { icon, title, msg, isError, onRetry }) {
    if (!container) return;
    const btnId = "retry_" + Math.random().toString(36).slice(2, 8);
    container.innerHTML =
      '<div class="state-block' + (isError ? " is-error" : "") + '">' +
        '<i class="fa-solid ' + escapeHtml(icon) + '" aria-hidden="true"></i>' +
        '<div class="state-text">' +
          (title ? "<b>" + escapeHtml(title) + "</b>" : "") +
          escapeHtml(msg) +
          (onRetry ? '<button type="button" class="retry-btn" id="' + btnId + '">Reintentar</button>' : "") +
        "</div>" +
      "</div>";
    if (onRetry) {
      const btn = document.getElementById(btnId);
      if (btn) btn.addEventListener("click", onRetry);
    }
  }

  // ── Skeletons de carga por sección ──────────────────────
  function showSkeletons() {
    const biz = document.getElementById("bizRail");
    if (biz) {
      biz.innerHTML = Array.from({ length: 5 }).map(() =>
        '<div class="sk-avatar-wrap">' +
          '<div class="sk-avatar skeleton"></div>' +
          '<div class="sk-avatar-label skeleton"></div>' +
        "</div>"
      ).join("");
    }
    const pop = document.getElementById("popRail");
    if (pop) {
      pop.innerHTML = Array.from({ length: 3 }).map(() =>
        '<div class="sk-pop">' +
          '<div class="sk-pop-img skeleton"></div>' +
          '<div class="sk-pop-body">' +
            '<div class="sk-line skeleton" style="width:40%"></div>' +
            '<div class="sk-line skeleton" style="width:75%"></div>' +
          "</div>" +
        "</div>"
      ).join("");
    }
    const prod = document.getElementById("prodRail");
    if (prod) {
      prod.innerHTML = Array.from({ length: 6 }).map(() =>
        '<div class="sk-prod">' +
          '<div class="sk-thumb skeleton"></div>' +
          '<div class="sk-line skeleton"></div>' +
        "</div>"
      ).join("");
    }
    const img = document.getElementById("imgRail");
    if (img) {
      img.innerHTML = Array.from({ length: 5 }).map(() =>
        '<div class="sk-prod" style="width:134px">' +
          '<div class="sk-thumb skeleton" style="width:134px;height:134px"></div>' +
        "</div>"
      ).join("");
    }
  }

  // ── Logout (usa la misma sesión que backoffice) ──────────
  window.doLogout = async function () {
    if (!confirm("¿Cerrar sesión?")) return;
    if (window.sb) await window.sb.auth.signOut();
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    window.location.href = "backoffice.html";
  };

  // ── Navegación (hacia el backoffice de gestión) ──────────
  window.goAllBusinesses = function () { window.location.href = MANAGE; };
  window.goAllImages = function () { window.location.href = MANAGE; };
  window.goNewProduct = function () { window.location.href = MANAGE + "#nuevo"; };
  window.editProduct = function (id) { window.location.href = MANAGE + "#edit:" + id; };

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      let cached = null;
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) cached = JSON.parse(raw).user;
      } catch (e) {}
      if (!cached) { window.location.href = "backoffice.html"; return; }
      window.location.href = "backoffice.html";
      return;
    }
    currentUser = session.user;

    setGreeting(currentUser);
    showSkeletons();
    await loadDashboard();
  }

  function setGreeting(user) {
    const email = user.email || "";
    const base = email.split("@")[0];
    const parts = (base || "").split(/[._ ]+/).filter(Boolean);
    const name = parts.slice(0, 2).map(p => p[0]?.toUpperCase() + p.slice(1)).join(" ");
    const greeting = name || "Admin";
    document.getElementById("barGreet").textContent = "Hola, " + greeting;
    document.getElementById("barAvatar").textContent = initials(greeting);
  }

  async function loadDashboard() {
    try {
      // ── 1. Negocios asignados ──
      const { data: asig, error: errAsig } = await window.sb
        .from("negocio_editores")
        .select("negocio_id")
        .eq("usuario_id", currentUser.id);

      if (errAsig) throw errAsig;

      if (!asig || asig.length === 0) {
        renderStats({ negocios: 0, productos: 0, ofertas: 0 });
        stateBlock(document.getElementById("bizRail"), {
          icon: "fa-store-slash", msg: "No tenés negocios asignados todavía."
        });
        clearRail("popRail", "fa-star", "Aún no hay productos destacados.");
        clearRail("prodRail", "fa-utensils", "Sin productos aún.");
        clearRail("imgRail", "fa-images", "Aún no hay imágenes subidas.");
        return;
      }
      const negocioIds = asig.map(a => a.negocio_id);

      // ── 2. Cargar en paralelo: negocios y menús ──
      const [negResp, menResp] = await Promise.all([
        window.sb.from("negocios").select("id, nombre, slug").in("id", negocioIds),
        window.sb.from("menus").select("id, negocio_id, nombre").in("negocio_id", negocioIds),
      ]);
      if (negResp.error) throw negResp.error;
      if (menResp.error) throw menResp.error;

      let cats = [];
      let productos = [];
      let ofertas = [];
      const menus = menResp?.data || [];

      if (menus.length > 0) {
        const menuIds = menus.map(m => m.id);
        const catQuery = window.sb
          .from("categorias")
          .select("id, nombre, menu_id")
          .in("menu_id", menuIds);
        const prodQuery = window.sb
          .from("productos")
          .select("*, categorias!inner(id, menu_id, nombre)")
          .in("categorias.menu_id", menuIds)
          .order("updated_at", { ascending: false });
        const ofertQuery = window.sb
          .from("ofertas")
          .select("id, negocio_id, imagen_url, activa")
          .in("negocio_id", negocioIds)
          .eq("activa", true)
          .order("orden");

        const [cRes, pRes, oRes] = await Promise.all([catQuery, prodQuery, ofertQuery]);
        if (cRes.error) throw cRes.error;
        if (pRes.error) throw pRes.error;
        if (oRes.error) throw oRes.error;
        cats = cRes.data || [];
        productos = pRes.data || [];
        ofertas = oRes.data || [];
      }

      const negocios = negResp?.data || [];
      const bizMap = {};
      negocios.forEach(n => { bizMap[n.id] = n.nombre; });
      const menuMap = {};
      menus.forEach(m => { menuMap[m.id] = { negocio_id: m.negocio_id, nombre: m.nombre }; });

      productos.forEach(p => {
        const m = menuMap[p.categorias?.menu_id];
        p._bizName = (m && bizMap[m.negocio_id]) || "";
        p._menuName = m?.nombre || "";
        p._catName = p.categorias?.nombre || "Sin categoría";
      });

      renderStats({ negocios: negocios.length, productos: productos.length, ofertas: ofertas.length });
      renderBusinesses(negocios);
      renderPopulares(productos);
      renderProducts(productos);
      renderImages(productos, ofertas, bizMap);
    } catch (err) {
      console.error("[home] Error cargando el dashboard:", err);
      renderStatsError();
      const retry = () => { showSkeletons(); loadDashboard(); };
      stateBlock(document.getElementById("bizRail"), {
        icon: "fa-triangle-exclamation", title: "No se pudo cargar",
        msg: "Revisá tu conexión e intentá de nuevo.", isError: true, onRetry: retry
      });
      stateBlock(document.getElementById("popRail"), {
        icon: "fa-triangle-exclamation", msg: "No se pudieron cargar los destacados.", isError: true, onRetry: retry
      });
      stateBlock(document.getElementById("prodRail"), {
        icon: "fa-triangle-exclamation", msg: "No se pudieron cargar los productos.", isError: true, onRetry: retry
      });
      stateBlock(document.getElementById("imgRail"), {
        icon: "fa-triangle-exclamation", msg: "No se pudieron cargar las imágenes.", isError: true, onRetry: retry
      });
    }
  }

  function clearRail(id, icon, msg) {
    stateBlock(document.getElementById(id), { icon, msg });
  }

  // ── Resumen (stats) ─────────────────────────────────────
  function renderStats({ negocios, productos, ofertas }) {
    const row = document.getElementById("statsRow");
    if (!row) return;
    row.innerHTML =
      statCard("fa-store", negocios, "Negocios") +
      statCard("fa-utensils", productos, "Productos") +
      statCard("fa-tags", ofertas, "Ofertas activas", true);
  }
  function statCard(icon, value, label, gold) {
    return '<div class="stat-card' + (gold ? " gold" : "") + '">' +
      '<div class="stat-value">' + Number(value || 0) + "</div>" +
      '<div class="stat-label"><i class="fa-solid ' + icon + '" aria-hidden="true" style="margin-right:6px;opacity:.7"></i>' + escapeHtml(label) + "</div>" +
    "</div>";
  }
  function renderStatsError() {
    const row = document.getElementById("statsRow");
    if (!row) return;
    row.innerHTML = statCard("fa-store", "—", "Negocios") +
      statCard("fa-utensils", "—", "Productos") +
      statCard("fa-tags", "—", "Ofertas activas", true);
  }

  // ── Negocios (Menus) ─────────────────────────────────────
  function renderBusinesses(negocios) {
    const rail = document.getElementById("bizRail");
    rail.innerHTML = "";

    if (!negocios.length) {
      stateBlock(rail, { icon: "fa-store-slash", msg: "Aún no tenés negocios." });
      return;
    }

    negocios.forEach(n => {
      const wrap = document.createElement("div");
      wrap.className = "biz-avatar-wrap";
      wrap.innerHTML =
        '<button type="button" class="biz-avatar" onclick="editProduct(\'' + n.id + '\')" title="Editar ' + escapeHtml(n.nombre) + '" aria-label="Editar ' + escapeHtml(n.nombre) + '">' +
          escapeHtml(initials(n.nombre)) +
        "</button>" +
        '<span class="biz-avatar-name">' + escapeHtml(n.nombre) + "</span>";
      rail.appendChild(wrap);
    });
  }

  // ── Populares (destacados, por actualización reciente) ──
  function renderPopulares(productos) {
    const rail = document.getElementById("popRail");
    rail.innerHTML = "";
    const top = productos.slice(0, 5);
    if (!top.length) {
      stateBlock(rail, { icon: "fa-star", msg: "Sin productos aún." });
      return;
    }
    top.forEach((p) => {
      const card = document.createElement("div");
      card.className = "pop-card" + (p.imagen_url ? "" : " noimg");
      const img = p.imagen_url
        ? '<img class="pop-img" src="' + escapeHtml(p.imagen_url) + '" alt="" loading="lazy">'
        : '<div class="pop-img"><i class="fa-solid fa-martini-glass-citrus" aria-hidden="true"></i></div>';
      card.innerHTML =
        img +
        '<div class="pop-body">' +
          '<span class="pop-tag"><i class="fa-solid fa-star" aria-hidden="true"></i>Destacado</span>' +
          '<div class="pop-name">' + escapeHtml(p.nombre) + "</div>" +
          '<div class="pop-biz">' + escapeHtml(p._bizName || p._catName) + "</div>" +
        "</div>";
      card.onclick = () => editProduct(p.id);
      rail.appendChild(card);
    });
  }

  // ── Productos (grid de cards cuadradas) ─────────────────
  function renderProducts(productos) {
    const rail = document.getElementById("prodRail");
    rail.innerHTML = "";
    const list = productos.slice(0, 30);
    if (!list.length) {
      stateBlock(rail, { icon: "fa-utensils", msg: "Sin productos." });
      return;
    }
    list.forEach(p => {
      const card = document.createElement("div");
      card.className = "prod-card";
      const thumb = p.imagen_url
        ? '<img src="' + escapeHtml(p.imagen_url) + '" alt="">'
        : '<i class="fa-solid fa-utensils" aria-hidden="true"></i>';
      card.innerHTML =
        '<div class="thumb">' + thumb + "</div>" +
        '<div class="p-name">' + escapeHtml(p.nombre) + "</div>";
      card.onclick = () => editProduct(p.id);
      rail.appendChild(card);
    });
  }

  // ── Imagenes (galería: productos con foto + ofertas) ────
  function renderImages(productos, ofertas, bizMap) {
    const rail = document.getElementById("imgRail");
    rail.innerHTML = "";
    const cards = [];

    productos.forEach(p => {
      if (!p.imagen_url) return;
      cards.push({
        img: p.imagen_url,
        title: p.nombre,
        sub: p._bizName || p._catName,
        onOpen: () => editProduct(p.id)
      });
    });

    ofertas.forEach(o => {
      if (!o.imagen_url) return;
      cards.push({
        img: o.imagen_url,
        title: "Oferta",
        sub: bizMap[o.negocio_id] || "",
        onOpen: () => { window.location.href = MANAGE; }
      });
    });

    if (!cards.length) {
      stateBlock(rail, { icon: "fa-images", msg: "Aún no hay imágenes subidas." });
      return;
    }

    cards.slice(0, 30).forEach(c => {
      const card = document.createElement("div");
      card.className = "img-card";
      card.innerHTML =
        '<div class="thumb"><img src="' + escapeHtml(c.img) + '" alt="" loading="lazy"></div>' +
        '<div class="cap">' +
          '<div class="cap-title">' + escapeHtml(c.title) + "</div>" +
          '<div class="cap-sub">' + escapeHtml(c.sub) + "</div>" +
        "</div>";
      card.onclick = c.onOpen;
      rail.appendChild(card);
    });
  }

  init();
})();