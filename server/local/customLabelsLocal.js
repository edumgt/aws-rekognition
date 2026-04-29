// Custom Labels 워크플로를 로컬에서 단계별로 테스트하는 실행 진입점입니다.
// 사용법: npm run lambda:custom-labels:local
//
// ⚠️  비용 경고: 모델 학습(train)은 최소 수십 달러의 비용이 발생합니다.
//               실습 후 반드시 stop-model을 호출해 추론 과금을 종료하세요.
const { ensureLinuxRuntime } = require('../src/runtimeGuard');
const { handler } = require('../lambda/customLabelsHandler');

ensureLinuxRuntime('lambda:custom-labels:local');

// 환경 변수로 재정의 가능한 기본 설정입니다.
const PROJECT_NAME = process.env.CUSTOM_LABELS_PROJECT || 'rekognition-custom-labels-demo';
const BUCKET = process.env.S3_BUCKET_NAME || 'polly-bucket-edumgt';
const VERSION_NAME = `v${Date.now()}`;
const MANIFEST_S3_URI = `s3://${BUCKET}/custom-labels/manifests/train.manifest`;
const OUTPUT_S3_URI = `s3://${BUCKET}/custom-labels/output/`;

async function run() {
  console.log('=== [1/3] Custom Labels 프로젝트 생성 ===');
  const createResult = await handler({ action: 'create-project', projectName: PROJECT_NAME });
  const createBody = JSON.parse(createResult.body);
  console.log(JSON.stringify(createBody, null, 2));

  if (createResult.statusCode !== 200) {
    console.error('프로젝트 생성 실패. 종료합니다.');
    process.exit(1);
  }

  const projectArn = createBody.projectArn;

  console.log('\n=== [2/3] 학습 상태 조회 예시 ===');
  console.log('학습은 비용이 발생하므로 이 로컬 스크립트에서는 train을 자동 실행하지 않습니다.');
  console.log('아래 명령을 직접 실행하거나 scripts/aws_batch_ops.sh custom-labels-train 을 사용하세요:');
  console.log('');
  console.log('  Lambda 호출로 학습 시작:');
  console.log(`    action: "train"`);
  console.log(`    projectArn: "${projectArn}"`);
  console.log(`    versionName: "${VERSION_NAME}"`);
  console.log(`    outputS3Uri: "${OUTPUT_S3_URI}"`);
  console.log('');
  console.log('  manifest 등록 후 학습 시작 → 수 시간 소요 → DescribeProjectVersions 로 상태 확인');

  console.log('\n=== [3/3] 버전 상태 조회 (학습 진행 상황 확인) ===');
  const descResult = await handler({ action: 'describe-versions', projectArn });
  console.log(descResult.body);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});