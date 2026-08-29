/* ============================================================
   backoffice.js — Login + edición de productos + imagen
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

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_SIZE_MB = 5;

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

    const { data: asignaciones, error: errAsig } = await window.sb
      .from("negocio_editores")
      .select("negocio_id")
      .eq("usuario_id", currentUser.id);

    if (errAsig || !asignaciones || asignaciones.length === 0) {
      productsList.innerHTML = '<p class="empty">No tenés negocios asignados para editar.</p>';
      return;
    }
    const negocioIds = asignaciones.map((a) => a.negocio_id);

    const { data: productos, error } = await window.sb
      .from("productos")
      .select("*, categorias!inner(nombre, menus!inner(negocio_id, negocios(nombre)))")
      .in("categorias.menus.negocio_id", negocioIds);

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
      const imgSrc = p.imagen_url || "";

      card.innerHTML = `
        ${imgSrc ? '<img src="' + escapeHtml(imgSrc) + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:10px;" alt="">' : ''}
        <div class="cat-label">${escapeHtml(catName)}</div>
        <div class="prod-name">${escapeHtml(p.nombre)}</div>
        ${p.descripcion ? '<p class="prod-desc">' + escapeHtml(p.descripcion) + '</p>' : ''}
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
          <label>Imagen</label>
          <img class="img-preview" id="preview-${p.id}" src="${escapeHtml(imgSrc)}" alt="Preview">
          <div class="file-row">
            <label class="btn-file" for="file-${p.id}">Elegir imagen</label>
            <input type="file" id="file-${p.id}" accept="image/jpeg,image/png,image/webp">
            <span class="file-name" id="filename-${p.id}">${imgSrc ? 'Imagen actual' : 'Sin imagen'}</span>
          </div>
          <div class="upload-msg" id="uploadmsg-${p.id}"></div>
          <div class="form-actions">
            <button class="btn-save" onclick="saveProduct('${p.id}')">Guardar</button>
            <button class="btn-cancel" onclick="toggleEdit('${p.id}')">Cancelar</button>
          </div>
          <div class="save-msg" id="msg-${p.id}"></div>
        </div>
      `;
      productsList.appendChild(card);

      // File input change handler
      const fileInput = card.querySelector(`#file-${p.id}`);
      const preview = card.querySelector(`#preview-${p.id}`);
      const fileName = card.querySelector(`#filename-${p.id}`);
      const uploadMsg = card.querySelector(`#uploadmsg-${p.id}`);

      if (imgSrc) {
        preview.classList.add("visible");
      }

      fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) return;

        uploadMsg.className = "upload-msg";
        uploadMsg.textContent = "";

        if (!ALLOWED_TYPES.includes(file.type)) {
          uploadMsg.className = "upload-msg err";
          uploadMsg.textContent = "Formato no permitido. Usá JPG, PNG o WebP.";
          fileInput.value = "";
          return;
        }
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          uploadMsg.className = "upload-msg err";
          uploadMsg.textContent = `Máximo ${MAX_SIZE_MB} MB.`;
          fileInput.value = "";
          return;
        }

        fileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = () => {
          preview.src = reader.result;
          preview.classList.add("visible");
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ── Toggle edit form ──────────────────────────────────────
  window.toggleEdit = function (id) {
    const form = document.getElementById("form-" + id);
    form.classList.toggle("open");
  };

  // ── Upload image to Storage ───────────────────────────────
  async function uploadImage(productId, file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `productos/${productId}.${ext}`;

    const { error } = await window.sb.storage
      .from("menu-imagenes")
      .upload(path, file, { contentType: file.type, upsert: true });

    if (error) throw error;

    const { data } = window.sb.storage
      .from("menu-imagenes")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  // ── Save product ──────────────────────────────────────────
  window.saveProduct = async function (id) {
    const nombre = document.getElementById("name-" + id).value.trim();
    const descripcion = document.getElementById("desc-" + id).value.trim();
    const disponible = document.getElementById("disp-" + id).checked;
    const fileInput = document.getElementById("file-" + id);
    const msgEl = document.getElementById("msg-" + id);
    const uploadMsg = document.getElementById("uploadmsg-" + id);

    if (!nombre) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "El nombre no puede estar vacío.";
      return;
    }

    msgEl.className = "save-msg";
    msgEl.textContent = "Guardando…";
    uploadMsg.textContent = "";

    let imagen_url = undefined;

    // Upload new image if selected
    if (fileInput.files && fileInput.files[0]) {
      uploadMsg.className = "upload-msg";
      uploadMsg.textContent = "Subiendo imagen…";
      try {
        imagen_url = await uploadImage(id, fileInput.files[0]);
        uploadMsg.className = "upload-msg ok";
        uploadMsg.textContent = "Imagen subida ✓";
      } catch (err) {
        msgEl.className = "save-msg err";
        msgEl.textContent = "Error subiendo imagen: " + err.message;
        uploadMsg.textContent = "";
        return;
      }
    }

    // Build update payload
    const payload = { nombre, descripcion: descripcion || null, disponible };
    if (imagen_url !== undefined) payload.imagen_url = imagen_url;

    const { error } = await window.sb
      .from("productos")
      .update(payload)
      .eq("id", id);

    if (error) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Error: " + error.message;
      return;
    }

    // Verify the save actually persisted (RLS can silently block updates)
    const { data: verify, error: errVerify } = await window.sb
      .from("productos")
      .select("nombre, descripcion, disponible, imagen_url")
      .eq("id", id)
      .single();

    if (errVerify || !verify) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Guardado pero no se pudo verificar.";
      return;
    }

    // Check if values actually changed (detects silent RLS blocks)
    const changed =
      verify.nombre === nombre &&
      (verify.descripcion || "") === (descripcion || "") &&
      verify.disponible === disponible &&
      (imagen_url === undefined || verify.imagen_url === imagen_url);

    if (!changed) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Sin permisos para editar este producto.";
      return;
    }

    msgEl.className = "save-msg ok";
    msgEl.textContent = "Guardado ✓";

    // Update card in-place from verified data
    const card = msgEl.closest(".product-card");
    card.querySelector(".prod-name").textContent = verify.nombre;
    card.querySelector(".prod-desc").textContent = verify.descripcion || "";
    const statusEl = card.querySelector(".prod-status");
    statusEl.className = "prod-status " + (verify.disponible ? "on" : "off");
    statusEl.textContent = verify.disponible ? "Disponible" : "Agotado";

    if (verify.imagen_url) {
      const preview = card.querySelector(`#preview-${id}`);
      if (preview) {
        preview.src = verify.imagen_url;
        preview.classList.add("visible");
      }
      const fileName = card.querySelector(`#filename-${id}`);
      if (fileName) fileName.textContent = "Imagen actual";
    }

    // Reset file input
    fileInput.value = "";

    setTimeout(() => { msgEl.textContent = ""; uploadMsg.textContent = ""; }, 2500);
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
