// 얼굴 비교 워크플로 함수를 가져옵니다.
const { ensureLinuxRuntime } = require('./src/runtimeGuard');
const { compareFaces } = require('./src/faceWorkflow');

// Windows Node.js로 직접 실행되는 실수를 빠르게 차단합니다.
ensureLinuxRuntime('compare');

// CLI 실행 진입점입니다.
async function main() {
  // 현재 server 디렉터리의 얼굴 파일들을 대상으로 비교합니다.
  const result = await compareFaces({ baseDir: __dirname });

  // 전체 비교 건수를 먼저 요약 출력합니다.
  console.log(`총 비교 건수: ${result.comparedCount}`);

  // 각 비교 결과를 사람이 읽기 좋은 한 줄 포맷으로 출력합니다.
  result.comparisons.forEach((item) => {
    const status = item.matched ? '✅ 매칭' : '❌ 비매칭';
    console.log(`${status} | ${item.source} vs ${item.target} | 유사도 ${item.similarity}%`);
  });

  // 입력 목록 중 실제 파일이 없어 제외된 항목을 경고로 출력합니다.
  result.missing.forEach((name) => {
    console.log(`⚠️ 파일 없음(비교 제외): ${name}`);
  });
}

// 예외가 발생하면 메시지를 출력하고 비정상 종료 코드(1)를 반환합니다.
main().catch((error) => {
  console.error('❌ 얼굴 비교 실패:', error.message);
  process.exit(1);
});
