const adminPageMap = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin' },
  { key: 'products', label: 'Productos', href: '/productos' },
  { key: 'catalogs', label: 'Marcas / Categorias', href: '/marcas-categorias' },
  { key: 'movements', label: 'Movimientos', href: '/movimientos' },
  { key: 'suppliers', label: 'Proveedores', href: '/proveedores' },
  { key: 'sales', label: 'Ventas', href: '/ventas' },
  { key: 'users', label: 'Usuarios', href: '/usuarios' },
  { key: 'reports', label: 'Reportes', href: '/reportes' },
  { key: 'settings', label: 'Configuracion', href: '/configuracion' },
];

async function bootAdminPage({ key, pageTitle, pageHeading, pageDescription, content }) {
  const root = document.getElementById('adminRoot');
  if (!root) throw new Error('No se encontro el contenedor adminRoot');

  root.innerHTML = `
    <div class="admin-app">
      <aside class="admin-sidebar">
        <div class="brand-block">
          <h1 id="brandTitle">Inventario</h1>
          <p>Panel Administrador</p>
        </div>
        <nav class="sidebar-nav">
          ${adminPageMap.map((item) => `
            <a class="sidebar-link ${item.key === key ? 'active' : ''}" href="${item.href}">${item.label}</a>
          `).join('')}
        </nav>
        <div class="sidebar-bottom">
          <a class="sidebar-link" href="/employee">Panel empleado</a>
          <button class="sidebar-link sidebar-button danger" id="logoutButton" type="button">Salir</button>
        </div>
      </aside>

      <main class="admin-main">
        <header class="topbar">
          <div>
            <div class="topbar-title">${pageTitle}</div>
            <div class="muted">${pageDescription || ''}</div>
          </div>
          <div class="topbar-user" id="adminUserEmail">Cargando...</div>
        </header>

        <div class="page-shell">
          <div class="hero-row">
            <div>
              <p class="eyebrow">Modulo</p>
              <h2 class="hero-title">${pageHeading}</h2>
            </div>
          </div>

          <div id="adminNotice" class="hidden"></div>
          <div id="pageContent">${content}</div>
        </div>
      </main>
    </div>
  `;

  const config = await api('/api/config');
  window.APP_BASE_URL = config.appBaseUrl || '';
  const me = await api('/api/auth/me');
  if (!me.user || me.user.role !== 'admin') {
    window.location.href = (window.APP_BASE_URL || '') + '/';
    throw new Error('Sesion admin requerida');
  }

  document.title = `${pageTitle} | ${config.settings.business_name || 'Licoreria'}`;
  document.getElementById('brandTitle').textContent = config.settings.business_name || 'Inventario';
  document.getElementById('adminUserEmail').textContent = me.user.email;
  document.getElementById('logoutButton').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = (window.APP_BASE_URL || '') + '/';
  });

  return { config, me };
}

window.bootAdminPage = bootAdminPage;
