// =========================================================
//  Settings — persist backend mode & lambda function names
// =========================================================

const SETTINGS_KEY = 'rekognition_settings';

const DEFAULT_SETTINGS = {
  mode: 'local',          // 'local' | 'lambda'
  awsRegion: '',          // AWS region (overrides server env AWS_REGION)
  lambdaCompareFn: '',    // Lambda function name/ARN for compare
  lambdaTextFn: '',       // Lambda function name/ARN for text extract
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Current in-memory settings (source of truth during the session)
let appSettings = loadSettings();

// =========================================================
//  Offcanvas
// =========================================================

const offcanvas = document.getElementById('settingsPanel');
const backdrop = document.getElementById('offcanvasBackdrop');
const backendModeSelect = document.getElementById('backendMode');
const awsRegionInput = document.getElementById('awsRegion');
const lambdaSettingsSection = document.getElementById('lambdaSettings');
const lambdaCompareFnInput = document.getElementById('lambdaCompareFn');
const lambdaTextFnInput = document.getElementById('lambdaTextFn');
const modeDescEl = document.getElementById('modeDescription');
const settingSummaryEl = document.getElementById('settingSummary');

const MODE_DESCRIPTIONS = {
  local: '서버 프로세스 내부에서 Lambda 핸들러 JS 파일을 직접 실행합니다.',
  lambda: '배포된 AWS Lambda 함수를 서버가 SDK로 원격 호출합니다.',
};

function openOffcanvas() {
  syncOffcanvasFromSettings(appSettings);
  offcanvas.classList.add('open');
  backdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';
  backendModeSelect.focus();
}

function closeOffcanvas() {
  offcanvas.classList.remove('open');
  backdrop.classList.remove('visible');
  document.body.style.overflow = '';
}

function syncOffcanvasFromSettings(settings) {
  backendModeSelect.value = settings.mode;
  awsRegionInput.value = settings.awsRegion;
  lambdaCompareFnInput.value = settings.lambdaCompareFn;
  lambdaTextFnInput.value = settings.lambdaTextFn;
  updateLambdaVisibility(settings.mode);
  updateSummary(settings);
}

function updateLambdaVisibility(mode) {
  if (mode === 'lambda') {
    lambdaSettingsSection.classList.add('active');
  } else {
    lambdaSettingsSection.classList.remove('active');
  }
  modeDescEl.textContent = MODE_DESCRIPTIONS[mode] || '';
}

function updateSummary(settings) {
  const modeLabel = settings.mode === 'lambda' ? 'AWS Lambda 호출' : '로컬 JS 실행';
  let html = `<strong>리전:</strong> ${settings.awsRegion || '(서버 환경변수 사용)'}`;
  html += `<br/><strong>모드:</strong> ${modeLabel}`;
  if (settings.mode === 'lambda') {
    html += `<br/><strong>비교 함수:</strong> ${settings.lambdaCompareFn || '(미설정)'}`;
    html += `<br/><strong>텍스트 함수:</strong> ${settings.lambdaTextFn || '(미설정)'}`;
  }
  settingSummaryEl.innerHTML = html;
}

function applySettingsToUI(settings) {
  const modeIndicator = document.getElementById('modeIndicator');
  const modeLabelEl = document.getElementById('modeLabel');
  const dot = modeIndicator.querySelector('.mode-dot');

  if (settings.mode === 'lambda') {
    modeLabelEl.textContent = 'AWS Lambda 호출';
    dot.className = 'mode-dot lambda';
  } else {
    modeLabelEl.textContent = '로컬 JS 실행';
    dot.className = 'mode-dot local';
  }

  const btnCompare = document.getElementById('btnCompare');
  const btnText = document.getElementById('btnText');
  if (settings.mode === 'lambda') {
    btnCompare.textContent = 'Lambda로 비교하기';
    btnText.textContent = 'Lambda로 텍스트 추출';
  } else {
    btnCompare.textContent = '비교하기 (로컬)';
    btnText.textContent = '텍스트 추출 (로컬)';
  }
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

// Offcanvas event listeners
document.getElementById('settingsBtn').addEventListener('click', openOffcanvas);
document.getElementById('closeSettings').addEventListener('click', closeOffcanvas);
backdrop.addEventListener('click', closeOffcanvas);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && offcanvas.classList.contains('open')) closeOffcanvas();
});

backendModeSelect.addEventListener('change', () => {
  updateLambdaVisibility(backendModeSelect.value);
});

