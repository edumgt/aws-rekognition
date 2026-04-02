const fs = require('fs');
const path = require('path');
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/compareUploadedFacesHandler');

ensureLinuxRuntime('lambda:compare:upload:local');

handler({
  sourceImageBase64: fs.readFileSync(path.resolve(__dirname, '..', 'face1.png')).toString('base64'),
  targetImageBase64: fs.readFileSync(path.resolve(__dirname, '..', 'face2.png')).toString('base64'),
})
  .then((result) => {
    console.log(result.body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
