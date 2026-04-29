// Rekognition 클라이언트 팩토리를 불러옵니다.
const { getRekognition } = require('../src/awsClients');

// 요청 페이로드를 파싱하고 필수 필드를 추출합니다.
function parsePayload(event) {
  return typeof event.body === 'string' ? JSON.parse(event.body) : event;
}

// Rekognition Custom Labels 프로젝트를 새로 생성합니다.
async function createProject(rekognition, projectName) {
  if (!projectName) throw new Error('Missing required field: projectName');
  const result = await rekognition.createProject({ ProjectName: projectName }).promise();
  return { projectArn: result.ProjectArn };
}

// S3 manifest 파일을 기반으로 Custom Labels 데이터셋을 생성합니다.
// manifestS3Uri 예시: s3://my-bucket/custom-labels/manifests/train.manifest
async function createDataset(rekognition, projectArn, datasetType, manifestS3Uri) {
  if (!projectArn) throw new Error('Missing required field: projectArn');
  if (!manifestS3Uri) throw new Error('Missing required field: manifestS3Uri');
  const type = (datasetType || 'TRAIN').toUpperCase(); // TRAIN 또는 TEST
  const result = await rekognition
    .createDataset({
      ProjectArn: projectArn,
      DatasetType: type,
      // Ground Truth 포맷 manifest 파일 위치입니다.
      DatasetSource: {
        GroundTruthManifest: {
          S3Object: {
            // manifest 파일이 저장된 S3 버킷 이름입니다.
            Bucket: manifestS3Uri.replace('s3://', '').split('/')[0],
            // manifest 파일의 S3 키(경로)입니다.
            Name: manifestS3Uri.replace('s3://', '').split('/').slice(1).join('/'),
          },
        },
      },
    })
    .promise();
  return { datasetArn: result.DatasetArn };
}

// Custom Labels 모델 학습을 시작합니다.
// outputS3Uri 예시: s3://my-bucket/custom-labels/output/
async function trainModel(rekognition, projectArn, versionName, outputS3Uri) {
  if (!projectArn) throw new Error('Missing required field: projectArn');
  if (!versionName) throw new Error('Missing required field: versionName');
  if (!outputS3Uri) throw new Error('Missing required field: outputS3Uri');
  const result = await rekognition
    .createProjectVersion({
      ProjectArn: projectArn,
      // 모델 버전 이름입니다. 프로젝트 내에서 고유해야 합니다.
      VersionName: versionName,
      // 학습 결과(모델 아티팩트)를 저장할 S3 경로입니다.
      OutputConfig: {
        S3Bucket: outputS3Uri.replace('s3://', '').split('/')[0],
        S3KeyPrefix: outputS3Uri.replace('s3://', '').split('/').slice(1).join('/'),
      },
    })
    .promise();
  return { projectVersionArn: result.ProjectVersionArn };
}

// 학습 중인 모델의 상태를 폴링합니다.
async function describeVersions(rekognition, projectArn, versionNames) {
  const params = { ProjectArn: projectArn };
  if (versionNames && versionNames.length > 0) {
    params.VersionNames = versionNames;
  }
  const result = await rekognition.describeProjectVersions(params).promise();
  const versions = (result.ProjectVersionDescriptions || []).map((v) => ({
    projectVersionArn: v.ProjectVersionArn,
    status: v.Status,
    statusMessage: v.StatusMessage,
    // 학습에 사용된 시간(초)입니다.
    billableTrainingTimeInSeconds: v.BillableTrainingTimeInSeconds,
  }));
  return { versions };
}

// 학습 완료된 모델을 배포(추론 준비)합니다.
// minInferenceUnits: 동시 요청 처리 단위(기본 1, 비용 발생 주의)
async function startModel(rekognition, projectVersionArn, minInferenceUnits) {
  if (!projectVersionArn) throw new Error('Missing required field: projectVersionArn');
  await rekognition
    .startProjectVersion({
      ProjectVersionArn: projectVersionArn,
      // 최소 추론 처리 단위입니다. 높을수록 처리량이 늘지만 비용도 증가합니다.
      MinInferenceUnits: minInferenceUnits || 1,
    })
    .promise();
  return { status: 'STARTING', projectVersionArn };
}