document.getElementById('saveSettings').addEventListener('click', () => {
  const newSettings = {
    mode: backendModeSelect.value,
    awsRegion: awsRegionInput.value.trim(),
    lambdaCompareFn: lambdaCompareFnInput.value.trim(),
    lambdaTextFn: lambdaTextFnInput.value.trim(),
  };

  if (newSettings.mode === 'lambda') {
    if (!newSettings.lambdaCompareFn || !newSettings.lambdaTextFn) {
      showToast('Lambda 함수 이름을 모두 입력하세요.');
      return;
    }
  }

  appSettings = newSettings;
  saveSettings(appSettings);
  updateSummary(appSettings);
  applySettingsToUI(appSettings);
  closeOffcanvas();
  showToast('설정이 저장되었습니다.');
});

document.getElementById('resetSettings').addEventListener('click', () => {
  appSettings = { ...DEFAULT_SETTINGS };
  saveSettings(appSettings);
  syncOffcanvasFromSettings(appSettings);
  applySettingsToUI(appSettings);
  showToast('초기화되었습니다.');
});

// =========================================================
//  API helpers
// =========================================================

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = data;
    throw error;
  }
  return data;
}

function buildApiBody(baseBody) {
  return {
    ...baseBody,
    _mode: appSettings.mode,
    _awsRegion: appSettings.awsRegion || undefined,
    _lambdaCompareFn: appSettings.lambdaCompareFn,
    _lambdaTextFn: appSettings.lambdaTextFn,
  };
}

// =========================================================
//  Response normalization & rendering utilities
// =========================================================

function normalizeCompareResponse(raw) {
  if (!raw) return raw;
  if (typeof raw === 'object' && typeof raw.statusCode === 'number' && raw.body) {
    try {
      const parsed = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body;
      return parsed;
    } catch (_) {
      return { message: String(raw.body) };
    }
  }
  return raw;
}

function pct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return (Number(n) * 100).toFixed(1) + '%';
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return Number(n).toFixed(digits);
}

function makeVerdict({ matched, requestedSimilarityThreshold, maxSimilarity }) {
  const thr = Number(requestedSimilarityThreshold ?? 0);
  const max = Number(maxSimilarity ?? 0);
  if (matched) {
    return `임계값 ${thr}% 기준으로 최대 유사도 ${fmt(max, 2)}% → 동일 인물로 판단됩니다.`;
  }
  return `임계값 ${thr}% 기준으로 최대 유사도 ${fmt(max, 2)}% → 동일 인물로 보기 어렵습니다.`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// =========================================================
//  Image preview & canvas
// =========================================================

const sourceInput = document.getElementById('sourceImage');
const targetInput = document.getElementById('targetImage');
const thresholdInput = document.getElementById('similarityThreshold');
const sourcePreview = document.getElementById('sourcePreview');
const targetPreview = document.getElementById('targetPreview');
const canvas = document.getElementById('bboxCanvas');
const ctx = canvas.getContext('2d');

let sourceImageBase64 = null;
let targetImageBase64 = null;
let lastCompareResult = null;

function previewImage(file, imgEl) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  imgEl.src = url;
  imgEl.onload = () => URL.revokeObjectURL(url);
}

