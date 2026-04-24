(async () => {
  await bootAdminPage({
    key: 'sales',
    pageTitle: 'Ventas',
    pageHeading: 'VENTAS',
    pageDescription: 'Consulta de ventas y tickets emitidos',
    content: `
      <section class="surface-card">
        <h3>Ultimas ventas</h3>
        <div class="table-wrap">
          <table class="table" id="salesTable">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Fecha</th>
                <th>Vendedor</th>
                <th>Metodo</th>
                <th>Items</th>
                <th>Total</th>
                <th>Ticket</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </section>
    `,
  });

  const data = await api('/api/admin/sales');
  document.querySelector('#salesTable tbody').innerHTML = (data.items || []).map((sale) => `
    <tr>
      <td>${sale.invoice_no}</td>
      <td>${new Date(sale.created_at).toLocaleString()}</td>
      <td>${sale.display_name}</td>
      <td>${sale.payment_method}</td>
      <td>${sale.items_count}</td>
      <td>Bs ${money(sale.total)}</td>
      <td><a class="button compact" href="./ticket?sale_id=${sale.id}">Abrir</a></td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="muted">Sin ventas registradas.</td></tr>';
})().catch((error) => setNotice('adminNotice', error.message, 'error'));
