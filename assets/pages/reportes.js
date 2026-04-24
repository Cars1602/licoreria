const reportState = {
  month: '',
  data: null,
};

(async () => {
  await bootAdminPage({
    key: 'reports',
    pageTitle: 'Reportes',
    pageHeading: 'REPORTES',
    pageDescription: 'Resumen comercial y productos mas vendidos',
    content: `
      <section class="surface-card" style="margin-bottom:18px;">
        <div class="inline-actions">
          <label class="checkline">Mes
            <input class="input compact-input" type="month" id="reportMonth">
          </label>
          <button class="button secondary compact" type="button" id="applyMonthFilter">Aplicar filtro</button>
          <button class="button secondary compact" type="button" id="exportExcelButton">Exportar Excel</button>
          <button class="button secondary compact" type="button" id="exportPdfButton">Exportar PDF</button>
        </div>
      </section>
      <div class="metric-grid compact" id="reportSummary"></div>
      <div class="content-grid" style="margin-top:18px;">
        <section class="surface-card">
          <h3>Metodos de pago</h3>
          <div id="paymentMethods" class="stack-list"></div>
        </section>
        <section class="surface-card">
          <h3>Top productos</h3>
          <div id="topProducts" class="stack-list"></div>
        </section>
      </div>
    `,
  });

  async function loadReports(month = '') {
    const query = month ? `?month=${encodeURIComponent(month)}` : '';
    const data = await api(`/api/admin/reports${query}`);
    reportState.month = month;
    reportState.data = data;
    const summary = data.summary || {};
    document.getElementById('reportSummary').innerHTML = `
      <div class="metric-card"><small>Ventas totales</small><strong>${summary.total_sales || 0}</strong></div>
      <div class="metric-card"><small>Monto total</small><strong>Bs ${money(summary.total_amount)}</strong></div>
      <div class="metric-card"><small>Ticket promedio</small><strong>Bs ${money(summary.average_ticket)}</strong></div>
      <div class="metric-card"><small>Ganancia</small><strong>Bs ${money(summary.gross_profit)}</strong></div>
    `;

    document.getElementById('paymentMethods').innerHTML = (data.paymentMethods || []).map((item) => `
      <div class="list-card">
        <strong>${item.payment_method}</strong>
        <span>Ventas: ${item.total} | Monto: Bs ${money(item.amount)}</span>
      </div>
    `).join('') || '<p class="muted">Sin datos.</p>';

    document.getElementById('topProducts').innerHTML = (data.topProducts || []).map((item) => `
      <div class="list-card">
        <strong>${item.name_snap}</strong>
        <span>Codigo: ${item.barcode_snap} | Vendido: ${item.qty_sold} | Monto: Bs ${money(item.amount)} | Ganancia: Bs ${money(item.profit)}</span>
      </div>
    `).join('') || '<p class="muted">Sin datos.</p>';
  }

  function buildReportTableRows(items, columns) {
    return items.map((item) => `
      <tr>${columns.map((column) => `<td>${column.render(item)}</td>`).join('')}</tr>
    `).join('');
  }

  function exportExcel() {
    if (!reportState.data) return;
    const summary = reportState.data.summary || {};
    const paymentMethods = reportState.data.paymentMethods || [];
    const topProducts = reportState.data.topProducts || [];
    const html = `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <h2>Reporte ${reportState.month || 'general'}</h2>
          <table border="1">
            <tr><th>Ventas totales</th><th>Monto total</th><th>Ticket promedio</th><th>Ganancia</th></tr>
            <tr>
              <td>${summary.total_sales || 0}</td>
              <td>${money(summary.total_amount)}</td>
              <td>${money(summary.average_ticket)}</td>
              <td>${money(summary.gross_profit)}</td>
            </tr>
          </table>
          <h3>Metodos de pago</h3>
          <table border="1">
            <tr><th>Metodo</th><th>Ventas</th><th>Monto</th></tr>
            ${buildReportTableRows(paymentMethods, [
              { render: (item) => item.payment_method },
              { render: (item) => item.total },
              { render: (item) => money(item.amount) },
            ])}
          </table>
          <h3>Top productos</h3>
          <table border="1">
            <tr><th>Producto</th><th>Codigo</th><th>Vendido</th><th>Monto</th><th>Ganancia</th></tr>
            ${buildReportTableRows(topProducts, [
              { render: (item) => item.name_snap },
              { render: (item) => item.barcode_snap },
              { render: (item) => item.qty_sold },
              { render: (item) => money(item.amount) },
              { render: (item) => money(item.profit) },
            ])}
          </table>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-${reportState.month || 'general'}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!reportState.data) return;
    const summary = reportState.data.summary || {};
    const paymentMethods = reportState.data.paymentMethods || [];
    const topProducts = reportState.data.topProducts || [];
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte ${reportState.month || 'general'}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #bbb; padding: 8px; text-align: left; }
            h2, h3 { margin-bottom: 8px; }
          </style>
        </head>
        <body>
          <h2>Reporte ${reportState.month || 'general'}</h2>
          <table>
            <tr><th>Ventas totales</th><th>Monto total</th><th>Ticket promedio</th><th>Ganancia</th></tr>
            <tr>
              <td>${summary.total_sales || 0}</td>
              <td>${money(summary.total_amount)}</td>
              <td>${money(summary.average_ticket)}</td>
              <td>${money(summary.gross_profit)}</td>
            </tr>
          </table>
          <h3>Metodos de pago</h3>
          <table>
            <tr><th>Metodo</th><th>Ventas</th><th>Monto</th></tr>
            ${buildReportTableRows(paymentMethods, [
              { render: (item) => item.payment_method },
              { render: (item) => item.total },
              { render: (item) => money(item.amount) },
            ])}
          </table>
          <h3>Top productos</h3>
          <table>
            <tr><th>Producto</th><th>Codigo</th><th>Vendido</th><th>Monto</th><th>Ganancia</th></tr>
            ${buildReportTableRows(topProducts, [
              { render: (item) => item.name_snap },
              { render: (item) => item.barcode_snap },
              { render: (item) => item.qty_sold },
              { render: (item) => money(item.amount) },
              { render: (item) => money(item.profit) },
            ])}
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  const monthInput = document.getElementById('reportMonth');
  monthInput.value = new Date().toISOString().slice(0, 7);
  await loadReports(monthInput.value);

  document.getElementById('applyMonthFilter').addEventListener('click', async () => {
    try {
      await loadReports(monthInput.value);
    } catch (error) {
      setNotice('adminNotice', error.message, 'error');
    }
  });
  document.getElementById('exportExcelButton').addEventListener('click', exportExcel);
  document.getElementById('exportPdfButton').addEventListener('click', exportPdf);
})().catch((error) => setNotice('adminNotice', error.message, 'error'));
