const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/compareFacesHandler');

ensureLinuxRuntime('lambda:compare:local');

handler()
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
