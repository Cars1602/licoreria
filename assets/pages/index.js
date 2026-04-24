api('/api/config').then((data) => {
  window.APP_BASE_URL = data.appBaseUrl || '';
  document.title = 'Login | ' + (data.settings.business_name || 'Licoreria');
}).catch(() => {
  setNotice('loginNotice', 'Debes iniciar el servidor Node.js para usar el sistema.', 'error');
});

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  setNotice('loginNotice', '');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
      }),
    });

    if (!data.user || !data.user.role) {
      throw new Error('No se pudo iniciar sesion');
    }

    if (data.user.role === 'admin') {
      window.location.href = (window.APP_BASE_URL || '') + '/admin';
    } else {
      window.location.href = (window.APP_BASE_URL || '') + '/employee';
    }
  } catch (error) {
    setNotice('loginNotice', error.message, 'error');
  }
});
