// HTTP 서버 생성을 위해 Node 내장 모듈을 사용합니다.
const http = require('http');
// WSL 네트워크 인터페이스에서 접근 가능한 IPv4 주소를 찾기 위해 os 모듈을 사용합니다.
const os = require('os');
// 정적 파일 존재 확인/스트리밍을 위해 fs 모듈을 사용합니다.
const fs = require('fs');
// 경로 정규화를 위해 path 모듈을 사용합니다.
const path = require('path');
// Linux/WSL 런타임에서만 웹 데모를 시작하도록 보호합니다.
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
// 기존 백엔드 로직을 재사용하기 위해 로컬 핸들러를 불러옵니다.
const { handler: compareUploadedFacesHandler } = require('../lambda/compareUploadedFacesHandler');
// 텍스트 추출 로컬 핸들러입니다.
const { handler: detectTextHandler } = require('../lambda/detectTextHandler');

// Windows Node.js로 직접 실행되는 실수를 빠르게 차단합니다.
ensureLinuxRuntime('web');

// 정적 웹 리소스(index.html, css, js)가 위치한 디렉터리 절대 경로입니다.
const publicDir = path.resolve(__dirname, 'public');

// JSON 응답을 공통 형식으로 보내는 헬퍼입니다.
function sendJson(res, statusCode, payload) {
  // JSON MIME 타입과 UTF-8 인코딩을 명시해 헤더를 설정합니다.
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  // payload 객체를 직렬화해 응답 본문으로 종료합니다.
  res.end(JSON.stringify(payload));
}

// POST 요청 본문을 문자열로 수집한 뒤 JSON으로 파싱합니다.
function parseRequestBody(req) {
  // 스트림 이벤트를 Promise 인터페이스로 감싸 async/await와 맞춥니다.
  return new Promise((resolve, reject) => {
    // 수신 데이터를 누적할 버퍼 문자열입니다.
    let body = '';
    // 데이터 청크가 올 때마다 문자열로 변환해 누적합니다.
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    // 전송이 끝나면 JSON 파싱을 시도합니다.
    req.on('end', () => {
      try {
        // body가 비어 있으면 빈 객체를 기본값으로 반환합니다.
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        // JSON 형식 오류는 사용자 친화적인 메시지로 치환합니다.
        reject(new Error('요청 JSON 형식이 올바르지 않습니다.'));
      }
    });
    // 스트림 자체 에러는 그대로 reject 처리합니다.
    req.on('error', reject);
  });
}

// 기존 Lambda 스타일 핸들러를 현재 Node.js BE API 안에서 재사용합니다.
async function runApiHandler(handler, body) {
  // API Gateway 프록시 이벤트와 최대한 비슷한 입력으로 호출합니다.
  const response = await handler({ body: JSON.stringify(body) });
  // 반환 statusCode/body를 HTTP 응답에 맞는 형태로 정규화합니다.
  const payload = typeof response?.body === 'string' ? JSON.parse(response.body) : response?.body || {};

  return {
    statusCode: Number(response?.statusCode || 200),
    body: payload,
  };
}

// WSL/리눅스에서 외부에서 접근 가능한 대표 IPv4 주소를 찾습니다.
function getAccessibleIpv4() {
  // eth0가 있으면 우선 사용하고, 없으면 다른 외부 IPv4를 찾습니다.
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }

      candidates.push({
        name,
        address: entry.address,
        cidr: entry.cidr,
      });
    }
  }

  return candidates.find((entry) => entry.name === 'eth0') || candidates[0] || null;
}

