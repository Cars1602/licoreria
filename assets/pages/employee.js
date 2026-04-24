let activePosId = null;
let productSearchTimer = null;

function employeeProductCard(product) {
  const imageUrl = resolveApiAssetUrl(product.image_url || '');
  return `
    <article class="product-card">
      <div class="product-card-media">
        ${imageUrl
          ? `<img src="${imageUrl}" alt="${product.name}" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'product-card-fallback', textContent: 'Sin imagen' }))">`
          : `<div class="product-card-fallback">Sin imagen</div>`
        }
      </div>
      <div class="product-card-body">
        <div class="section-header">
          <div>
            <h3>${product.name}</h3>
            <p class="muted">Codigo: ${product.barcode}</p>
          </div>
          <span class="product-status ${Number(product.stock) > 0 ? 'active' : 'inactive'}">
            ${Number(product.stock) > 0 ? 'Disponible' : 'Agotado'}
          </span>
        </div>
        <div class="product-meta">
          <span class="chip">Categoria: ${product.category_name || 'Sin categoria'}</span>
          <span class="chip">Marca: ${product.brand_name || 'Sin marca'}</span>
          <span class="chip">Proveedor: ${product.supplier_name || 'Sin proveedor'}</span>
        </div>
        <div class="metric-grid compact" style="margin-top:14px;">
          <div class="metric-card"><small>Stock</small><strong>${product.stock}</strong></div>
          <div class="metric-card"><small>Precio</small><strong>Bs ${money(product.price)}</strong></div>
        </div>
      </div>
    </article>
  `;
}

async function searchEmployeeProducts(query) {
  const target = document.getElementById('employeeProductResults');
  if (!query.trim()) {
    target.innerHTML = '<p class="muted">Escribe un nombre o codigo para buscar productos.</p>';
    return;
  }

  const data = await api(`/api/employee/products/search?q=${encodeURIComponent(query)}`);
  target.innerHTML = data.items.length
    ? data.items.map(employeeProductCard).join('')
    : '<p class="muted">No se encontraron productos con esa busqueda.</p>';
}

function goToPos() {
  if (!activePosId) return;
  window.location.href = `${window.APP_BASE_URL}/pos?pos_id=${activePosId}`;
}

async function ensurePosAndGo() {
  try {
    if (!activePosId) {
      const data = await api('/api/pos/session', { method: 'POST' });
      activePosId = data.session.id;
    }
    goToPos();
  } catch (error) {
    setNotice('employeeNotice', error.message, 'error');
  }
}

async function loadEmployeePage() {
  const config = await api('/api/config');
  window.APP_BASE_URL = config.appBaseUrl || '';
  const me = await api('/api/auth/me');
  if (!me.user || me.user.role !== 'empleado') {
    window.location.href = (window.APP_BASE_URL || '') + '/';
    return;
  }

  const data = await api('/api/employee/dashboard');
  activePosId = data.activePos ? data.activePos.id : null;

  document.title = 'Empleado | ' + (config.settings.business_name || 'Licoreria');
  document.getElementById('employeeSubtitle').textContent = `Bienvenido, ${data.user.display_name}`;
  document.getElementById('employeeSessionText').textContent = activePosId
    ? 'Ya tienes una sesion abierta. Entra al POS para mostrar el QR de vinculacion y el carrito.'
    : 'No tienes una sesion abierta. Pulsa el boton para abrir el POS.';

  document.getElementById('employeeData').innerHTML = `
    <div class="employee-data-card"><strong>Nombre:</strong><span>${data.user.display_name}</span></div>
    <div class="employee-data-card"><strong>Correo:</strong><span>${data.user.email}</span></div>
    <div class="employee-data-card"><strong>Rol:</strong><span>${data.user.role}</span></div>
    <div class="employee-data-card"><strong>Estado POS:</strong><span>${activePosId ? 'Activo' : 'Sin abrir'}</span></div>
  `;

  document.getElementById('employeeStats').innerHTML = `
    <div class="metric-card"><small>Ventas hoy</small><strong>${data.salesToday}</strong></div>
    <div class="metric-card"><small>Total vendido</small><strong>Bs ${money(data.amountToday)}</strong></div>
    <div class="metric-card"><small>POS activo</small><strong>${activePosId ? 'SI' : 'NO'}</strong></div>
    <div class="metric-card"><small>Pago por defecto</small><strong>${data.settings.default_payment_method}</strong></div>
  `;

  document.querySelector('#recentSalesTable tbody').innerHTML = data.recentSales.length
    ? data.recentSales.map((sale) => `
        <tr>
          <td><a href="${window.APP_BASE_URL}/ticket?sale_id=${sale.id}">${sale.invoice_no}</a></td>
          <td>${sale.payment_method}</td>
          <td>Bs ${money(sale.total)}</td>
          <td>${new Date(sale.created_at).toLocaleString()}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="muted">Todavia no hay ventas registradas.</td></tr>';

  document.getElementById('openPosButton').textContent = activePosId ? 'Ir al POS' : 'Abrir POS';
  document.getElementById('openPosInlineButton').textContent = activePosId ? 'Abrir POS' : 'Crear POS';
  document.getElementById('employeeProductResults').innerHTML = '<p class="muted">Escribe un nombre o codigo para buscar productos.</p>';
  document.getElementById('employeeShell').classList.remove('hidden');
}

document.getElementById('openPosButton').addEventListener('click', ensurePosAndGo);
document.getElementById('openPosInlineButton').addEventListener('click', ensurePosAndGo);
document.getElementById('employeeProductSearch').addEventListener('input', (event) => {
  const query = event.currentTarget.value || '';
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => {
    searchEmployeeProducts(query).catch((error) => setNotice('employeeNotice', error.message, 'error'));
  }, 220);
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = (window.APP_BASE_URL || '') + '/';
});

loadEmployeePage().catch((error) => setNotice('employeeNotice', error.message, 'error'));
