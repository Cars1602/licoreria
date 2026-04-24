const mobileToken = new URLSearchParams(window.location.search).get('token') || '';
let mobileDetector = null;
let mobileScanTimer = null;
let mobileMediaStream = null;

function renderMobileCart(items) {
  document.querySelector('#mobileCartTable tbody').innerHTML = items.length
    ? items.map((item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.qty}</td>
          <td>Bs ${money(item.price)}</td>
          <td>Bs ${money(item.subtotal)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="muted">Sin productos en el carrito.</td></tr>';
}

async function loadMobileSessionPage() {
  const config = await api('/api/config');
  window.APP_BASE_URL = config.appBaseUrl || '';
  const data = await api(`/api/mobile-pos/session?token=${encodeURIComponent(mobileToken)}`);
  document.title = `POS Movil | ${data.pos.display_name}`;
  document.getElementById('mobileSubtitle').textContent = `Sesion de ${data.pos.display_name} | ${data.pos.email}`;
  renderMobileCart(data.items || []);
}

function playBeep() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.type = 'square';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch {
    // no-op
  }
}

async function addQrToMobileCart(qrText) {
  try {
    const data = await api('/api/mobile-pos/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: mobileToken, qr_text: qrText }),
    });
    renderMobileCart(data.items || []);
    setNotice('mobileNotice', data.message, 'success');
    playBeep();
    if ('vibrate' in navigator) {
      navigator.vibrate(200);
    }
  } catch (error) {
    setNotice('mobileNotice', error.message, 'error');
  }
}

async function startMobileScanner() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('Este celular no soporta BarcodeDetector. Usa la carga manual.');
  }

  mobileDetector = new BarcodeDetector({ formats: ['qr_code'] });
  mobileMediaStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });

  const video = document.getElementById('mobileVideo');
  video.srcObject = mobileMediaStream;
  video.classList.remove('hidden');

  mobileScanTimer = window.setInterval(async () => {
    try {
      const codes = await mobileDetector.detect(video);
      if (!codes.length) return;
      const value = codes[0].rawValue || '';
      if (!value) return;
      stopMobileScanner();
      await addQrToMobileCart(value);
    } catch {
      // ignore frame errors
    }
  }, 900);
}

function stopMobileScanner() {
  if (mobileScanTimer) {
    window.clearInterval(mobileScanTimer);
    mobileScanTimer = null;
  }
  if (mobileMediaStream) {
    mobileMediaStream.getTracks().forEach((track) => track.stop());
    mobileMediaStream = null;
  }
  document.getElementById('mobileVideo').classList.add('hidden');
}

document.getElementById('startScanButton').addEventListener('click', async () => {
  try {
    await startMobileScanner();
  } catch (error) {
    setNotice('mobileNotice', error.message, 'error');
  }
});

document.getElementById('stopScanButton').addEventListener('click', stopMobileScanner);

document.getElementById('manualAddButton').addEventListener('click', async () => {
  const value = document.getElementById('manualQrInput').value.trim();
  if (!value) return;
  try {
    await addQrToMobileCart(value);
    document.getElementById('manualQrInput').value = '';
  } catch (error) {
    setNotice('mobileNotice', error.message, 'error');
  }
});

loadMobileSessionPage().catch((error) => setNotice('mobileNotice', error.message, 'error'));
window.addEventListener('beforeunload', stopMobileScanner);
