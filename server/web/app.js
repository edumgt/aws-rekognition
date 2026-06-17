const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler: compareUploadedFacesHandler } = require('../lambda/compareUploadedFacesHandler');
const { handler: detectTextHandler } = require('../lambda/detectTextHandler');

ensureLinuxRuntime('web');

const publicDir = path.resolve(__dirname, 'public');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('요청 JSON 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

// Local handler execution (existing behavior)
async function runLocalHandler(handler, body) {
  const response = await handler({ body: JSON.stringify(body) });
  const payload = typeof response?.body === 'string' ? JSON.parse(response.body) : response?.body || {};
  return {
    statusCode: Number(response?.statusCode || 200),
    body: payload,
  };
}

// AWS Lambda SDK invocation
async function runLambdaHandler(functionName, region, body) {
  // Lazy-require AWS so the server still starts without AWS SDK when using local mode
  let AWS;
  try {
    AWS = require('aws-sdk');
  } catch (_) {
    throw new Error('aws-sdk 패키지가 설치되어 있지 않습니다. npm install aws-sdk 후 재시작하세요.');
  }

  if (!region) {
    throw new Error('AWS 리전이 설정되지 않았습니다. 설정 패널에서 AWS 리전을 입력하거나 서버에 AWS_REGION 환경변수를 설정하세요.');
  }

  const lambda = new AWS.Lambda({ region });

  const invokeParams = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    // Wrap as API Gateway proxy event so Lambda handlers work unchanged
    Payload: JSON.stringify({ body: JSON.stringify(body) }),
  };

  const invokeResult = await lambda.invoke(invokeParams).promise();

  if (invokeResult.FunctionError) {
    const errPayload = JSON.parse(invokeResult.Payload || '{}');
    throw new Error(`Lambda 실행 오류: ${errPayload.errorMessage || invokeResult.FunctionError}`);
  }

  const lambdaResponse = JSON.parse(invokeResult.Payload || '{}');
  const responseBody =
    typeof lambdaResponse.body === 'string'
      ? JSON.parse(lambdaResponse.body)
      : lambdaResponse.body || {};

  return {
    statusCode: Number(lambdaResponse.statusCode || 200),
    body: responseBody,
  };
}

// Route a request to either local handler or Lambda depending on _mode field
async function dispatch(localHandler, lambdaFnKey, body) {
  const mode = body._mode || 'local';
  // Strip internal routing fields before forwarding to handlers
  const { _mode, _awsRegion, _lambdaCompareFn, _lambdaTextFn, ...forwardBody } = body;

  // Inject AWS_REGION from the request when the env var is absent.
  // awsClients.js reads process.env.AWS_REGION lazily on first use,
  // so setting it here before any handler call is sufficient.
  const region = process.env.AWS_REGION || _awsRegion || '';
  if (_awsRegion && !process.env.AWS_REGION) {
    process.env.AWS_REGION = _awsRegion;
  }

  if (!region) {
    throw new Error(
      'AWS 리전이 설정되지 않았습니다. ' +
      '설정 패널(⚙)에서 AWS 리전(예: ap-northeast-2)을 입력하거나 ' +
      '서버에 AWS_REGION 환경변수를 설정하세요.',
    );
  }

  if (mode === 'lambda') {
    const functionName = body[lambdaFnKey];
    if (!functionName) {
      throw new Error(`Lambda 함수 이름이 비어 있습니다. 설정 패널에서 함수 이름을 입력하세요.`);
    }
    return runLambdaHandler(functionName, region, forwardBody);
  }

  return runLocalHandler(localHandler, forwardBody);
}

function getAccessibleIpv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      candidates.push({ name, address: entry.address, cidr: entry.cidr });
    }
  }
  return candidates.find((e) => e.name === 'eth0') || candidates[0] || null;
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.resolve(publicDir, `.${requestPath}`);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
  };

  res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/compare') {
      const body = await parseRequestBody(req);
      if (!body.sourceImageBase64 || !body.targetImageBase64) {
        return sendJson(res, 400, { message: 'sourceImageBase64, targetImageBase64 값이 필요합니다.' });
      }
      const apiResult = await dispatch(
        compareUploadedFacesHandler,
        '_lambdaCompareFn',
        body,
      );
      return sendJson(res, apiResult.statusCode, apiResult.body);
    }

    if (req.method === 'POST' && req.url === '/api/extract-text') {
      const body = await parseRequestBody(req);
      if (!body.imageBase64) {
        return sendJson(res, 400, { message: 'imageBase64 값이 필요합니다.' });
      }
      const apiResult = await dispatch(
        detectTextHandler,
        '_lambdaTextFn',
        body,
      );
      return sendJson(res, apiResult.statusCode, apiResult.body);
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
});

const host = process.env.WEB_HOST || '0.0.0.0';
const port = Number(process.env.WEB_PORT || 3000);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing process or run with WEB_PORT=<other-port>.`);
    process.exit(1);
  }
  console.error(error.message);
  process.exit(1);
});

server.listen(port, host, () => {
  const browserHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Web demo + Node BE API started: http://${browserHost}:${port} (bind ${host}:${port})`);
  const accessibleIpv4 = getAccessibleIpv4();
  if (accessibleIpv4) {
    console.log(`WSL IPv4: ${accessibleIpv4.cidr}`);
    console.log(`Open from Windows browser via WSL virtual IP: http://${accessibleIpv4.address}:${port}`);
  }
});
