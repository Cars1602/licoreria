async function loadCatalogsPage() {
  const data = await api('/api/admin/catalogs');
  document.getElementById('categoryList').innerHTML = (data.categories || []).map((item) => `
    <span class="chip">
      ${item.name}
      <button class="chip-delete" type="button" data-delete-category="${item.id}">x</button>
    </span>
  `).join('') || '<span class="muted">Sin categorias.</span>';
  document.getElementById('brandList').innerHTML = (data.brands || []).map((item) => `
    <span class="chip">
      ${item.name}
      <button class="chip-delete" type="button" data-delete-brand="${item.id}">x</button>
    </span>
  `).join('') || '<span class="muted">Sin marcas.</span>';
}

(async () => {
  await bootAdminPage({
    key: 'catalogs',
    pageTitle: 'Marcas y Categorias',
    pageHeading: 'MARCAS Y CATEGORIAS',
    pageDescription: 'Catalogos base del inventario',
    content: `
      <div class="triple-grid">
        <section class="surface-card">
          <h3>Categorias</h3>
          <form class="catalogForm stack-form" data-type="categories" action="javascript:void(0);">
            <input class="input" name="name" placeholder="Nueva categoria" required>
            <button class="button secondary" type="submit">Guardar categoria</button>
          </form>
          <div id="categoryList" class="chip-list"></div>
        </section>

        <section class="surface-card">
          <h3>Marcas</h3>
          <form class="catalogForm stack-form" data-type="brands" action="javascript:void(0);">
            <input class="input" name="name" placeholder="Nueva marca" required>
            <button class="button secondary" type="submit">Guardar marca</button>
          </form>
          <div id="brandList" class="chip-list"></div>
        </section>

        <section class="surface-card">
          <h3>Resumen</h3>
          <p class="muted">Usa estas opciones para clasificar productos y mantener el inventario ordenado.</p>
        </section>
      </div>
    `,
  });

  await loadCatalogsPage();

  document.querySelectorAll('.catalogForm').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentForm = event.currentTarget;
      const type = currentForm.dataset.type;
      const payload = Object.fromEntries(new FormData(currentForm).entries());
      try {
        await api(`/api/admin/catalogs/${type}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        currentForm.reset();
        await loadCatalogsPage();
        setNotice('adminNotice', 'Catalogo guardado correctamente', 'success');
      } catch (error) {
        setNotice('adminNotice', error.message, 'error');
      }
    });
  });

  document.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete-category]');
    const deleteBrandButton = event.target.closest('[data-delete-brand]');
    try {
      if (deleteButton) {
        await api(`/api/admin/catalogs/categories/${deleteButton.dataset.deleteCategory}`, {
          method: 'DELETE',
        });
        setNotice('adminNotice', 'Categoria eliminada correctamente', 'success');
      } else if (deleteBrandButton) {
        await api(`/api/admin/catalogs/brands/${deleteBrandButton.dataset.deleteBrand}`, {
          method: 'DELETE',
        });
        setNotice('adminNotice', 'Marca eliminada correctamente', 'success');
      } else {
        return;
      }
      await loadCatalogsPage();
    } catch (error) {
      setNotice('adminNotice', error.message, 'error');
    }
  });
})().catch((error) => setNotice('adminNotice', error.message, 'error'));
