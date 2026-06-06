// Custom Labels 추론 Lambda 핸들러입니다.
const { predictWithCustomModel } = require('../src/customLabelsWorkflow');

// 이 핸들러는 다음 순서로 동작합니다.
// 1) 모델이 RUNNING 상태가 아니면 StartProjectVersion으로 시작합니다.
// 2) DetectCustomLabels로 S3 이미지를 분석해 라벨을 반환합니다.
// 3) 이 핸들러가 모델을 직접 시작했을 경우에만 StopProjectVersion으로 중지합니다.
//
// 이벤트 페이로드 예시:
// {
//   "projectVersionArn": "arn:aws:rekognition:ap-northeast-2:123456789:project/demo/version/v1/...",
//   "imageKey": "training/face1.png",
//   "minConfidence": 50,
//   "minUnits": 1
// }
exports.handler = async (event) => {
  const {
    projectVersionArn,
    imageKey,
    minConfidence,
    minUnits,
  } = event || {};

  // 추론 파이프라인을 실행합니다.
  const result = await predictWithCustomModel({
    projectVersionArn,
    imageKey,
    minConfidence,
    minUnits,
  });

  // Lambda 프록시 형식으로 결과를 반환합니다.
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
