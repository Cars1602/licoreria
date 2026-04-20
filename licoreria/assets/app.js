async function api(path, options = {}) {
  const baseUrl = window.API_BASE_URL;
  const response = await fetch(baseUrl + path, {
    credentials: 'include',
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data.error || data.detail || 'Error');
  }
  return data;
}

function setNotice(targetId, message, type = 'error') {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!message) {
    el.className = 'hidden';
    el.textContent = '';
    return;
  }
  el.className = `notice ${type}`;
  el.textContent = message;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}
