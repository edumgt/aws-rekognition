const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/uploadFacesHandler');

ensureLinuxRuntime('lambda:upload:local');

handler()
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
