// Face Collection 기능을 로컬에서 직접 테스트하는 실행 진입점입니다.
// 사용법: npm run lambda:face-collection:local
const path = require('path');
const fs = require('fs');
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/faceCollectionHandler');

ensureLinuxRuntime('lambda:face-collection:local');

// 기본 실습용 Collection ID 입니다. 환경 변수로 재정의할 수 있습니다.
const COLLECTION_ID = process.env.COLLECTION_ID || 'rekognition-demo-collection';

// face1.png를 ExternalImageId "employee-001"로 Collection에 등록하는 예시입니다.
const face1Path = path.resolve(__dirname, '..', 'face1.png');

async function run() {
  console.log('=== [1/4] Collection 생성 ===');
  const createResult = await handler({ action: 'create-collection', collectionId: COLLECTION_ID });
  console.log(createResult.body);

  console.log('\n=== [2/4] 얼굴 등록 (IndexFaces) ===');
  // face1.png 파일이 없으면 이 단계를 건너뜁니다.
  if (fs.existsSync(face1Path)) {
    const imageBase64 = fs.readFileSync(face1Path).toString('base64');
    const indexResult = await handler({
      action: 'index-face',
      collectionId: COLLECTION_ID,
      imageBase64,
      // 외부 시스템 식별자를 자유롭게 지정할 수 있습니다(예: 사원번호).
      externalImageId: 'employee-001',
    });
    console.log(indexResult.body);
  } else {
    console.log(`face1.png not found at ${face1Path}, skipping IndexFaces.`);
  }

  console.log('\n=== [3/4] 등록된 얼굴 목록 조회 (ListFaces) ===');
  const listResult = await handler({ action: 'list-faces', collectionId: COLLECTION_ID });
  console.log(listResult.body);

  console.log('\n=== [4/4] 이미지로 얼굴 검색 (SearchFacesByImage) ===');
  if (fs.existsSync(face1Path)) {
    const imageBase64 = fs.readFileSync(face1Path).toString('base64');
    const searchResult = await handler({
      action: 'search-face',
      collectionId: COLLECTION_ID,
      imageBase64,
    });
    console.log(searchResult.body);
  } else {
    console.log(`face1.png not found at ${face1Path}, skipping SearchFacesByImage.`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
