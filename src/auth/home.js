/* ============================================================
   home.js — Dashboard "Inicio" post-login del backoffice
   Muestra: Negocios, Populares, Productos, Imagenes.
   Reutiliza tokens de color de home.html y las consultas a Supabase.
   ============================================================ */

(function () {
  "use strict";

  const CACHE_KEY = "bo_session";

  let currentUser = null;

  // ── Helpers ───────────────────────────────────────────────
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

  function railEmpty(id, msg) {
    const el = document.getElementById(id);
    if (el && el.children.length === 0) {
      el.innerHTML = '<p class="empty-block">' + escapeHtml(msg) + "</p>";
    }
  }

  // ── Logout (usa la misma sesión que backoffice) ──────────
  window.doLogout = async function () {
    if (window.sb) await window.sb.auth.signOut();
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    window.location.href = "backoffice.html";
  };

  // ── Navegación (hacia el backoffice de gestión) ──────────
  const MANAGE = "backoffice.html?view=productos";
  window.goAllBusinesses = function () { window.location.href = MANAGE; };
  window.goAllImages = function () { window.location.href = MANAGE; };
  window.goNewProduct = function () { window.location.href = MANAGE + "#nuevo"; };
  window.editProduct = function (id) { window.location.href = MANAGE + "#edit:" + id; };

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    // 1. Sesión real de Supabase
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      // Sin sesión real: intentar sesión cacheada o ir a login
      let cached = null;
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) cached = JSON.parse(raw).user;
      } catch (e) {}
      if (!cached) { window.location.href = "backoffice.html"; return; }
      // Hay cache pero no sesión viva: volver a backoffice a re-logear
      window.location.href = "backoffice.html";
      return;
    }
    currentUser = session.user;

    setGreeting(currentUser);
    await loadDashboard();
  }

  function setGreeting(user) {
    // Preferimos el nombre del primer negocio o del email
    const email = user.email || "";
    const base = email.split("@")[0];
    const parts = (base || "").split(/[._ ]+/).filter(Boolean);
    const name = parts.slice(0, 2).map(p => p[0]?.toUpperCase() + p.slice(1)).join(" ");
    const greeting = name || "Admin";
    document.getElementById("barGreet").textContent = "Hola, " + greeting;
    document.getElementById("barAvatar").textContent = initials(greeting);
  }

  async function loadDashboard() {
    // ── 1. Negocios asignados ──
    const { data: asig, error: errAsig } = await window.sb
      .from("negocio_editores")
      .select("negocio_id")
      .eq("usuario_id", currentUser.id);

    if (errAsig || !asig || asig.length === 0) {
      document.getElementById("bizRail").innerHTML = '<p class="empty-block">No tenés negocios asignados.</p>';
      return;
    }
    const negocioIds = asig.map(a => a.negocio_id);

    // ── 2. Cargar en paralelo: negocios y menús ──
    const [negResp, menResp] = await Promise.all([
      window.sb.from("negocios").select("id, nombre, slug").in("id", negocioIds),
      window.sb.from("menus").select("id, negocio_id, nombre").in("negocio_id", negocioIds),
    ]);

    // Categorías y productos dependen de los menús → seguidilla
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
      cats = cRes.data || [];
      productos = pRes.data || [];
      ofertas = oRes.data || [];
    }

    const negocios = negResp?.data || [];
    const bizMap = {};
    negocios.forEach(n => { bizMap[n.id] = n.nombre; });
    const menuMap = {};
    menus.forEach(m => { menuMap[m.id] = { negocio_id: m.negocio_id, nombre: m.nombre }; });

    // Adjuntar info de negocio a cada producto
    productos.forEach(p => {
      const m = menuMap[p.categorias?.menu_id];
      p._bizName = (m && bizMap[m.negocio_id]) || "";
      p._menuName = m?.nombre || "";
      p._catName = p.categorias?.nombre || "Sin categoría";
    });

    renderBusinesses(negocios);
    renderPopulares(productos);
    renderProducts(productos);
    renderImages(productos, ofertas, bizMap);
  }

  // ── Negocios (Menus) ─────────────────────────────────────
  function renderBusinesses(negocios) {
    const rail = document.getElementById("bizRail");
    rail.innerHTML = "";

    // Botón "agregar negocio" no existe aún → placeholder
    if (!negocios.length) {
      rail.innerHTML = '<p class="empty-block">Aún no tenés negocios.</p>';
      return;
    }

    negocios.forEach(n => {
      const wrap = document.createElement("div");
      wrap.className = "biz-avatar-wrap";
      // Sin logo en la tabla: avatar con inicial + nombre
      wrap.innerHTML =
        '<button class="biz-avatar" onclick="editProduct(\'' + n.id + '\')" title="Editar ' + escapeHtml(n.nombre) + '">' +
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
      rail.innerHTML = '<p class="empty-block">Sin productos aún.</p>';
      return;
    }
    top.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "pop-card" + (p.imagen_url ? "" : " noimg");
      const img = p.imagen_url
        ? '<img class="pop-img" src="' + escapeHtml(p.imagen_url) + '" alt="" loading="lazy">'
        : '<div class="pop-img">' + (i + 1) + "</div>";
      card.innerHTML =
        img +
        '<div class="pop-body">' +
          '<span class="pop-tag">Destacado</span>' +
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
      rail.innerHTML = '<p class="empty-block">Sin productos.</p>';
      return;
    }
    list.forEach(p => {
      const card = document.createElement("div");
      card.className = "prod-card";
      const thumb = p.imagen_url
        ? '<img src="' + escapeHtml(p.imagen_url) + '" alt="">'
        : '<span style="font-size:24px">🍽</span>';
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
        onOpen: () => window.location.href = MANAGE
      });
    });

    if (!cards.length) {
      rail.innerHTML = '<p class="empty-block">Aún no hay imágenes subidas.</p>';
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
