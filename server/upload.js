// 실행 위치 기준 경로 처리를 위해 path 모듈을 가져옵니다.
const path = require('path');
// Linux/WSL 런타임에서만 직접 실행되도록 보호합니다.
const { ensureLinuxRuntime } = require('./src/runtimeGuard');
// 얼굴 업로드 워크플로 함수를 가져옵니다.
const { uploadFaces } = require('./src/faceWorkflow');

// Windows Node.js로 직접 실행되는 실수를 빠르게 차단합니다.
ensureLinuxRuntime('upload');

// CLI 실행 진입점 함수입니다.
async function main() {
  // 현재 server 디렉터리를 기준으로 업로드를 수행합니다.
  const result = await uploadFaces({ baseDir: __dirname });

  // 업로드 성공한 객체 키를 사용자에게 출력합니다.
  result.uploaded.forEach((key) => {
    console.log(`✅ 업로드 성공: ${key}`);
  });

  // 로컬에서 찾지 못해 건너뛴 파일 목록을 경고로 출력합니다.
  result.skipped.forEach((name) => {
    console.log(`⚠️ 파일 없음(건너뜀): ${name}`);
  });
}

// 비동기 실행 실패 시 에러 메시지와 종료 코드를 명시합니다.
main().catch((error) => {
  console.error('❌ 업로드 작업 실패:', error.message);
  process.exit(1);
});
