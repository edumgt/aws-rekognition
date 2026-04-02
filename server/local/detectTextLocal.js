const fs = require('fs');
const path = require('path');
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/detectTextHandler');

ensureLinuxRuntime('lambda:text:local');

handler({
  imageBase64: fs.readFileSync(path.resolve(__dirname, '..', 'sample.png')).toString('base64'),
})
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
