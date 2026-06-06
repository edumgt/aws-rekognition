// WSL 환경에서 trainCustomModelHandler 를 직접 실행합니다.
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/trainCustomModelHandler');

ensureLinuxRuntime('custom-labels:train:local');

handler({})
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
