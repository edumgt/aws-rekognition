// AWS 클라이언트 팩토리(Rekognition)를 불러옵니다.
const { getRekognition } = require('./awsClients');
// 공통 설정(버킷명, 리전)을 불러옵니다.
const { getConfig } = require('./config');

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

// 지정한 밀리초만큼 비동기 대기합니다.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 프로젝트 생성 ────────────────────────────────────────────────────────

// Rekognition Custom Labels 프로젝트를 생성합니다.
// 동일 이름의 프로젝트가 이미 존재하면 해당 ARN을 재사용합니다.
async function createProject(rekognition, projectName) {
  // 기존 프로젝트 목록을 조회해 중복 생성을 방지합니다.
  const { ProjectDescriptions } = await rekognition
    .describeProjects({ ProjectNames: [projectName] })
    .promise();

  if (ProjectDescriptions && ProjectDescriptions.length > 0) {
    const arn = ProjectDescriptions[0].ProjectArn;
    console.log(`[custom-labels] 프로젝트 이미 존재: ${arn}`);
    return arn;
  }

  // 새 프로젝트를 생성하고 ARN을 반환합니다.
  const { ProjectArn } = await rekognition
    .createProject({ ProjectName: projectName })
    .promise();

  console.log(`[custom-labels] 프로젝트 생성: ${ProjectArn}`);
  return ProjectArn;
}

// ─── 데이터셋 생성 ────────────────────────────────────────────────────────

// S3 매니페스트 파일을 참조하는 훈련용 데이터셋을 생성합니다.
async function createDataset(rekognition, projectArn, bucketName, manifestKey) {
  const { DatasetArn } = await rekognition
    .createDataset({
      ProjectArn: projectArn,
      // TRAIN: 훈련셋, TEST: 검증셋
      DatasetType: 'TRAIN',
      DatasetSource: {
        GroundTruthManifest: {
          S3Object: {
            Bucket: bucketName,
            // 매니페스트 파일 경로 (예: custom-labels/manifest.jsonl)
            Name: manifestKey,
          },
        },
      },
    })
    .promise();

  console.log(`[custom-labels] 데이터셋 생성: ${DatasetArn}`);
  return DatasetArn;
}

// ─── 학습 시작 ────────────────────────────────────────────────────────────

// 새 프로젝트 버전(모델)의 학습을 시작합니다.
async function startTraining(rekognition, projectArn, versionName, outputBucket, outputPrefix) {
  const { ProjectVersionArn } = await rekognition
    .createProjectVersion({
      ProjectArn: projectArn,
      // 버전 식별자: 프로젝트 내에서 고유해야 합니다.
      VersionName: versionName,
      // 학습 결과(평가 지표 등)가 저장될 S3 경로입니다.
      OutputConfig: {
        S3Bucket: outputBucket,
        S3KeyPrefix: outputPrefix,
      },
    })
    .promise();

  console.log(`[custom-labels] 학습 시작: ${ProjectVersionArn}`);
  return ProjectVersionArn;
}

// ─── 상태 폴링 ────────────────────────────────────────────────────────────

// 프로젝트 버전의 상태가 목표 상태 중 하나가 될 때까지 폴링합니다.
async function pollVersionStatus(rekognition, projectArn, versionName, targetStatuses, intervalMs, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const { ProjectVersionDescriptions } = await rekognition
      .describeProjectVersions({
        ProjectArn: projectArn,
        VersionNames: [versionName],
      })
      .promise();

    const version = ProjectVersionDescriptions && ProjectVersionDescriptions[0];
    const status = version ? version.Status : 'UNKNOWN';
    console.log(`[custom-labels] 상태 확인 (${attempt}/${maxRetries}): ${status}`);

    if (targetStatuses.includes(status)) {
      return { status, version };
    }

    // 실패 상태이면 즉시 중단합니다.
    if (['FAILED', 'DELETING'].includes(status)) {
      throw new Error(`[custom-labels] 버전 상태 오류: ${status} — ${version && version.StatusMessage}`);
    }

    await sleep(intervalMs);
  }

  throw new Error(`[custom-labels] 상태 폴링 타임아웃 (최대 ${maxRetries}회 시도)`);
}

// ─── 모델 배포(시작) ──────────────────────────────────────────────────────

// 학습된 모델 버전을 추론 요청을 받을 수 있도록 시작합니다.
async function startModel(rekognition, projectVersionArn, minUnits) {
  await rekognition
    .startProjectVersion({
      ProjectVersionArn: projectVersionArn,
      // 최소 추론 처리 단위 수 (1 = 가장 작은 단위)
      MinInferenceUnits: minUnits,
    })
    .promise();

  console.log(`[custom-labels] 모델 시작 요청 완료: ${projectVersionArn}`);
}

// ─── 모델 중지 ────────────────────────────────────────────────────────────

// 실행 중인 모델을 중지해 불필요한 과금을 방지합니다.
async function stopModel(rekognition, projectVersionArn) {
  await rekognition
    .stopProjectVersion({ ProjectVersionArn: projectVersionArn })
    .promise();

  console.log(`[custom-labels] 모델 중지 요청 완료: ${projectVersionArn}`);
}

// ─── 추론 실행 ────────────────────────────────────────────────────────────

