function getApiBaseUrl() {
  const deployedApiBase =
    window.location.hostname.endsWith('netlify.app')
      ? 'https://licoreria-api.onrender.com'
      : '';

  return typeof window.API_BASE_URL === 'string' && window.API_BASE_URL.trim()
    ? window.API_BASE_URL.trim().replace(/\/+$/, '')
    : (window.APP_BASE_URL || deployedApiBase || '');
}

function resolveApiAssetUrl(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  return `${getApiBaseUrl()}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

async function api(path, options = {}) {
  const apiBase = getApiBaseUrl();
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

window.resolveApiAssetUrl = resolveApiAssetUrl;
