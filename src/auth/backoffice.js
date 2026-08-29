/* ============================================================
   backoffice.js — Login + edición de productos
   ============================================================ */

(function () {
  "use strict";

  const loginView = document.getElementById("loginView");
  const productsView = document.getElementById("productsView");
  const productsList = document.getElementById("productsList");
  const loginEmail = document.getElementById("loginEmail");
  const loginPass = document.getElementById("loginPass");
  const loginBtn = document.getElementById("loginBtn");
  const loginError = document.getElementById("loginError");

  let currentUser = null;

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    const { data: { session } } = await window.sb.auth.getSession();
    if (session) {
      currentUser = session.user;
      showProducts();
    }
  }

  // ── Login ─────────────────────────────────────────────────
  window.doLogin = async function () {
    const email = loginEmail.value.trim();
    const pass = loginPass.value;
    if (!email || !pass) {
      loginError.textContent = "Completá email y contraseña.";
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Entrando…";
    loginError.textContent = "";

    const { data, error } = await window.sb.auth.signInWithPassword({
      email: email,
      password: pass,
    });

    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";

    if (error) {
      loginError.textContent = error.message;
      return;
    }

    currentUser = data.user;
    showProducts();
  };

  // Enter key submits
  loginPass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.doLogin();
  });

  // ── Logout ────────────────────────────────────────────────
  window.doLogout = async function () {
    await window.sb.auth.signOut();
    currentUser = null;
    productsView.style.display = "none";
    loginView.style.display = "";
    productsList.innerHTML = "";
    loginEmail.value = "";
    loginPass.value = "";
  };

  // ── Load products ─────────────────────────────────────────
  async function showProducts() {
    loginView.style.display = "none";
    productsView.style.display = "";
    productsList.innerHTML = '<p style="text-align:center;color:var(--muted);">Cargando…</p>';

    const { data: productos, error } = await window.sb
      .from("productos")
      .select("*, categorias(nombre, menus(negocio_id, negocios(nombre)))");

    if (error) {
      productsList.innerHTML = '<p class="empty">Error cargando productos.</p>';
      return;
    }

    if (!productos || productos.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay productos.</p>';
      return;
    }

    renderProducts(productos);
  }

  // ── Render ────────────────────────────────────────────────
  function renderProducts(productos) {
    productsList.innerHTML = "";

    productos.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card";
      const catName = p.categorias ? p.categorias.nombre : "Sin categoría";
      const statusClass = p.disponible ? "on" : "off";
      const statusText = p.disponible ? "Disponible" : "Agotado";

      card.innerHTML = `
        <div class="cat-label">${catName}</div>
        <div class="prod-name">${p.nombre}</div>
        ${p.descripcion ? '<p class="prod-desc">' + p.descripcion + '</p>' : ''}
        <div class="prod-status ${statusClass}">${statusText}</div>
        <button class="btn-edit" onclick="toggleEdit('${p.id}')">Editar</button>
        <div class="edit-form" id="form-${p.id}">
          <label>Nombre</label>
          <input type="text" id="name-${p.id}" value="${escapeHtml(p.nombre)}">
          <label>Descripcion</label>
          <textarea id="desc-${p.id}">${escapeHtml(p.descripcion || '')}</textarea>
          <div class="check-row">
            <input type="checkbox" id="disp-${p.id}" ${p.disponible ? 'checked' : ''}>
            <label for="disp-${p.id}" style="margin:0">Disponible</label>
          </div>
          <div class="form-actions">
            <button class="btn-save" onclick="saveProduct('${p.id}')">Guardar</button>
            <button class="btn-cancel" onclick="toggleEdit('${p.id}')">Cancelar</button>
          </div>
          <div class="save-msg" id="msg-${p.id}"></div>
        </div>
      `;
      productsList.appendChild(card);
    });
  }

  // ── Toggle edit form ──────────────────────────────────────
  window.toggleEdit = function (id) {
    const form = document.getElementById("form-" + id);
    form.classList.toggle("open");
  };

  // ── Save product ──────────────────────────────────────────
  window.saveProduct = async function (id) {
    const nombre = document.getElementById("name-" + id).value.trim();
    const descripcion = document.getElementById("desc-" + id).value.trim();
    const disponible = document.getElementById("disp-" + id).checked;
    const msgEl = document.getElementById("msg-" + id);

    if (!nombre) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "El nombre no puede estar vacío.";
      return;
    }

    msgEl.className = "save-msg";
    msgEl.textContent = "Guardando…";

    const { error } = await window.sb
      .from("productos")
      .update({ nombre, descripcion: descripcion || null, disponible })
      .eq("id", id);

    if (error) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Error: " + error.message;
      return;
    }

    msgEl.className = "save-msg ok";
    msgEl.textContent = "Guardado ✓";

    // Update card in-place
    const card = msgEl.closest(".product-card");
    card.querySelector(".prod-name").textContent = nombre;
    card.querySelector(".prod-desc").textContent = descripcion || "";
    const statusEl = card.querySelector(".prod-status");
    statusEl.className = "prod-status " + (disponible ? "on" : "off");
    statusEl.textContent = disponible ? "Disponible" : "Agotado";

    setTimeout(() => { msgEl.textContent = ""; }, 2000);
  };

  // ── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  init();
})();