function syncCanvasToTargetImage() {
  const rect = targetPreview.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawBoundingBox(box, label, isMatch) {
  if (!box) return;
  const w = canvas.width;
  const h = canvas.height;
  const x = box.Left * w;
  const y = box.Top * h;
  const bw = box.Width * w;
  const bh = box.Height * h;

  ctx.lineWidth = 3;
  ctx.strokeStyle = isMatch ? '#10b981' : '#ef4444';
  ctx.strokeRect(x, y, bw, bh);

  if (label) {
    ctx.font = '14px system-ui';
    const pad = 6;
    const tw = ctx.measureText(label).width;
    const bx = x;
    const by = Math.max(0, y - 22);
    ctx.fillStyle = isMatch ? '#10b981' : '#ef4444';
    ctx.fillRect(bx, by, tw + pad * 2, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, bx + pad, by + 15);
  }
}

// =========================================================
//  Compare result renderer
// =========================================================

function renderCompareResult(raw) {
  const resultEl = document.getElementById('compareResult');
  const data = normalizeCompareResponse(raw);
  lastCompareResult = data;
  syncCanvasToTargetImage();

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
      </div>
    `;
    return;
  }

  const matches = Array.isArray(data.matches) ? [...data.matches] : [];
  matches.sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0));

  const matched = Boolean(data.matched);
  const thr = Number(data.requestedSimilarityThreshold ?? 0);
  const max = Number(data.maxSimilarity ?? (matches[0]?.similarity ?? 0));
  const verdict = makeVerdict({ matched, requestedSimilarityThreshold: thr, maxSimilarity: max });
  const badge = matched ? '<span class="badge ok">MATCH</span>' : '<span class="badge no">NO MATCH</span>';

  resultEl.innerHTML = `
    <div class="card">
      ${badge}
      <div class="verdict">${verdict}</div>

      <div class="kvs">
        <div class="kv"><div class="k">Threshold</div><div class="v">${fmt(thr, 0)}%</div></div>
        <div class="kv"><div class="k">Max similarity</div><div class="v">${fmt(max, 2)}%</div></div>
        <div class="kv"><div class="k">Matches</div><div class="v">${matches.length}</div></div>
        <div class="kv"><div class="k">Decision</div><div class="v">${matched ? 'PASS' : 'FAIL'}</div></div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>#</th><th>Similarity</th><th>Confidence</th>
            <th>BoundingBox (Left, Top, Width, Height)</th>
          </tr>
        </thead>
        <tbody>
          ${
            matches.length
              ? matches.map((m, i) => {
                  const b = m.boundingBox || {};
                  return `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${fmt(m.similarity, 2)}%</td>
                      <td>${fmt(m.confidence, 2)}%</td>
                      <td>${pct(b.Left)}, ${pct(b.Top)}, ${pct(b.Width)}, ${pct(b.Height)}</td>
                    </tr>
                  `;
                }).join('')
              : `<tr><td colspan="4">매칭 결과가 없습니다.</td></tr>`
          }
        </tbody>
      </table>

      <details class="debug">
        <summary>원본 응답(JSON)</summary>
        <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>
  `;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (matches[0]?.boundingBox) {
    drawBoundingBox(matches[0].boundingBox, `${fmt(matches[0].similarity, 2)}%`, matched);
  }
}

// =========================================================
//  Image input listeners
// =========================================================

sourceInput.addEventListener('change', async () => {
  try {
    const file = sourceInput.files?.[0];
    previewImage(file, sourcePreview);
    sourceImageBase64 = await fileToBase64(file);
    setStatus('compareStatus', '');
  } catch (e) {
    setStatus('compareStatus', e.message);
  }
});

targetInput.addEventListener('change', async () => {
  try {
    const file = targetInput.files?.[0];
    previewImage(file, targetPreview);
    targetImageBase64 = await fileToBase64(file);
    targetPreview.onload = () => {
      syncCanvasToTargetImage();
      if (lastCompareResult?.matches?.[0]?.boundingBox) {
        renderCompareResult(lastCompareResult);
      }
    };
    setStatus('compareStatus', '');
  } catch (e) {
    setStatus('compareStatus', e.message);
  }
});

// =========================================================
//  Compare form submit
// =========================================================

document.getElementById('compareForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const modeLabel = appSettings.mode === 'lambda' ? 'Lambda' : '로컬';
    setStatus('compareStatus', `${modeLabel}로 비교 중...`);
    document.getElementById('compareResult').innerHTML = '<div class="card">비교 중...</div>';

    const similarityThreshold = Number(thresholdInput.value || 80);
    if (!sourceImageBase64 || !targetImageBase64) {
      throw new Error('Source/Target 이미지를 모두 선택하세요.');
    }

    if (appSettings.mode === 'lambda' && !appSettings.lambdaCompareFn) {
      throw new Error('설정에서 Lambda 함수 이름을 먼저 입력하세요.');
    }

    const result = await postJson('/api/compare', buildApiBody({
      sourceImageBase64,
      targetImageBase64,
      similarityThreshold,
    }));

    renderCompareResult(result);
    setStatus('compareStatus', '');
  } catch (error) {
    renderCompareResult({ message: error.message, detail: error.payload || null });
    setStatus('compareStatus', '오류 발생');
  }
});

// =========================================================
//  Text extract form submit
// =========================================================

function renderJsonPre(id, payload) {
  document.getElementById(id).textContent = JSON.stringify(payload, null, 2);
}

document.getElementById('textForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const modeLabel = appSettings.mode === 'lambda' ? 'Lambda' : '로컬';
    setStatus('textStatus', `${modeLabel}로 추출 중...`);

    if (appSettings.mode === 'lambda' && !appSettings.lambdaTextFn) {
      throw new Error('설정에서 Lambda 함수 이름을 먼저 입력하세요.');
    }

    const file = document.getElementById('textImage').files[0];
    const imageBase64 = await fileToBase64(file);

    const result = await postJson('/api/extract-text', buildApiBody({ imageBase64 }));
    renderJsonPre('textResult', result);
    setStatus('textStatus', '');
  } catch (error) {
    renderJsonPre('textResult', { message: error.message });
    setStatus('textStatus', '오류 발생');
  }
});

// =========================================================
//  Resize handler
// =========================================================

window.addEventListener('resize', () => {
  if (!targetPreview.src) return;
  syncCanvasToTargetImage();
  if (lastCompareResult) renderCompareResult(lastCompareResult);
});

// =========================================================
//  Init
// =========================================================

applySettingsToUI(appSettings);
document.getElementById('compareResult').innerHTML =
  '<div class="card">이미지를 선택하면 결과가 여기에 표시됩니다.</div>';