// /api 외 경로에 대해 정적 파일을 제공하는 핸들러입니다.
function serveStatic(req, res) {
  // 루트 요청은 index.html로 매핑하고 그 외에는 요청 경로를 그대로 사용합니다.
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  // publicDir 하위의 실제 파일 절대 경로를 계산합니다.
  const filePath = path.resolve(publicDir, `.${requestPath}`);

  // 디렉터리 탈출 요청이거나 파일이 없으면 404를 반환합니다.
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // 확장자 기반으로 Content-Type을 설정하기 위해 ext를 추출합니다.
  const ext = path.extname(filePath);
  // 필요한 최소 확장자에 대한 MIME 타입 매핑입니다.
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
  };

  // 감지된 타입(없으면 text/plain)으로 응답 헤더를 작성합니다.
  res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
  // 파일 스트림을 응답으로 파이프해 메모리 사용을 줄입니다.
  fs.createReadStream(filePath).pipe(res);
}

// API 라우팅과 정적 서빙을 모두 처리하는 HTTP 서버를 생성합니다.
const server = http.createServer(async (req, res) => {
  try {
    // 얼굴 비교 API 엔드포인트입니다.
    if (req.method === 'POST' && req.url === '/api/compare') {
      // 요청 본문(JSON)을 파싱합니다.
      const body = await parseRequestBody(req);
      // 필수 입력 두 이미지가 없으면 400으로 즉시 반환합니다.
      if (!body.sourceImageBase64 || !body.targetImageBase64) {
        return sendJson(res, 400, { message: 'sourceImageBase64, targetImageBase64 값이 필요합니다.' });
      }

      // 기존 compare 핸들러를 현재 Node.js 백엔드 프로세스 안에서 직접 실행합니다.
      const apiResult = await runApiHandler(compareUploadedFacesHandler, {
        sourceImageBase64: body.sourceImageBase64,
        targetImageBase64: body.targetImageBase64,
        similarityThreshold: Number(body.similarityThreshold || 80),
      });
      // 백엔드 핸들러 결과를 그대로 프런트에 반환합니다.
      return sendJson(res, apiResult.statusCode, apiResult.body);
    }

    // 텍스트 추출 API 엔드포인트입니다.
    if (req.method === 'POST' && req.url === '/api/extract-text') {
      // 요청 본문(JSON)을 파싱합니다.
      const body = await parseRequestBody(req);
      // 필수 이미지 입력이 없으면 400으로 즉시 반환합니다.
      if (!body.imageBase64) {
        return sendJson(res, 400, { message: 'imageBase64 값이 필요합니다.' });
      }

      // 텍스트 추출도 동일하게 로컬 백엔드 핸들러를 직접 실행합니다.
      const apiResult = await runApiHandler(detectTextHandler, {
        imageBase64: body.imageBase64,
      });
      // 정규화된 결과를 그대로 JSON으로 반환합니다.
      return sendJson(res, apiResult.statusCode, apiResult.body);
    }

    // API가 아닌 요청은 정적 파일로 처리합니다.
    serveStatic(req, res);
  } catch (error) {
    // 예외 발생 시 500과 에러 메시지를 JSON으로 반환합니다.
    sendJson(res, 500, { message: error.message });
  }
});

// WSL에서 Windows 호스트 브라우저로 접속되도록 기본 바인딩 주소를 0.0.0.0로 둡니다.
const host = process.env.WEB_HOST || '0.0.0.0';
// 웹 서버 포트는 환경 변수 우선, 기본값은 3000입니다.
const port = Number(process.env.WEB_PORT || 3000);

// 포트 충돌처럼 자주 겪는 시작 실패 원인을 더 이해하기 쉽게 안내합니다.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing process or run with WEB_PORT=<other-port>.`);
    process.exit(1);
  }

  console.error(error.message);
  process.exit(1);
});

// 서버를 시작하고 접속 URL을 콘솔에 출력합니다.
server.listen(port, host, () => {
  const browserHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Web demo + Node BE API started: http://${browserHost}:${port} (bind ${host}:${port})`);

  const accessibleIpv4 = getAccessibleIpv4();
  if (accessibleIpv4) {
    console.log(`WSL IPv4: ${accessibleIpv4.cidr}`);
    console.log(`Open from Windows browser via WSL virtual IP: http://${accessibleIpv4.address}:${port}`);
  }
});
