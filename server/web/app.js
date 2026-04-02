// HTTP 서버 생성을 위해 Node 내장 모듈을 사용합니다.
const http = require('http');
// 정적 파일 존재 확인/스트리밍을 위해 fs 모듈을 사용합니다.
const fs = require('fs');
// 경로 정규화를 위해 path 모듈을 사용합니다.
const path = require('path');
// Lambda 호출을 위해 AWS SDK를 사용합니다.
const AWS = require('aws-sdk');
// Linux/WSL 런타임에서만 웹 데모를 시작하도록 보호합니다.
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
// 공통 환경 설정 유틸리티를 불러옵니다.
const { getConfig } = require('../src/config');

// Windows Node.js로 직접 실행되는 실수를 빠르게 차단합니다.
ensureLinuxRuntime('web');

// AWS 리전은 환경 변수 우선, 없으면 공통 설정에서 가져옵니다.
const region = process.env.AWS_REGION || getConfig().region;
// Lambda Invoke API를 사용할 클라이언트를 초기화합니다.
const lambda = new AWS.Lambda({ region });
// 얼굴 비교 Lambda 함수명(환경 변수로 오버라이드 가능)입니다.
const compareFunctionName = process.env.LAMBDA_COMPARE_UPLOAD_FUNCTION || 'rekognition-face-compare-upload';
// 텍스트 추출 Lambda 함수명(환경 변수로 오버라이드 가능)입니다.
const textFunctionName = process.env.LAMBDA_TEXT_FUNCTION || 'rekognition-text-detect';

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

// Lambda invoke 응답(Payload)을 파싱해 {statusCode, body} 형태로 정규화합니다.
function parseLambdaPayload(response) {
  // Payload가 Buffer/Uint8Array일 수 있으므로 UTF-8 문자열로 변환합니다.
  const payloadText = response.Payload ? Buffer.from(response.Payload).toString('utf-8') : '{}';
  // 최상위 payload(JSON 문자열)를 객체로 파싱합니다.
  const payload = payloadText ? JSON.parse(payloadText) : {};
  // Lambda proxy 형식이라면 body를 한 번 더 파싱하고, 아니면 payload 자체를 사용합니다.
  const body = payload.body ? JSON.parse(payload.body) : payload;

  // statusCode 기본값을 200으로 보정해 반환합니다.
  return {
    statusCode: Number(payload.statusCode || 200),
    body,
  };
}

// Lambda proxy 이벤트 형태로 감싸는 빌더 함수입니다.
function buildLambdaEvent(body) {
  // API Gateway 프록시와 동일하게 body를 문자열 JSON으로 전달합니다.
  return {
    body: JSON.stringify(body),
  };
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

      // 비교 Lambda를 동기 호출(RequestResponse)합니다.
      const response = await lambda
        .invoke({
          // 호출 대상 함수 이름입니다.
          FunctionName: compareFunctionName,
          // 결과를 기다리는 동기 호출 모드입니다.
          InvocationType: 'RequestResponse',
          // Lambda가 기대하는 이벤트 구조로 payload를 전달합니다.
          Payload: JSON.stringify(buildLambdaEvent({
            sourceImageBase64: body.sourceImageBase64,
            targetImageBase64: body.targetImageBase64,
            similarityThreshold: Number(body.similarityThreshold || 80),
          })),
        })
        .promise();

      // Lambda 응답을 표준 JSON 응답 형태로 변환합니다.
      const lambdaResult = parseLambdaPayload(response);
      // Lambda가 반환한 status/body를 그대로 클라이언트에 전달합니다.
      return sendJson(res, lambdaResult.statusCode, lambdaResult.body);
    }

    // 텍스트 추출 API 엔드포인트입니다.
    if (req.method === 'POST' && req.url === '/api/extract-text') {
      // 요청 본문(JSON)을 파싱합니다.
      const body = await parseRequestBody(req);
      // 필수 이미지 입력이 없으면 400으로 즉시 반환합니다.
      if (!body.imageBase64) {
        return sendJson(res, 400, { message: 'imageBase64 값이 필요합니다.' });
      }

      // 텍스트 추출 Lambda를 동기 호출합니다.
      const response = await lambda
        .invoke({
          // 호출 대상 함수 이름입니다.
          FunctionName: textFunctionName,
          // 결과를 기다리는 동기 호출 모드입니다.
          InvocationType: 'RequestResponse',
          // imageBase64만 포함한 proxy 이벤트를 전달합니다.
          Payload: JSON.stringify(buildLambdaEvent({ imageBase64: body.imageBase64 })),
        })
        .promise();

      // Lambda 응답을 status/body 형태로 정규화합니다.
      const lambdaResult = parseLambdaPayload(response);
      // 정규화된 결과를 그대로 JSON으로 반환합니다.
      return sendJson(res, lambdaResult.statusCode, lambdaResult.body);
    }

    // API가 아닌 요청은 정적 파일로 처리합니다.
    serveStatic(req, res);
  } catch (error) {
    // 예외 발생 시 500과 에러 메시지를 JSON으로 반환합니다.
    sendJson(res, 500, { message: error.message });
  }
});

// 웹 서버 포트는 환경 변수 우선, 기본값은 3000입니다.
const port = Number(process.env.WEB_PORT || 3000);
// 서버를 시작하고 접속 URL을 콘솔에 출력합니다.
server.listen(port, () => {
  console.log(`Web demo started: http://localhost:${port}`);
});
