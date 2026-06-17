// =========================================================
//  API 엔드포인트 설정
//  S3 정적 서빙 환경 — Node.js 서버 없이 API Gateway 직접 호출
// =========================================================

const API_SETTINGS_KEY = 'rekognition_api_base';
const DEFAULT_API_BASE = 'https://ab8004tdfe.execute-api.ap-northeast-2.amazonaws.com';

function getApiBase() {
  return localStorage.getItem(API_SETTINGS_KEY) || DEFAULT_API_BASE;
}

// =========================================================
//  Offcanvas
// =========================================================

const offcanvas = document.getElementById('settingsPanel');
const backdrop = document.getElementById('offcanvasBackdrop');
const apiBaseInput = document.getElementById('apiBaseUrl');

function openOffcanvas() {
  apiBaseInput.value = getApiBase();
  updateApiSummary();
  offcanvas.classList.add('open');
  backdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeOffcanvas() {
  offcanvas.classList.remove('open');
  backdrop.classList.remove('visible');
  document.body.style.overflow = '';
}

function updateApiSummary() {
  const base = getApiBase();
  const el = document.getElementById('apiSummary');
  if (!el) return;
  el.innerHTML = `
    <div class="api-row"><span class="api-label">얼굴 비교</span><code>${base}/compare</code></div>
    <div class="api-row"><span class="api-label">텍스트 추출</span><code>${base}/extract-text</code></div>
  `;
}

function showToast(message) {
  let toast = document.getElementById('_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

document.getElementById('settingsBtn').addEventListener('click', openOffcanvas);
document.getElementById('closeSettings').addEventListener('click', closeOffcanvas);
backdrop.addEventListener('click', closeOffcanvas);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && offcanvas.classList.contains('open')) closeOffcanvas();
});

document.getElementById('saveSettings').addEventListener('click', () => {
  const val = apiBaseInput.value.trim().replace(/\/$/, '');
  if (!val) {
    showToast('API Base URL을 입력하세요.');
    return;
  }
  localStorage.setItem(API_SETTINGS_KEY, val);
  updateApiSummary();
  closeOffcanvas();
  showToast('저장되었습니다.');
});

document.getElementById('resetSettings').addEventListener('click', () => {
  localStorage.removeItem(API_SETTINGS_KEY);
  apiBaseInput.value = DEFAULT_API_BASE;
  updateApiSummary();
  showToast('기본값으로 초기화되었습니다.');
});

// =========================================================
//  HTTP helper
// =========================================================

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.message || `HTTP ${response.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

async function fileToBase64(file) {
  if (!file) throw new Error('파일을 선택하세요.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

// =========================================================
//  Image preview & canvas
// =========================================================

const sourceInput   = document.getElementById('sourceImage');
const targetInput   = document.getElementById('targetImage');
const thresholdInput = document.getElementById('similarityThreshold');
const sourcePreview = document.getElementById('sourcePreview');
const targetPreview = document.getElementById('targetPreview');
const canvas = document.getElementById('bboxCanvas');
const ctx    = canvas.getContext('2d');

let sourceImageBase64 = null;
let targetImageBase64 = null;
let lastCompareResult = null;

function previewImage(file, imgEl) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  imgEl.src = url;
  imgEl.onload = () => URL.revokeObjectURL(url);
}

function syncCanvas() {
  const rect = targetPreview.getBoundingClientRect();
  canvas.width  = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  canvas.style.width  = rect.width  + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawBoundingBox(box, label, isMatch) {
  if (!box) return;
  const w = canvas.width, h = canvas.height;
  const x = box.Left * w, y = box.Top * h;
  const bw = box.Width * w, bh = box.Height * h;
  ctx.lineWidth = 3;
  ctx.strokeStyle = isMatch ? '#10b981' : '#ef4444';
  ctx.strokeRect(x, y, bw, bh);
  if (label) {
    ctx.font = '14px system-ui';
    const pad = 6, tw = ctx.measureText(label).width;
    const bx = x, by = Math.max(0, y - 22);
    ctx.fillStyle = isMatch ? '#10b981' : '#ef4444';
    ctx.fillRect(bx, by, tw + pad * 2, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + pad, by + 15);
  }
}

// =========================================================
//  Compare result renderer
// =========================================================

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  return Number(n).toFixed(d);
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  return (Number(n) * 100).toFixed(1) + '%';
}

function makeVerdict({ matched, requestedSimilarityThreshold: thr, maxSimilarity: max }) {
  const t = Number(thr ?? 0), m = Number(max ?? 0);
  return matched
    ? `임계값 ${t}% 기준으로 최대 유사도 ${fmt(m)}% → 동일 인물로 판단됩니다.`
    : `임계값 ${t}% 기준으로 최대 유사도 ${fmt(m)}% → 동일 인물로 보기 어렵습니다.`;
}

function normalizeCompareResponse(raw) {
  if (!raw) return raw;
  if (typeof raw.statusCode === 'number' && raw.body) {
    try { return typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body; }
    catch (_) { return { message: String(raw.body) }; }
  }
  return raw;
}

function renderCompareResult(raw) {
  const resultEl = document.getElementById('compareResult');
  const data = normalizeCompareResponse(raw);
  lastCompareResult = data;
  syncCanvas();

  if (!data || data.message) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resultEl.innerHTML = `
      <div class="card">
        <span class="badge no">ERROR</span>
        <div class="verdict">${data?.message || '알 수 없는 오류'}</div>
        <details class="debug" open>
          <summary>원본 응답(JSON)</summary>
          <pre>${escapeHtml(JSON.stringify(raw, null, 2))}</pre>
        </details>
      </div>`;
    return;
  }

  const matches = Array.isArray(data.matches) ? [...data.matches] : [];
  matches.sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0));
  const matched = Boolean(data.matched);
  const thr = Number(data.requestedSimilarityThreshold ?? 0);
  const max = Number(data.maxSimilarity ?? (matches[0]?.similarity ?? 0));

  resultEl.innerHTML = `
    <div class="card">
      ${matched ? '<span class="badge ok">MATCH</span>' : '<span class="badge no">NO MATCH</span>'}
      <div class="verdict">${makeVerdict({ matched, requestedSimilarityThreshold: thr, maxSimilarity: max })}</div>
      <div class="kvs">
        <div class="kv"><div class="k">Threshold</div><div class="v">${fmt(thr, 0)}%</div></div>
        <div class="kv"><div class="k">Max similarity</div><div class="v">${fmt(max)}%</div></div>
        <div class="kv"><div class="k">Matches</div><div class="v">${matches.length}</div></div>
        <div class="kv"><div class="k">Decision</div><div class="v">${matched ? 'PASS' : 'FAIL'}</div></div>
      </div>
      <table class="table">
        <thead><tr><th>#</th><th>Similarity</th><th>Confidence</th><th>BoundingBox (L,T,W,H)</th></tr></thead>
        <tbody>
          ${matches.length
            ? matches.map((m, i) => {
                const b = m.boundingBox || {};
                return `<tr><td>${i+1}</td><td>${fmt(m.similarity)}%</td><td>${fmt(m.confidence)}%</td>
                        <td>${pct(b.Left)}, ${pct(b.Top)}, ${pct(b.Width)}, ${pct(b.Height)}</td></tr>`;
              }).join('')
            : '<tr><td colspan="4">매칭 결과가 없습니다.</td></tr>'}
        </tbody>
      </table>
      <details class="debug">
        <summary>원본 응답(JSON)</summary>
        <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (matches[0]?.boundingBox) drawBoundingBox(matches[0].boundingBox, `${fmt(matches[0].similarity)}%`, matched);
}