// 배포된 모델로 이미지를 분석합니다(커스텀 레이블 탐지).
async function detectLabels(rekognition, projectVersionArn, imageBase64, minConfidence) {
  if (!projectVersionArn) throw new Error('Missing required field: projectVersionArn');
  if (!imageBase64) throw new Error('Missing required field: imageBase64');
  const imageBytes = Buffer.from(imageBase64, 'base64');
  const result = await rekognition
    .detectCustomLabels({
      ProjectVersionArn: projectVersionArn,
      // 분석할 이미지 바이너리 데이터입니다.
      Image: { Bytes: imageBytes },
      // 이 신뢰도 미만의 레이블은 결과에서 제외합니다.
      MinConfidence: minConfidence || 50,
    })
    .promise();
  const labels = (result.CustomLabels || []).map((l) => ({
    name: l.Name,
    confidence: Number((l.Confidence || 0).toFixed(2)),
    // 객체 위치 정보가 있을 때만 포함합니다.
    geometry: l.Geometry || null,
  }));
  return { count: labels.length, labels };
}

// 배포된 모델을 중지하여 추론 과금을 종료합니다.
// 실습 후 반드시 호출해 비용 발생을 막아야 합니다.
async function stopModel(rekognition, projectVersionArn) {
  if (!projectVersionArn) throw new Error('Missing required field: projectVersionArn');
  await rekognition.stopProjectVersion({ ProjectVersionArn: projectVersionArn }).promise();
  return { status: 'STOPPING', projectVersionArn };
}

// ---

// Lambda 핸들러 — action 값으로 동작을 분기합니다.
//
// 지원 action:
//   create-project      — 프로젝트 생성 (projectName 필요)
//   create-dataset      — 데이터셋 등록 (projectArn, manifestS3Uri 필요, datasetType 선택)
//   train               — 모델 학습 시작 (projectArn, versionName, outputS3Uri 필요)
//   describe-versions   — 학습 상태 조회 (projectArn 필요, versionNames 선택)
//   start-model         — 모델 배포 (projectVersionArn 필요, minInferenceUnits 선택)
//   detect              — 커스텀 레이블 탐지 (projectVersionArn, imageBase64 필요, minConfidence 선택)
//   stop-model          — 모델 중지/비용 절감 (projectVersionArn 필요)
exports.handler = async (event = {}) => {
  try {
    const payload = parsePayload(event);
    const {
      action,
      projectName,
      projectArn,
      datasetType,
      manifestS3Uri,
      versionName,
      versionNames,
      outputS3Uri,
      projectVersionArn,
      minInferenceUnits,
      imageBase64,
      minConfidence,
    } = payload;

    const rekognition = getRekognition();
    let data;

    switch (action) {
      case 'create-project':
        data = await createProject(rekognition, projectName);
        break;
      case 'create-dataset':
        data = await createDataset(rekognition, projectArn, datasetType, manifestS3Uri);
        break;
      case 'train':
        data = await trainModel(rekognition, projectArn, versionName, outputS3Uri);
        break;
      case 'describe-versions':
        data = await describeVersions(rekognition, projectArn, versionNames);
        break;
      case 'start-model':
        data = await startModel(rekognition, projectVersionArn, minInferenceUnits);
        break;
      case 'detect':
        data = await detectLabels(rekognition, projectVersionArn, imageBase64, minConfidence);
        break;
      case 'stop-model':
        data = await stopModel(rekognition, projectVersionArn);
        break;
      default:
        throw new Error(
          `Unknown action: "${action}". Supported: create-project, create-dataset, train, describe-versions, start-model, detect, stop-model`
        );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ action, ...data }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: error.message }),
    };
  }
};