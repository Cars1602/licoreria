(async () => {
  await bootAdminPage({
    key: 'dashboard',
    pageTitle: 'Dashboard',
    pageHeading: 'PANTALLA DE INICIO',
    pageDescription: 'Resumen general del inventario y la operacion',
    content: `
      <div class="metric-grid" id="stats"></div>
      <div class="content-grid" style="margin-top:18px;">
        <section class="surface-card">
          <h3>Alertas de stock bajo</h3>
          <div id="lowStockList" class="stack-list"></div>
        </section>
        <section class="surface-card">
          <h3>Productos por vencer</h3>
          <div id="expiringList" class="stack-list"></div>
        </section>
      </div>
      <section class="surface-card" style="margin-top:18px;">
        <h3>Productos mas vendidos</h3>
        <div id="topProductsChart" class="chart-list"></div>
      </section>
    `,
  });

  const [dashboard, productsData] = await Promise.all([
    api('/api/admin/dashboard'),
    api('/api/admin/products'),
  ]);

  const stats = [
    ['Productos (total)', dashboard.cards.products],
    ['Stock bajo', dashboard.cards.lowStock],
    ['Por vencer', dashboard.cards.expiring],
    ['Ventas hoy', Number(dashboard.cards.salesToday || 0).toFixed(2)],
  ];
  document.getElementById('stats').innerHTML = stats.map(([label, value]) => `
    <div class="metric-card">
      <small>${label}</small>
      <strong>${value}</strong>
    </div>
  `).join('');

  const products = productsData.items || [];
  const lowStock = products.filter((item) => Number(item.stock) <= Number(item.stock_min));
  const expiring = products
    .filter((item) => item.expires_at)
    .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at))
    .slice(0, 8);

  document.getElementById('lowStockList').innerHTML = lowStock.length
    ? lowStock.map((item) => `
        <div class="list-card">
          <strong>${item.name}</strong>
          <span>Codigo: ${item.barcode} | Stock: ${item.stock} | Min: ${item.stock_min}</span>
        </div>
      `).join('')
    : '<p class="muted">Sin alertas.</p>';

  document.getElementById('expiringList').innerHTML = expiring.length
    ? expiring.map((item) => `
        <div class="list-card">
          <strong>${item.name}</strong>
          <span>Codigo: ${item.barcode} | Vence: ${String(item.expires_at).slice(0, 10)}</span>
        </div>
      `).join('')
    : '<p class="muted">No hay productos por vencer.</p>';

  const topProducts = dashboard.topProducts || [];
  const maxQty = Math.max(...topProducts.map((item) => Number(item.qty_sold || 0)), 1);
  document.getElementById('topProductsChart').innerHTML = topProducts.length
    ? topProducts.map((item) => `
        <div class="chart-row">
          <div class="chart-label">
            <strong>${item.name_snap}</strong>
            <span>${item.barcode_snap || '-'}</span>
          </div>
          <div class="chart-bar-wrap">
            <div class="chart-bar" style="width:${(Number(item.qty_sold || 0) / maxQty) * 100}%"></div>
          </div>
          <div class="chart-value">${item.qty_sold}</div>
        </div>
      `).join('')
    : '<p class="muted">Aun no hay ventas para mostrar.</p>';
})().catch((error) => setNotice('adminNotice', error.message, 'error'));
