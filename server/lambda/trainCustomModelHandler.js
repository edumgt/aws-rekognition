// Custom Labels 학습 시작 Lambda 핸들러입니다.
const { trainCustomModel } = require('../src/customLabelsWorkflow');

// 이 핸들러는 다음 순서로 동작합니다.
// 1) Rekognition Custom Labels 프로젝트 생성 (이미 존재하면 재사용)
// 2) S3 매니페스트를 참조하는 훈련 데이터셋 등록
// 3) 새 프로젝트 버전(모델) 학습 시작 → ARN 즉시 반환
//
// 학습 완료 여부는 DescribeProjectVersions 폴링 또는
// EventBridge(Rekognition 학습 완료 이벤트)로 별도 확인해야 합니다.
exports.handler = async (event) => {
  // 이벤트 페이로드에서 파라미터를 읽습니다(모두 선택 사항).
  const {
    projectName,
    versionName,
    manifestKey,
    outputPrefix,
  } = event || {};

  // 학습 파이프라인을 실행합니다.
  const result = await trainCustomModel({
    projectName,
    versionName,
    manifestKey,
    outputPrefix,
  });

  // Lambda 프록시 형식으로 결과를 반환합니다.
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
