(async () => {
  await bootAdminPage({
    key: 'movements',
    pageTitle: 'Movimientos',
    pageHeading: 'MOVIMIENTOS',
    pageDescription: 'Kardex y movimientos del inventario',
    content: `
      <section class="surface-card" style="margin-bottom:18px;">
        <div class="inline-actions">
          <label class="checkline">Mes a limpiar
            <input class="input compact-input" type="month" id="movementMonth">
          </label>
          <button class="button danger compact" type="button" id="deleteMovementMonth">Eliminar movimientos del mes</button>
        </div>
        <p class="muted">Esto elimina solo el historial de movimientos del mes elegido para reducir carga, no las ventas ni los productos.</p>
      </section>
      <section class="surface-card">
        <h3>Ultimos movimientos</h3>
        <div class="table-wrap">
          <table class="table" id="movementsTable">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Usuario</th>
                <th>Items</th>
                <th>Cantidad</th>
                <th>Referencia</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </section>
    `,
  });

  async function loadMovementsPage() {
    const data = await api('/api/admin/movements');
    document.querySelector('#movementsTable tbody').innerHTML = (data.items || []).map((item) => `
      <tr>
        <td>${new Date(item.created_at).toLocaleString()}</td>
        <td>${item.type}</td>
        <td>${item.display_name}</td>
        <td>${item.items_count}</td>
        <td>${item.total_qty}</td>
        <td>${item.ref_table || '-'} ${item.ref_id || ''}</td>
        <td>${item.note || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="muted">Sin movimientos registrados.</td></tr>';
  }

  document.getElementById('movementMonth').value = new Date().toISOString().slice(0, 7);
  await loadMovementsPage();

  document.getElementById('deleteMovementMonth').addEventListener('click', async () => {
    const month = document.getElementById('movementMonth').value;
    if (!month) {
      setNotice('adminNotice', 'Selecciona un mes para eliminar.', 'error');
      return;
    }
    try {
      const result = await api(`/api/admin/movements?month=${encodeURIComponent(month)}`, {
        method: 'DELETE',
      });
      await loadMovementsPage();
      setNotice('adminNotice', `Se eliminaron ${result.deletedMovements} movimientos del mes ${month}.`, 'success');
    } catch (error) {
      setNotice('adminNotice', error.message, 'error');
    }
  });
})().catch((error) => setNotice('adminNotice', error.message, 'error'));
