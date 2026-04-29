// Rekognition 클라이언트 팩토리를 불러옵니다.
const { getRekognition } = require('../src/awsClients');

// 요청 페이로드에서 액션 필드를 추출하고 유효성을 검사합니다.
function parsePayload(event) {
  const payload = typeof event.body === 'string' ? JSON.parse(event.body) : event;
  const { action, collectionId, imageBase64, faceId, externalImageId, maxFaces } = payload;
  // 모든 액션에 collectionId가 필요합니다.
  if (!collectionId) {
    throw new Error('Missing required field: collectionId');
  }
  return { action, collectionId, imageBase64, faceId, externalImageId, maxFaces };
}

// Base64 이미지를 Buffer로 변환하고 필수 입력을 검증합니다.
function decodeImage(value, fieldName) {
  if (!value) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return Buffer.from(value, 'base64');
}

// --- 개별 액션 구현 ---

// Collection을 새로 생성합니다.
async function createCollection(rekognition, collectionId) {
  const result = await rekognition
    .createCollection({ CollectionId: collectionId })
    .promise();
  return { collectionArn: result.CollectionArn, statusCode: result.StatusCode };
}

// Collection을 삭제합니다.
async function deleteCollection(rekognition, collectionId) {
  const result = await rekognition
    .deleteCollection({ CollectionId: collectionId })
    .promise();
  return { statusCode: result.StatusCode };
}

// Collection 목록을 조회합니다.
async function listCollections(rekognition) {
  const result = await rekognition.listCollections({}).promise();
  return { collectionIds: result.CollectionIds || [] };
}

// 이미지에서 얼굴을 인식하여 Collection에 등록합니다.
async function indexFace(rekognition, collectionId, imageBase64, externalImageId) {
  const imageBytes = decodeImage(imageBase64, 'imageBase64');
  const params = {
    CollectionId: collectionId,
    // 등록할 얼굴 이미지 바이너리 데이터입니다.
    Image: { Bytes: imageBytes },
    // 외부 시스템 식별자(사원번호, 이름 등)를 연결할 수 있습니다.
    ExternalImageId: externalImageId || undefined,
    // 이미지당 최대 1개 얼굴만 등록합니다(정면 사진 기준).
    MaxFaces: 1,
    // 얼굴 이미지 품질이 낮으면 건너뜁니다.
    QualityFilter: 'AUTO',
    // 얼굴 랜드마크/속성 정보도 함께 반환합니다.
    DetectionAttributes: ['DEFAULT'],
  };
  const result = await rekognition.indexFaces(params).promise();
  const indexed = (result.FaceRecords || []).map((r) => ({
    faceId: r.Face.FaceId,
    externalImageId: r.Face.ExternalImageId,
    confidence: Number((r.Face.Confidence || 0).toFixed(2)),
    boundingBox: r.Face.BoundingBox,
  }));
  return { indexed, unindexedCount: (result.UnindexedFaces || []).length };
}

// Collection에 등록된 얼굴 목록을 조회합니다.
async function listFaces(rekognition, collectionId, maxFaces) {
  const result = await rekognition
    .listFaces({ CollectionId: collectionId, MaxResults: maxFaces || 20 })
    .promise();
  const faces = (result.Faces || []).map((f) => ({
    faceId: f.FaceId,
    externalImageId: f.ExternalImageId,
    confidence: Number((f.Confidence || 0).toFixed(2)),
    boundingBox: f.BoundingBox,
  }));
  return { faces, count: faces.length };
}

// 이미지 속 얼굴을 Collection에서 검색합니다.
async function searchFace(rekognition, collectionId, imageBase64, maxFaces) {
  const imageBytes = decodeImage(imageBase64, 'imageBase64');
  const params = {
    CollectionId: collectionId,
    // 검색 기준이 되는 이미지 바이너리입니다.
    Image: { Bytes: imageBytes },
    // 반환받을 최대 매칭 후보 수입니다.
    MaxFaces: maxFaces || 5,
    // 이 임계값 이하의 유사도는 결과에서 제외합니다.
    FaceMatchThreshold: 80,
  };
  const result = await rekognition.searchFacesByImage(params).promise();
  const matches = (result.FaceMatches || []).map((m) => ({
    faceId: m.Face.FaceId,
    externalImageId: m.Face.ExternalImageId,
    similarity: Number(m.Similarity.toFixed(2)),
    confidence: Number((m.Face.Confidence || 0).toFixed(2)),
  }));
  return { matched: matches.length > 0, matches };
}

// FaceId로 특정 얼굴을 Collection에서 삭제합니다.
async function deleteFace(rekognition, collectionId, faceId) {
  if (!faceId) {
    throw new Error('Missing required field: faceId');
  }
  const result = await rekognition
    .deleteFaces({ CollectionId: collectionId, FaceIds: [faceId] })
    .promise();
  return { deletedFaceIds: result.DeletedFaces || [] };
}

// ---

// Lambda 핸들러 — action 값으로 동작을 분기합니다.
//
// 지원 action:
//   create-collection   — Collection 생성
//   delete-collection   — Collection 삭제
//   list-collections    — Collection 목록 조회
//   index-face          — 얼굴 등록 (imageBase64, externalImageId 필요)
//   list-faces          — 등록된 얼굴 목록 조회
//   search-face         — 이미지로 얼굴 검색 (imageBase64 필요)
//   delete-face         — 얼굴 삭제 (faceId 필요)
exports.handler = async (event = {}) => {
  try {
    const { action, collectionId, imageBase64, faceId, externalImageId, maxFaces } =
      parsePayload(event);
    const rekognition = getRekognition();
    let data;

    switch (action) {
      case 'create-collection':
        data = await createCollection(rekognition, collectionId);
        break;
      case 'delete-collection':
        data = await deleteCollection(rekognition, collectionId);
        break;
      case 'list-collections':
        data = await listCollections(rekognition);
        break;
      case 'index-face':
        data = await indexFace(rekognition, collectionId, imageBase64, externalImageId);
        break;
      case 'list-faces':
        data = await listFaces(rekognition, collectionId, maxFaces);
        break;
      case 'search-face':
        data = await searchFace(rekognition, collectionId, imageBase64, maxFaces);
        break;
      case 'delete-face':
        data = await deleteFace(rekognition, collectionId, faceId);
        break;
      default:
        throw new Error(
          `Unknown action: "${action}". Supported: create-collection, delete-collection, list-collections, index-face, list-faces, search-face, delete-face`
        );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ action, collectionId, ...data }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: error.message }),
    };
  }
};
