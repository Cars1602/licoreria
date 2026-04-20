async function api(path, options = {}) {
  const deployedApiBase =
    window.location.hostname.endsWith('netlify.app')
      ? 'https://licoreria-api.onrender.com'
      : '';
  const apiBase = typeof window.API_BASE_URL === 'string' && window.API_BASE_URL.trim()
    ? window.API_BASE_URL.trim().replace(/\/+$/, '')
    : (window.APP_BASE_URL || deployedApiBase || '');
  const response = await fetch(apiBase + path, {
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
