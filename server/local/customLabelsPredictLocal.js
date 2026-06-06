// WSL 환경에서 detectCustomLabelsHandler 를 직접 실행합니다.
// CUSTOM_LABELS_VERSION_ARN 환경 변수에 대상 모델 ARN을 지정하세요.
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/detectCustomLabelsHandler');

ensureLinuxRuntime('custom-labels:predict:local');

handler({})
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
