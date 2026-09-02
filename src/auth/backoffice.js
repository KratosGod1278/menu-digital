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
  const CACHE_KEY = "bo_session";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 día

  let currentUser = null;
  let userNegocios = [];  // cached for add form
  let userMenus = [];
  let userCats = [];

  // ── Session cache helpers ─────────────────────────────────
  function saveSession(user) {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      user: { id: user.id, email: user.email },
      ts: Date.now()
    }));
  }

  function getCachedSession() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { user, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return user;
    } catch {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(CACHE_KEY);
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    // 1. Check Supabase real session first
    const { data: { session } } = await window.sb.auth.getSession();
    if (session) {
      currentUser = session.user;
      saveSession(session.user);
      showProducts();
      return;
    }

    // 2. Try cached session → re-authenticate silently
    const cached = getCachedSession();
    if (cached) {
      loginError.textContent = "Reconectando…";
      loginBtn.disabled = true;
      // We have the email but need to re-authenticate via Supabase
      // Since we can't restore password from cache, show login with email pre-filled
      loginEmail.value = cached.email;
      loginError.textContent = "Tu sesión expiró. Ingresá la contraseña.";
      loginBtn.disabled = false;
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
    saveSession(data.user);
    showProducts();
  };

  loginPass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.doLogin();
  });

  // ── Logout ────────────────────────────────────────────────
  window.doLogout = async function () {
    await window.sb.auth.signOut();
    clearSession();
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
    productsView.style.display = "block";
    productsList.innerHTML = '<p style="text-align:center;color:var(--muted);">Cargando…</p>';

    console.log('[backoffice] currentUser:', currentUser?.id, currentUser?.email);

    const { data: asignaciones, error: errAsig } = await window.sb
      .from("negocio_editores")
      .select("negocio_id")
      .eq("usuario_id", currentUser.id);

    console.log('[backoffice] asignaciones:', asignaciones, 'error:', errAsig);

    if (errAsig || !asignaciones || asignaciones.length === 0) {
      productsList.innerHTML = '<p class="empty">No tenés negocios asignados para editar.</p>';
      return;
    }
    const negocioIds = asignaciones.map((a) => a.negocio_id);

    // Step 1: get menus for assigned businesses
    const { data: menus, error: errMenus } = await window.sb
      .from("menus")
      .select("id, negocio_id")
      .in("negocio_id", negocioIds);

    console.log('[backoffice] menus:', menus?.length, 'error:', errMenus);

    if (!menus || menus.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay menús.</p>';
      return;
    }

    // Step 2: get categories for those menus
    const menuIds = menus.map(m => m.id);
    const { data: cats, error: errCats } = await window.sb
      .from("categorias")
      .select("id, nombre, menu_id")
      .in("menu_id", menuIds);

    console.log('[backoffice] cats:', cats?.length, 'error:', errCats);

    if (!cats || cats.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay categorías.</p>';
      return;
    }

    // Step 3: get products with their category (single query with inner join)
    const { data: productos, error } = await window.sb
      .from("productos")
      .select("*, categorias!inner(id, nombre, orden, menu_id)")
      .in("categorias.menu_id", menuIds)
      .order("orden")
      .order("orden", { referencedTable: "categorias" });

    console.log('[backoffice] productos:', productos?.length, 'error:', error);

    if (error) {
      productsList.innerHTML = '<p class="empty">Error cargando productos: ' + escapeHtml(error.message) + '</p>';
      return;
    }

    if (!productos || productos.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay productos.</p>';
      return;
    }

    // Build lookup maps for names
    const menuMap = {};
    menus.forEach(m => { menuMap[m.id] = m.negocio_id; });
    const { data: negociosData } = await window.sb.from("negocios").select("id, nombre");
    const bizMap = {};
    negociosData?.forEach(n => { bizMap[n.id] = n.nombre; });

    // Attach display info to each product (category comes embedded from the join)
    productos.forEach(p => {
      p._catName = p.categorias?.nombre || "Sin categoría";
      const menuId = p.categorias?.menu_id;
      const bizId = menuMap[menuId];
      p._bizName = bizMap[bizId] || "";
    });

    renderProducts(productos);
  }

  // ── Render ────────────────────────────────────────────────
  function renderProducts(productos) {
    productsList.innerHTML = "";

    productos.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card";
      const catName = p._catName || "Sin categoría";
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

  // ── Add product form ──────────────────────────────────────
  const addForm = document.getElementById("addProductForm");
  const addNegocio = document.getElementById("addNegocio");
  const addMenu = document.getElementById("addMenu");
  const addCategoria = document.getElementById("addCategoria");
  const addNombre = document.getElementById("addNombre");
  const addDesc = document.getElementById("addDesc");
  const addDisponible = document.getElementById("addDisponible");
  const addFile = document.getElementById("addFile");
  const addPreview = document.getElementById("addPreview");
  const addFileName = document.getElementById("addFileName");
  const addUploadMsg = document.getElementById("addUploadMsg");
  const addSaveMsg = document.getElementById("addSaveMsg");
  const btnNewCat = document.getElementById("btnNewCat");
  const newCatWrap = document.getElementById("newCatWrap");
  const addNewCatName = document.getElementById("addNewCatName");

  document.getElementById("btnAddProduct").onclick = () => {
    addForm.classList.toggle("open");
    if (addForm.classList.contains("open")) loadAddFormData();
  };
  document.getElementById("btnCancelAdd").onclick = () => {
    addForm.classList.remove("open");
    resetAddForm();
  };

  btnNewCat.onclick = () => {
    const showing = newCatWrap.style.display !== "none";
    newCatWrap.style.display = showing ? "none" : "";
    btnNewCat.textContent = showing ? "+ Nueva" : "Usar existente";
    if (!showing) addCategoria.disabled = true;
    else { addCategoria.disabled = false; addNewCatName.value = ""; }
  };

  addFile.addEventListener("change", () => {
    const file = addFile.files[0];
    if (!file) return;
    addUploadMsg.textContent = "";
    if (!ALLOWED_TYPES.includes(file.type)) {
      addUploadMsg.className = "upload-msg err";
      addUploadMsg.textContent = "Formato no permitido. JPG, PNG o WebP.";
      addFile.value = "";
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      addUploadMsg.className = "upload-msg err";
      addUploadMsg.textContent = "Máximo " + MAX_SIZE_MB + " MB.";
      addFile.value = "";
      return;
    }
    addFileName.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => { addPreview.src = reader.result; addPreview.classList.add("visible"); };
    reader.readAsDataURL(file);
  });

  async function loadAddFormData() {
    // Negocios
    addNegocio.innerHTML = '<option value="">Cargando…</option>';
    const { data: asig } = await window.sb.from("negocio_editores")
      .select("negocio_id, negocios(id, nombre)").eq("usuario_id", currentUser.id);
    userNegocios = asig?.map(a => a.negocios).filter(Boolean) || [];
    addNegocio.innerHTML = userNegocios.map(n =>
      '<option value="' + n.id + '">' + escapeHtml(n.nombre) + '</option>'
    ).join('');

    addNegocio.onchange = loadMenusForNegocio;
    addMenu.onchange = loadCatsForMenu;
    await loadMenusForNegocio();
  }

  async function loadMenusForNegocio() {
    const nid = addNegocio.value;
    const { data: menus } = await window.sb.from("menus").select("id, nombre").eq("negocio_id", nid);
    userMenus = menus || [];
    addMenu.innerHTML = userMenus.map(m =>
      '<option value="' + m.id + '">' + escapeHtml(m.nombre) + '</option>'
    ).join('');
    await loadCatsForMenu();
  }

  async function loadCatsForMenu() {
    const mid = addMenu.value;
    const { data: cats } = await window.sb.from("categorias").select("id, nombre").eq("menu_id", mid);
    userCats = cats || [];
    addCategoria.innerHTML = userCats.map(c =>
      '<option value="' + c.id + '">' + escapeHtml(c.nombre) + '</option>'
    ).join('');
    if (!userCats.length) {
      addCategoria.innerHTML = '<option value="">Sin categorías — creá una nueva</option>';
      newCatWrap.style.display = "";
      btnNewCat.textContent = "Usar existente";
      addCategoria.disabled = true;
    } else if (newCatWrap.style.display === "none") {
      addCategoria.disabled = false;
    }
  }

  function resetAddForm() {
    addNombre.value = "";
    addDesc.value = "";
    addDisponible.checked = true;
    addFile.value = "";
    addPreview.src = "";
    addPreview.classList.remove("visible");
    addFileName.textContent = "Sin imagen";
    addUploadMsg.textContent = "";
    addSaveMsg.textContent = "";
    newCatWrap.style.display = "none";
    btnNewCat.textContent = "+ Nueva";
    addCategoria.disabled = false;
  }

  document.getElementById("btnSaveNew").onclick = async () => {
    const nombre = addNombre.value.trim();
    if (!nombre) {
      addSaveMsg.className = "save-msg err";
      addSaveMsg.textContent = "El nombre es obligatorio.";
      return;
    }

    addSaveMsg.className = "save-msg";
    addSaveMsg.textContent = "Creando…";
    addUploadMsg.textContent = "";

    // Resolve category
    let categoriaId = addCategoria.value;
    if (!categoriaId || newCatWrap.style.display !== "none") {
      // Create new category
      const catName = addNewCatName.value.trim();
      if (!catName) {
        addSaveMsg.className = "save-msg err";
        addSaveMsg.textContent = "Ingresá un nombre para la categoría.";
        return;
      }
      const menuId = addMenu.value;
      const { data: newCat, error: catErr } = await window.sb
        .from("categorias").insert({ menu_id: menuId, nombre: catName, orden: 0 }).select().single();
      if (catErr) {
        addSaveMsg.className = "save-msg err";
        addSaveMsg.textContent = "Error creando categoría: " + catErr.message;
        return;
      }
      categoriaId = newCat.id;
    }

    // Create product first (without image)
    const { data: newProd, error: prodErr } = await window.sb
      .from("productos").insert({
        categoria_id: categoriaId,
        nombre: nombre,
        descripcion: addDesc.value.trim() || null,
        disponible: addDisponible.checked,
        imagen_url: null
      }).select().single();

    if (prodErr) {
      addSaveMsg.className = "save-msg err";
      addSaveMsg.textContent = "Error: " + prodErr.message;
      return;
    }

    // Upload image if selected
    if (addFile.files && addFile.files[0]) {
      addUploadMsg.className = "upload-msg";
      addUploadMsg.textContent = "Subiendo imagen…";
      try {
        const url = await uploadImage(newProd.id, addFile.files[0]);
        await window.sb.from("productos").update({ imagen_url: url }).eq("id", newProd.id);
        addUploadMsg.className = "upload-msg ok";
        addUploadMsg.textContent = "Imagen subida ✓";
      } catch (err) {
        addSaveMsg.className = "save-msg ok";
        addSaveMsg.textContent = "Producto creado ✓ (sin imagen: " + err.message + ")";
        setTimeout(() => { addForm.classList.remove("open"); resetAddForm(); showProducts(); }, 1500);
        return;
      }
    }

    addSaveMsg.className = "save-msg ok";
    addSaveMsg.textContent = "Producto creado ✓";
    setTimeout(() => { addForm.classList.remove("open"); resetAddForm(); showProducts(); }, 1200);
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
