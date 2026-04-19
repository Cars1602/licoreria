async function fetchCatalogOptions() {
  return api('/api/admin/catalogs');
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function setLoading(el, active) {
  if (!el) return;
  el.disabled = active;
  el.classList.toggle('loading', active);
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
