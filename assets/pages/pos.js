const posParams = new URLSearchParams(window.location.search);
const posId = posParams.get('pos_id');
let currentSettings = null;
let cartItems = [];
let barcodeDetector = null;
let scannerTimer = null;
let scannerStream = null;

function recalcPos() {
  const total = cartItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const discount = Number(document.getElementById('discount').value || 0);
  const payable = Math.max(0, total - discount);
  const paymentMethod = document.getElementById('paymentMethod').value;
  const cashReceived = Number(document.getElementById('cashReceived').value || 0);
  const change = paymentMethod === 'CASH' ? Math.max(0, cashReceived - payable) : 0;
  document.getElementById('cashReceived').classList.toggle('hidden', paymentMethod !== 'CASH');
  document.getElementById('changeDue').classList.toggle('hidden', paymentMethod !== 'CASH');
  document.getElementById('qrBox').classList.toggle('hidden', paymentMethod !== 'QR');
  document.getElementById('totalPayable').value = money(payable);
  document.getElementById('changeDue').value = money(change);
  if (paymentMethod !== 'QR') {
    document.getElementById('qrConfirmed').checked = false;
  }
}

function renderPosCart() {
  document.querySelector('#cartTable tbody').innerHTML = cartItems.length
    ? cartItems.map((item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.barcode}</td>
          <td>${item.qty}</td>
          <td>Bs ${money(item.price)}</td>
          <td>Bs ${money(item.subtotal)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="muted">El carrito esta vacio.</td></tr>';
  recalcPos();
}

async function loadConnectionQr() {
  const data = await api(`/api/pos/${posId}/connect`);
  document.getElementById('connectQrImage').src = data.qrDataUrl;
  document.getElementById('connectUrlText').textContent = data.mobileUrl;
}

async function addQrTextToCart(qrText) {
  await api(`/api/pos/${posId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_text: qrText }),
  });
  document.getElementById('scanInput').value = '';
  await loadPosPage();
}

async function startPosScanner() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('Este navegador no soporta escaneo por camara.');
  }
  barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  scannerStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });

  const video = document.getElementById('posScannerVideo');
  video.srcObject = scannerStream;
  video.classList.remove('hidden');

  scannerTimer = window.setInterval(async () => {
    try {
      const codes = await barcodeDetector.detect(video);
      if (!codes.length) return;
      const rawValue = codes[0].rawValue || '';
      if (!rawValue) return;
      stopPosScanner();
      await addQrTextToCart(rawValue);
      setNotice('posNotice', 'Producto agregado al carrito por QR', 'success');
    } catch {
      // ignore frame issues
    }
  }, 900);
}

function stopPosScanner() {
  if (scannerTimer) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  document.getElementById('posScannerVideo').classList.add('hidden');
}

async function loadPosPage() {
  const config = await api('/api/config');
  window.APP_BASE_URL = config.appBaseUrl || '';
  currentSettings = config.settings;
  const data = await api(`/api/pos/${posId}`);
  cartItems = data.items || [];
  currentSettings = data.settings || currentSettings;
  document.getElementById('posSubtitle').textContent = `Sesion ${data.pos.id}`;
  document.getElementById('qrLabel').textContent = currentSettings.qr_payment_label || 'Escanea este QR para pagar';
  if (currentSettings.qr_payment_image) {
    document.getElementById('qrImage').src = resolveApiAssetUrl(currentSettings.qr_payment_image);
  }
  renderPosCart();
  await loadConnectionQr();
}

document.getElementById('scanButton').addEventListener('click', async () => {
  const qrText = document.getElementById('scanInput').value.trim();
  if (!qrText) return;
  try {
    await addQrTextToCart(qrText);
  } catch (error) {
    setNotice('posNotice', error.message, 'error');
  }
});

document.getElementById('startScannerButton').addEventListener('click', async () => {
  try {
    await startPosScanner();
  } catch (error) {
    setNotice('posNotice', error.message, 'error');
  }
});

document.getElementById('stopScannerButton').addEventListener('click', stopPosScanner);
document.getElementById('paymentMethod').addEventListener('change', recalcPos);
document.getElementById('discount').addEventListener('input', recalcPos);
document.getElementById('cashReceived').addEventListener('input', recalcPos);

document.getElementById('finalizeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = {
      payment_method: document.getElementById('paymentMethod').value,
      discount: document.getElementById('discount').value,
      cash_received: document.getElementById('cashReceived').value,
      qr_confirmed: document.getElementById('qrConfirmed').checked ? '1' : '0',
    };
    const data = await api(`/api/pos/${posId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    window.location.href = `${window.APP_BASE_URL}/ticket?sale_id=${data.saleId}&print=1`;
  } catch (error) {
    setNotice('posNotice', error.message, 'error');
  }
});

loadPosPage().catch((error) => setNotice('posNotice', error.message, 'error'));
window.addEventListener('beforeunload', stopPosScanner);
