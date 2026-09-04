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
  const MAX_SIZE_MB = 20;
  const CACHE_KEY = "bo_session";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 día

  let currentUser = null;
  let userNegocios = [];  // cached for add form
  let userMenus = [];
  let userCats = [];
  let allMenus = [];
  let allCats = [];
  let allNegocios = [];

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
      // Inicio es el destino post-login, salvo que vengas a gestionar
      const view = new URLSearchParams(window.location.search).get("view");
      if (view === "productos") {
        showProducts();
      } else if (view === "ofertas") {
        showOfertas();
      } else {
        window.location.href = "home.html";
      }
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
    loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Entrando…</span>';
    loginError.textContent = "";

    const { data, error } = await window.sb.auth.signInWithPassword({
      email: email,
      password: pass,
    });

    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Acceder al sistema</span>';

    if (error) {
      loginError.textContent = error.message;
      return;
    }

    currentUser = data.user;
    saveSession(data.user);
    // Inicio es el destino post-login
    window.location.href = "home.html";
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
    ofertasView.style.display = "none";
    navTabs.style.display = "none";
    loginView.style.display = "";
    productsList.innerHTML = "";
    loginEmail.value = "";
    loginPass.value = "";
  };

  // ── Load products ─────────────────────────────────────────
  async function showProducts() {
    loginView.style.display = "none";
    productsView.style.display = "block";
    ofertasView.style.display = "none";
    setNav("productos");
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
      .select("id, negocio_id, nombre")
      .in("negocio_id", negocioIds);

    console.log('[backoffice] menus:', menus?.length, 'error:', errMenus);

    if (!menus || menus.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay menús.</p>';
      return;
    }

    // Step 2: get ALL categories (global — para que el desplegable las ofrezca
    // todas sin importar el negocio y el form de edición no salga vacío)
    const menuIds = menus.map(m => m.id);
    const { data: cats, error: errCats } = await window.sb
      .from("categorias")
      .select("id, nombre, menu_id");

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
      p._menuId = menuId;
      const bizId = menuMap[menuId];
      p._bizName = bizMap[bizId] || "";
    });

    // Store menus & cats globally for the edit form
    allMenus = menus.map(m => ({ ...m, negocio_nombre: bizMap[m.negocio_id] || "" }));
    allCats = cats.map(c => ({ ...c }));
    allNegocios = negociosData || [];

    renderProducts(productos, allMenus, allCats);
    handleDeepLink();
  }

  // ── Deep link: #edit:<id> abre la edición de un producto,
  //    #nuevo abre el formulario de alta (enlaces desde home.html) ──
  function handleDeepLink() {
    const h = window.location.hash || "";
    if (h === "#nuevo") {
      const btn = document.getElementById("btnAddProduct");
      if (btn && !document.getElementById("addProductForm").classList.contains("open")) {
        btn.click();
      }
      window.location.hash = "";
      return;
    }
    if (h.indexOf("#edit:") === 0) {
      const id = h.slice("#edit:".length);
      const form = document.getElementById("form-" + id);
      if (form) {
        form.classList.add("open");
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        // highlight briefly
        form.style.outline = "2px solid var(--gold)";
        setTimeout(() => { form.style.outline = ""; }, 1600);
      }
      window.location.hash = "";
    }
  }

  // ── Render: agrupa productos por Menú → Categoría → Productos ──
  function renderProducts(productos, menus, cats) {
    productsList.innerHTML = "";

    if (!productos || productos.length === 0) {
      productsList.innerHTML = '<p class="empty">No hay productos.</p>';
      return;
    }

    // Ordenar menús por negocio
    const sortedMenus = (menus || []).slice().sort((a, b) => {
      const na = (a.negocio_nombre || "").toLowerCase();
      const nb = (b.negocio_nombre || "").toLowerCase();
      return na.localeCompare(nb) || (a.nombre || "").localeCompare(b.nombre || "");
    });

    // Agrupar productos por menú, y dentro por categoría
    const byCat = {};
    productos.forEach(p => {
      const catId = p.categoria_id;
      if (!byCat[catId]) byCat[catId] = [];
      byCat[catId].push(p);
    });

    let hasAny = false;

    sortedMenus.forEach(menu => {
      // Categorías de este menú
      const menuCats = (cats || []).filter(c => c.menu_id === menu.id);
      if (menuCats.length === 0) return;

      const menuSection = document.createElement("div");
      menuSection.className = "menu-section";

      const header = document.createElement("div");
      header.className = "menu-header";
      const biz = menu.negocio_nombre || "";
      header.innerHTML = `<span class="menu-biz">${escapeHtml(biz)}</span><span class="menu-title">${escapeHtml(menu.nombre)}</span>`;
      menuSection.appendChild(header);

      // Ordenar categorías por nombre
      menuCats.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

      menuCats.forEach(cat => {
        const items = (categoriasDe(byCat, cat.id));
        const catBlock = document.createElement("div");
        catBlock.className = "cat-block";
        catBlock.innerHTML = `<div class="cat-block-title">${escapeHtml(cat.nombre)} <span class="count">(${items.length})</span></div>`;

        if (items.length === 0) {
          catBlock.innerHTML += '<p class="cat-empty">Sin productos</p>';
        } else {
          items.forEach((p) => {
            hasAny = true;
            catBlock.appendChild(buildProductCard(p));
          });
        }

        menuSection.appendChild(catBlock);
      });

      productsList.appendChild(menuSection);
    });

    if (!hasAny && sortedMenus.length) {
      // Nothing meaningful rendered; keep simple message
    }
  }

  function categoriasDe(byCat, catId) {
    return byCat[catId] || [];
  }

  function buildProductCard(p) {
    const card = document.createElement("div");
    card.className = "product-card";
    const statusClass = p.disponible ? "on" : "off";
    const statusText = p.disponible ? "Disponible" : "Agotado";
    const imgSrc = p.imagen_url || "";
    const pId = p.id;

    // Options for the menu selector (only menus the user owns, that have this category's menu preselected)
    const menuOpts = allMenus.map(m =>
      '<option value="' + m.id + '" ' + (p._menuId === m.id ? 'selected' : '') + '>' + escapeHtml((m.negocio_nombre ? m.negocio_nombre + ' — ' : '') + m.nombre) + '</option>'
    ).join('');

    card.innerHTML = `
      ${imgSrc ? '<img class="ph-img" src="' + escapeHtml(imgSrc) + '" alt="">' : ''}
      <div class="cat-label">${escapeHtml(p._catName || 'Sin categoría')}</div>
      <div class="prod-name">${escapeHtml(p.nombre)}</div>
      ${p.precio != null ? '<div class="prod-price">$' + Number(p.precio).toFixed(2) + '</div>' : ''}
      ${p.descripcion ? '<p class="prod-desc">' + escapeHtml(p.descripcion) + '</p>' : ''}
      <div class="prod-status ${statusClass}">${statusText}</div>
      <div class="row-actions">
        <button class="btn-edit" onclick="toggleEdit('${pId}')" aria-label="Editar ${escapeHtml(p.nombre)}"><i class="fa-solid fa-pen"></i><span>Editar</span></button>
        <button class="btn-del" onclick="deleteProduct('${pId}')" aria-label="Eliminar ${escapeHtml(p.nombre)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button>
      </div>
      <div class="edit-form" id="form-${pId}">
        <label>Nombre</label>
        <input type="text" id="name-${pId}" value="${escapeHtml(p.nombre)}">
        <label>Descripcion</label>
        <textarea id="desc-${pId}">${escapeHtml(p.descripcion || '')}</textarea>
        <label>Precio ($)</label>
        <input type="number" id="price-${pId}" step="0.01" min="0" value="${p.precio != null ? p.precio : ''}" placeholder="Ej: 12.50 (opcional)">
        <label>Menú</label>
        <select id="menu-${pId}">${menuOpts}</select>
        <label>Categoría</label>
        <select id="cat-${pId}"></select>
        <div class="check-row">
          <input type="checkbox" id="disp-${pId}" ${p.disponible ? 'checked' : ''}>
          <label for="disp-${pId}" style="margin:0">Disponible</label>
        </div>
        <label>Imagen</label>
        <img class="img-preview" id="preview-${pId}" src="${escapeHtml(imgSrc)}" alt="Preview">
        <div class="file-row">
          <label class="btn-file" for="file-${pId}">Elegir imagen</label>
          <input type="file" id="file-${pId}" accept="image/jpeg,image/png,image/webp">
          <span class="file-name" id="filename-${pId}">${imgSrc ? 'Imagen actual' : 'Sin imagen'}</span>
        </div>
        <div class="upload-msg" id="uploadmsg-${pId}"></div>
        <div class="form-actions">
          <button class="btn-save" onclick="saveProduct('${pId}')">Guardar</button>
          <button class="btn-cancel" onclick="toggleEdit('${pId}')">Cancelar</button>
        </div>
        <div class="save-msg" id="msg-${pId}"></div>
      </div>
    `;

    // Populate categories for the selected menu (preselected to the product's current category)
    const menuSelect = card.querySelector(`#menu-${pId}`);
    const catSelect = card.querySelector(`#cat-${pId}`);
    populateCatsForMenu(pId, menuSelect.value, p.categoria_id, catSelect);
    menuSelect.onchange = () => populateCatsForMenu(pId, menuSelect.value, null, catSelect);

    // File input change handler
    const fileInput = card.querySelector(`#file-${pId}`);
    const preview = card.querySelector(`#preview-${pId}`);
    const fileName = card.querySelector(`#filename-${pId}`);
    const uploadMsg = card.querySelector(`#uploadmsg-${pId}`);

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

    return card;
  }

  function populateCatsForMenu(pid, menuId, selectedCatId, catSelectEl) {
    const catSelect = catSelectEl || document.getElementById(`cat-${pid}`);
    if (!catSelect) return;
    // Muestra TODAS las categorías (globales), sin filtrar por negocio/menú.
    const catsAll = allCats.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    catSelect.innerHTML = catsAll.map(c =>
      '<option value="' + c.id + '" ' + (selectedCatId === c.id ? 'selected' : '') + '>' + escapeHtml(c.nombre) + '</option>'
    ).join('');
    if (!catsAll.length) {
      catSelect.innerHTML = '<option value="">Sin categorías</option>';
    }
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
    const precioRaw = document.getElementById("price-" + id).value.trim();
    const disponible = document.getElementById("disp-" + id).checked;
    const categoriaId = document.getElementById("cat-" + id)?.value;
    const fileInput = document.getElementById("file-" + id);
    const msgEl = document.getElementById("msg-" + id);
    const uploadMsg = document.getElementById("uploadmsg-" + id);

    if (!nombre) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "El nombre no puede estar vacío.";
      return;
    }

    if (!categoriaId) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Seleccioná una categoría.";
      return;
    }

    // Parse price: empty -> null, otherwise validate as a valid number
    let precio = null;
    if (precioRaw !== "") {
      const num = Number(precioRaw);
      if (isNaN(num) || num < 0) {
        msgEl.className = "save-msg err";
        msgEl.textContent = "Precio inválido.";
        return;
      }
      precio = num;
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
    const payload = { nombre, descripcion: descripcion || null, precio, disponible, categoria_id: categoriaId };
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
      .select("nombre, descripcion, precio, disponible, imagen_url, categoria_id")
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
      Number(verify.precio) === Number(precio) &&
      verify.disponible === disponible &&
      verify.categoria_id === categoriaId &&
      (imagen_url === undefined || verify.imagen_url === imagen_url);

    if (!changed) {
      msgEl.className = "save-msg err";
      msgEl.textContent = "Sin permisos para editar este producto.";
      return;
    }

    msgEl.className = "save-msg ok";
    msgEl.textContent = "Guardado ✓";

    // Reload the list to regroup products (category/menu may have changed)
    setTimeout(() => showProducts(), 600);
  };

  // ── Delete product ─────────────────────────────────────────
  window.deleteProduct = async function (id) {
    const nombre = document.querySelector(`#form-${id}`)?.getAttribute("data-nombre");
    const confirmMsg = confirm("¿Eliminar este producto?\n\nEsta acción no se puede deshacer.");
    if (!confirmMsg) return;

    const { data: prod } = await window.sb
      .from("productos").select("imagen_url").eq("id", id).single();

    const { error } = await window.sb.from("productos").delete().eq("id", id);
    if (error) {
      alert("Error al eliminar: " + error.message);
      return;
    }

    // Delete the product's image from storage if it exists
    if (prod?.imagen_url) {
      try {
        const url = new URL(prod.imagen_url);
        const path = decodeURIComponent(url.pathname.split("/object/public/menu-imagenes/")[1] || "");
        if (path) {
          await window.sb.storage.from("menu-imagenes").remove([path]);
        }
      } catch (e) {
        // ignore storage cleanup errors
      }
    }

    // Reload the grouped list
    setTimeout(() => showProducts(), 400);
  };

  // ── Add product form ──────────────────────────────────────
  const addForm = document.getElementById("addProductForm");
  const addNegocio = document.getElementById("addNegocio");
  const addMenu = document.getElementById("addMenu");
  const addCategoria = document.getElementById("addCategoria");
  const addNombre = document.getElementById("addNombre");
  const addDesc = document.getElementById("addDesc");
  const addPrecio = document.getElementById("addPrecio");
  const addDisponible = document.getElementById("addDisponible");
  const addFile = document.getElementById("addFile");
  const addPreview = document.getElementById("addPreview");
  const addFileName = document.getElementById("addFileName");
  const addUploadMsg = document.getElementById("addUploadMsg");
  const addSaveMsg = document.getElementById("addSaveMsg");
  const btnNewCat = document.getElementById("btnNewCat");
  const newCatWrap = document.getElementById("newCatWrap");
  const addNewCatName = document.getElementById("addNewCatName");
  const addNewCatTipo = document.getElementById("addNewCatTipo");

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
    // Mostrar TODAS las categorías (globales), sin depender del menú seleccionado.
    const { data: cats } = await window.sb.from("categorias").select("id, nombre").order("nombre");
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
    addPrecio.value = "";
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
    addNewCatName.value = "";
    addNewCatTipo.value = "";
  }

  document.getElementById("btnSaveNew").onclick = async () => {
    const nombre = addNombre.value.trim();
    if (!nombre) {
      addSaveMsg.className = "save-msg err";
      addSaveMsg.textContent = "El nombre es obligatorio.";
      return;
    }

    let precio = null;
    const precioRaw = addPrecio.value.trim();
    if (precioRaw !== "") {
      const num = Number(precioRaw);
      if (isNaN(num) || num < 0) {
        addSaveMsg.className = "save-msg err";
        addSaveMsg.textContent = "Precio inválido.";
        return;
      }
      precio = num;
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
        .from("categorias").insert({ menu_id: menuId, nombre: catName, orden: 0, tipo: addNewCatTipo.value || null }).select().single();
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
        precio: precio,
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

  // ── Menus maintenance panel ────────────────────────────────
  const menusPanel = document.getElementById("menusPanel");
  const menusList = document.getElementById("menusList");
  const btnMenus = document.getElementById("btnMenus");

  btnMenus.onclick = () => {
    const open = menusPanel.classList.toggle("open");
    if (open) loadMenusPanel();
  };

  async function loadMenusPanel() {
    menusList.innerHTML = '<p class="empty" style="padding:16px 0;">Cargando…</p>';

    // Solo los menús de los negocios asignados al usuario actual
    const { data: asig } = await window.sb
      .from("negocio_editores")
      .select("negocio_id")
      .eq("usuario_id", currentUser.id);
    const negocioIds = asig?.map(a => a.negocio_id) || [];

    if (negocioIds.length === 0) {
      menusList.innerHTML = '<p class="empty" style="padding:16px 0;">No tenés negocios asignados.</p>';
      return;
    }

    const { data: menus, error } = await window.sb
      .from("menus")
      .select("id, nombre, activo, negocio_id, negocios(nombre)")
      .in("negocio_id", negocioIds)
      .order("negocio_id");

    if (error) { menusList.innerHTML = '<p class="empty" style="padding:16px 0;">Error: ' + escapeHtml(error.message) + '</p>'; return; }
    if (!menus || menus.length === 0) { menusList.innerHTML = '<p class="empty" style="padding:16px 0;">No hay menús.</p>'; return; }

    menusList.innerHTML = "";
    menus.forEach(m => {
      const row = document.createElement("div");
      row.className = "menu-row";
      const bizName = m.negocios?.nombre || "Sin negocio";
      const active = m.activo !== false;
      row.innerHTML = `
        <div class="menu-info">
          <div class="menu-biz">${escapeHtml(bizName)}</div>
          <div class="menu-name">${escapeHtml(m.nombre)}</div>
          <div class="menu-state ${active ? 'on' : 'off'}">${active ? 'Visible' : 'Mantenimiento'}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${active ? 'checked' : ''} data-mid="${m.id}">
          <span class="slider"></span>
        </label>
      `;
      const input = row.querySelector('input[data-mid]');
      input.onchange = async () => {
        const nuevo = input.checked;
        const { error: updErr } = await window.sb
          .from("menus")
          .update({ activo: nuevo })
          .eq("id", m.id);
        if (updErr) {
          input.checked = !nuevo;
          alert("Error: " + updErr.message);
          return;
        }
        stateEl(input, nuevo);
      };
      menusList.appendChild(row);
    });
  }

  function stateEl(input, active) {
    const state = input.closest(".menu-row").querySelector(".menu-state");
    state.className = "menu-state " + (active ? "on" : "off");
    state.textContent = active ? "Visible" : "Mantenimiento";
  }

  // ── Ofertas ────────────────────────────────────────────────
  // Negocio_id NULL = oferta general (DJ/actividades semanales) que sale al entrar.
  // Negocio_id asignado = oferta que sale dentro del menú de ese negocio.
  const ofertasView = document.getElementById("ofertasView");
  const ofertasList = document.getElementById("ofertasList");
  const addOfertaForm = document.getElementById("addOfertaForm");
  const addOfertaTitle = document.getElementById("addOfertaTitle");
  const btnNuevaOferta = document.getElementById("btnNuevaOferta");
  const btnSaveOferta = document.getElementById("btnSaveOferta");
  const btnCancelOferta = document.getElementById("btnCancelOferta");
  const ofTitulo = document.getElementById("ofTitulo");
  const ofNegocio = document.getElementById("ofNegocio");
  const ofActiva = document.getElementById("ofActiva");
  const ofOrden = document.getElementById("ofOrden");
  const ofFile = document.getElementById("ofFile");
  const ofPreview = document.getElementById("ofPreview");
  const ofFileName = document.getElementById("ofFileName");
  const ofUploadMsg = document.getElementById("ofUploadMsg");
  const ofSaveMsg = document.getElementById("ofSaveMsg");
  const navTabs = document.getElementById("navTabs");
  const tabProductos = document.getElementById("tabProductos");
  const tabOfertas = document.getElementById("tabOfertas");

  let editingOfertaId = null;
  let uploadOfertaUrl = "";

  function setNav(active) {
    navTabs.style.display = "flex";
    const isProducts = active === "productos";
    const isOffers = active === "ofertas";
    tabProductos.classList.toggle("active", isProducts);
    tabOfertas.classList.toggle("active", isOffers);
    tabProductos.setAttribute("aria-current", isProducts ? "page" : "false");
    tabOfertas.setAttribute("aria-current", isOffers ? "page" : "false");
  }

  async function showOfertas() {
    loginView.style.display = "none";
    productsView.style.display = "none";
    ofertasView.style.display = "block";
    setNav("ofertas");
    ofertasList.innerHTML = '<p style="text-align:center;color:var(--muted);">Cargando…</p>';

    // Negocios asignados al usuario
    const { data: asig } = await window.sb
      .from("negocio_editores")
      .select("negocio_id, negocios(id, nombre)")
      .eq("usuario_id", currentUser.id);
    userNegocios = asig?.map(a => a.negocios).filter(Boolean) || [];

    // Ofertas generales + las de mis negocios
    const negocioIds = userNegocios.map(n => n.id);
    const generalRes = await window.sb
      .from("ofertas")
      .select("id, titulo, imagen_url, activa, orden, negocio_id")
      .is("negocio_id", null)
      .order("orden");
    let ofertas = generalRes.data || [];

    if (negocioIds.length > 0) {
      const bizRes = await window.sb
        .from("ofertas")
        .select("id, titulo, imagen_url, activa, orden, negocio_id")
        .in("negocio_id", negocioIds)
        .order("orden");
      ofertas = ofertas.concat(bizRes.data || []);
    }

    renderOfertas(ofertas);
  }

  function renderOfertas(ofertas) {
    ofertasList.innerHTML = "";
    if (!ofertas.length) {
      ofertasList.innerHTML = '<p class="empty" style="padding:20px;">No hay ofertas. Creá una nueva con el botón "+ Nueva oferta".</p>';
      return;
    }
    const bizMap = {};
    userNegocios.forEach(n => { bizMap[n.id] = n.nombre; });
    ofertas.forEach(o => {
      const card = document.createElement("div");
      card.className = "oferta-card";
      const isGeneral = !o.negocio_id;
      const pill = isGeneral
        ? '<span class="pill general">General</span>'
        : '<span class="pill negocio">' + escapeHtml(bizMap[o.negocio_id] || "Negocio") + '</span>';
      const activePill = o.activa !== false ? "" : '<span class="pill off">Inactiva</span>';
      card.innerHTML = `
        <img class="thumb" src="${escapeHtml(o.imagen_url || "")}" alt="">
        <div class="oferta-info">
          <div class="ot">${escapeHtml(o.titulo || "Oferta")}</div>
          <div class="od">Orden: ${o.orden ?? 0}</div>
          ${pill} ${activePill}
        </div>
        <div class="oferta-actions">
          <button class="btn-sm" data-toggle="${o.id}"><i class="fa-solid ${o.activa !== false ? "fa-eye-slash" : "fa-eye"}"></i> ${o.activa !== false ? "Desactivar" : "Activar"}</button>
          <button class="btn-sm" data-edit="${o.id}"><i class="fa-solid fa-pen"></i> Editar</button>
          <button class="btn-sm danger" data-del="${o.id}"><i class="fa-solid fa-trash"></i> Eliminar</button>
        </div>`;
      card.querySelector('[data-toggle]').onclick = async () => {
        const nuevo = o.activa !== true;
        const { error } = await window.sb.from("ofertas").update({ activa: nuevo }).eq("id", o.id);
        if (error) { alert("Error: " + error.message); return; }
        showOfertas();
      };
      card.querySelector('[data-edit]').onclick = () => openOfertaForm(o);
      card.querySelector('[data-del]').onclick = () => deleteOferta(o.id);
      ofertasList.appendChild(card);
    });
  }

  function openOfertaForm(o) {
    editingOfertaId = o ? o.id : null;
    uploadOfertaUrl = o ? (o.imagen_url || "") : "";
    addOfertaTitle.textContent = o ? "Editar oferta" : "Nueva oferta";
    ofTitulo.value = o ? (o.titulo || "") : "";
    ofNegocio.innerHTML = '<option value="">General (DJ / actividades de la semana)</option>' +
      userNegocios.map(n =>
        '<option value="' + n.id + '"' + (o && o.negocio_id === n.id ? " selected" : "") + '>' + escapeHtml(n.nombre) + '</option>'
      ).join('');
    ofActiva.checked = o ? o.activa !== false : true;
    ofOrden.value = o ? (o.orden ?? 0) : 0;
    ofPreview.src = uploadOfertaUrl || "";
    ofPreview.classList.toggle("visible", !!uploadOfertaUrl);
    ofFileName.textContent = uploadOfertaUrl ? "Imagen actual" : "Sin imagen";
    ofUploadMsg.textContent = "";
    ofSaveMsg.textContent = "";
    ofSaveMsg.className = "save-msg";
    ofFile.value = "";
    addOfertaForm.style.display = "block";
    addOfertaForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  btnNuevaOferta.onclick = () => openOfertaForm(null);
  btnCancelOferta.onclick = () => { addOfertaForm.style.display = "none"; };

  ofFile.onchange = () => {
    const f = ofFile.files[0];
    if (!f) return;
    ofPreview.src = URL.createObjectURL(f);
    ofPreview.classList.add("visible");
    ofFileName.textContent = f.name;
    ofUploadMsg.textContent = "";
  };

  btnSaveOferta.onclick = async () => {
    ofSaveMsg.textContent = "";
    ofSaveMsg.className = "save-msg";
    const negocioId = ofNegocio.value || null;
    const titulo = ofTitulo.value.trim();
    const activa = ofActiva.checked;
    const orden = parseInt(ofOrden.value, 10) || 0;
    let imagen_url = uploadOfertaUrl;

    const file = ofFile.files[0];
    if (file) {
      try {
        ofUploadMsg.textContent = "Subiendo imagen…";
        const ext = file.name.split(".").pop().toLowerCase();
        const path = "ofertas/" + (editingOfertaId || Date.now()) + "." + ext;
        const { error } = await window.sb.storage
          .from("menu-imagenes")
          .upload(path, file, { contentType: file.type, upsert: true });
        if (error) throw error;
        imagen_url = window.sb.storage.from("menu-imagenes").getPublicUrl(path).data.publicUrl;
        ofUploadMsg.textContent = "";
      } catch (e) {
        ofUploadMsg.textContent = "Error subiendo imagen: " + e.message;
        return;
      }
    }

    const payload = { titulo: titulo || null, negocio_id: negocioId, activa: activa, orden: orden, imagen_url: imagen_url };
    let res;
    if (editingOfertaId) {
      res = await window.sb.from("ofertas").update(payload).eq("id", editingOfertaId);
    } else {
      res = await window.sb.from("ofertas").insert(payload);
    }
    if (res.error) {
      ofSaveMsg.className = "save-msg err";
      ofSaveMsg.textContent = "Error: " + res.error.message;
      return;
    }
    ofSaveMsg.className = "save-msg ok";
    ofSaveMsg.textContent = editingOfertaId ? "Oferta actualizada." : "Oferta creada.";
    setTimeout(() => { addOfertaForm.style.display = "none"; showOfertas(); }, 900);
  };

  async function deleteOferta(id) {
    if (!confirm("¿Eliminar esta oferta?")) return;
    const { error } = await window.sb.from("ofertas").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    showOfertas();
  }

  // ── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Mobile navigation drawer ─────────────────────────────
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("adminSidebar");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  const sidebarClose = document.getElementById("sidebarClose");

  function setMobileSidebar(open) {
    if (!sidebar || !sidebarBackdrop) return;
    sidebar.classList.toggle("open", open);
    sidebarBackdrop.classList.toggle("open", open);
    mobileMenuBtn?.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  }

  mobileMenuBtn?.addEventListener("click", () => {
    setMobileSidebar(!sidebar.classList.contains("open"));
  });
  sidebarClose?.addEventListener("click", () => setMobileSidebar(false));
  sidebarBackdrop?.addEventListener("click", () => setMobileSidebar(false));
  document.querySelectorAll(".admin-sidebar a, .admin-sidebar button").forEach((el) => {
    if (el !== mobileMenuBtn && el !== sidebarClose) {
      el.addEventListener("click", () => setMobileSidebar(false));
    }
  });

  init();
})();