// S3에 저장된 이미지에 대해 커스텀 라벨 추론을 실행합니다.
async function detectCustomLabels(rekognition, projectVersionArn, bucketName, imageKey, minConfidence) {
  const response = await rekognition
    .detectCustomLabels({
      ProjectVersionArn: projectVersionArn,
      Image: {
        S3Object: {
          Bucket: bucketName,
          Name: imageKey,
        },
      },
      // 이 값 이상의 신뢰도를 가진 라벨만 반환합니다.
      MinConfidence: minConfidence,
    })
    .promise();

  return response.CustomLabels || [];
}

// ─── 공개 워크플로 함수 ───────────────────────────────────────────────────

// 프로젝트 생성 → 데이터셋 등록 → 학습 시작까지의 파이프라인을 실행합니다.
async function trainCustomModel(options) {
  const { bucketName } = getConfig();
  const rekognition = getRekognition();

  const projectName = options.projectName || process.env.CUSTOM_LABELS_PROJECT || 'rekognition-custom-labels-demo';
  const versionName = options.versionName || process.env.CUSTOM_LABELS_VERSION || `v${Date.now()}`;
  const manifestKey = options.manifestKey || process.env.CUSTOM_LABELS_MANIFEST_KEY || 'custom-labels/manifest.jsonl';
  const outputPrefix = options.outputPrefix || process.env.CUSTOM_LABELS_OUTPUT_PREFIX || 'custom-labels/output/';

  // 1) 프로젝트 생성 또는 기존 ARN 조회
  const projectArn = await createProject(rekognition, projectName);

  // 2) 훈련 데이터셋 등록
  const datasetArn = await createDataset(rekognition, projectArn, bucketName, manifestKey);

  // 3) 학습 시작
  const projectVersionArn = await startTraining(
    rekognition,
    projectArn,
    versionName,
    bucketName,
    outputPrefix,
  );

  return {
    projectName,
    projectArn,
    datasetArn,
    projectVersionArn,
    versionName,
    message: '학습이 시작되었습니다. 완료까지 30분~수 시간이 소요될 수 있습니다.',
  };
}

// 모델 시작 → 추론 → 모델 중지까지의 파이프라인을 실행합니다.
async function predictWithCustomModel(options) {
  const { bucketName } = getConfig();
  const rekognition = getRekognition();

  const projectVersionArn = options.projectVersionArn || process.env.CUSTOM_LABELS_VERSION_ARN;
  const imageKey = options.imageKey || process.env.CUSTOM_LABELS_IMAGE_KEY || 'training/face1.png';
  const minConfidence = Number(options.minConfidence || process.env.CUSTOM_LABELS_MIN_CONFIDENCE || 50);
  const minUnits = Number(options.minUnits || process.env.CUSTOM_LABELS_MIN_UNITS || 1);

  // projectVersionArn은 필수입니다.
  if (!projectVersionArn) {
    throw new Error(
      'projectVersionArn 또는 CUSTOM_LABELS_VERSION_ARN 환경 변수가 필요합니다.',
    );
  }

  // DescribeProjectVersions 에서 ProjectArn, VersionName 을 추출합니다.
  // ARN 형식: arn:aws:rekognition:<region>:<account>:project/<name>/version/<version>/<timestamp>
  const arnParts = projectVersionArn.split('/');
  const projectName = arnParts[1];
  const versionName = arnParts[3];

  const { ProjectVersionDescriptions } = await rekognition
    .describeProjectVersions({
      ProjectArn: projectVersionArn.replace(/\/version\/.*/, ''),
      VersionNames: [versionName],
    })
    .promise();

  const version = ProjectVersionDescriptions && ProjectVersionDescriptions[0];
  const currentStatus = version ? version.Status : 'UNKNOWN';

  let needsStop = false;

  // 1) 모델이 RUNNING 상태가 아니면 시작합니다.
  if (currentStatus !== 'RUNNING') {
    if (!['TRAINING_COMPLETED', 'STOPPED'].includes(currentStatus)) {
      throw new Error(
        `모델을 시작할 수 없는 상태입니다: ${currentStatus}. 학습 완료(TRAINING_COMPLETED) 또는 중지(STOPPED) 상태에서만 시작 가능합니다.`,
      );
    }
    await startModel(rekognition, projectVersionArn, minUnits);

    // RUNNING 상태가 될 때까지 폴링합니다.
    await pollVersionStatus(
      rekognition,
      projectVersionArn.replace(/\/version\/.*/, ''),
      versionName,
      ['RUNNING'],
      15000, // 15초 간격
      20,    // 최대 20회 (최대 5분)
    );
    needsStop = true;
  }

  // 2) 추론 실행
  const labels = await detectCustomLabels(
    rekognition,
    projectVersionArn,
    bucketName,
    imageKey,
    minConfidence,
  );

  console.log(`[custom-labels] 감지된 라벨 수: ${labels.length}`);
  labels.forEach((l) => {
    console.log(`  - ${l.Name}: ${l.Confidence.toFixed(2)}%`);
  });

  // 3) 이 워크플로에서 모델을 시작했다면 중지합니다(비용 절감).
  if (needsStop) {
    await stopModel(rekognition, projectVersionArn);
  }

  return {
    projectName,
    versionName,
    imageKey,
    labelCount: labels.length,
    labels,
  };
}

// 외부 모듈에서 사용할 수 있도록 노출합니다.
module.exports = {
  trainCustomModel,
  predictWithCustomModel,
  // 세부 헬퍼도 노출해 Lambda 핸들러에서 직접 조합 가능합니다.
  createProject,
  startTraining,
  pollVersionStatus,
  startModel,
  stopModel,
  detectCustomLabels,
};