// =========================================================
//  Image input listeners
// =========================================================

sourceInput.addEventListener('change', async () => {
  try {
    previewImage(sourceInput.files?.[0], sourcePreview);
    sourceImageBase64 = await fileToBase64(sourceInput.files?.[0]);
    setStatus('compareStatus', '');
  } catch (e) { setStatus('compareStatus', e.message); }
});

targetInput.addEventListener('change', async () => {
  try {
    const file = targetInput.files?.[0];
    previewImage(file, targetPreview);
    targetImageBase64 = await fileToBase64(file);
    targetPreview.onload = () => {
      syncCanvas();
      if (lastCompareResult?.matches?.[0]?.boundingBox) renderCompareResult(lastCompareResult);
    };
    setStatus('compareStatus', '');
  } catch (e) { setStatus('compareStatus', e.message); }
});

// =========================================================
//  Compare form — API Gateway 직접 호출
// =========================================================

document.getElementById('compareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    setStatus('compareStatus', '비교 중...');
    document.getElementById('compareResult').innerHTML = '<div class="card">비교 중...</div>';
    if (!sourceImageBase64 || !targetImageBase64) throw new Error('Source/Target 이미지를 모두 선택하세요.');

    const result = await postJson(`${getApiBase()}/compare`, {
      sourceImageBase64,
      targetImageBase64,
      similarityThreshold: Number(thresholdInput.value || 80),
    });

    renderCompareResult(result);
    setStatus('compareStatus', '');
  } catch (err) {
    renderCompareResult({ message: err.message, detail: err.payload || null });
    setStatus('compareStatus', '오류 발생');
  }
});

// =========================================================
//  Text form — API Gateway 직접 호출
// =========================================================

document.getElementById('textForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    setStatus('textStatus', '추출 중...');
    const imageBase64 = await fileToBase64(document.getElementById('textImage').files[0]);
    const result = await postJson(`${getApiBase()}/extract-text`, { imageBase64 });
    document.getElementById('textResult').textContent = JSON.stringify(result, null, 2);
    setStatus('textStatus', '');
  } catch (err) {
    document.getElementById('textResult').textContent = JSON.stringify({ message: err.message }, null, 2);
    setStatus('textStatus', '오류 발생');
  }
});

// =========================================================
//  Resize & init
// =========================================================

window.addEventListener('resize', () => {
  if (!targetPreview.src) return;
  syncCanvas();
  if (lastCompareResult) renderCompareResult(lastCompareResult);
});

updateApiSummary();
document.getElementById('compareResult').innerHTML =
  '<div class="card">이미지를 선택하면 결과가 여기에 표시됩니다.</div>';
