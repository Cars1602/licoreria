const ticketParams = new URLSearchParams(window.location.search);
const saleId = ticketParams.get('sale_id');

async function loadTicketPage() {
  const config = await api('/api/config');
  window.APP_BASE_URL = config.appBaseUrl || '';
  const me = await api('/api/auth/me');
  document.getElementById('backLink').href = me.user?.role === 'admin' ? `${window.APP_BASE_URL}/admin` : `${window.APP_BASE_URL}/employee`;
  const data = await api(`/api/tickets/${saleId}`);
  document.title = `Ticket ${data.sale.invoice_no}`;
  document.getElementById('ticketWrap').innerHTML = `
    <h1 style="margin-top:0;">${data.settings.business_name}</h1>
    <p class="muted">Factura ${data.sale.invoice_no}</p>
    <p><strong>Atendido por:</strong> ${data.sale.display_name}</p>
    <p><strong>Metodo:</strong> ${data.sale.payment_method}</p>
    <hr>
    ${data.items.map((item) => `<p>${item.name_snap} | ${item.qty} x Bs ${money(item.price_snap)} = Bs ${money(item.subtotal)}</p>`).join('')}
    <hr>
    <p><strong>Subtotal:</strong> Bs ${money(data.sale.subtotal)}</p>
    <p><strong>Descuento:</strong> Bs ${money(data.sale.discount)}</p>
    <p><strong>Total:</strong> Bs ${money(data.sale.total)}</p>
    ${data.sale.payment_method === 'CASH' ? `<p><strong>Pago con:</strong> Bs ${money(data.sale.cash_received)}</p><p><strong>Cambio:</strong> Bs ${money(data.sale.change_due)}</p>` : ''}
    <p class="muted">${data.settings.store_message}</p>
  `;
  if (ticketParams.get('print') === '1') {
    window.print();
  }
}

loadTicketPage();
