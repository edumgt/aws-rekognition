// .env 파일을 자동 로딩해 로컬 실행 시에도 환경 변수를 쉽게 주입합니다.
require('dotenv').config();

// 애플리케이션이 동작하기 위해 반드시 필요한 환경 변수 목록입니다.
const REQUIRED_ENV = ['AWS_REGION', 'S3_BUCKET_NAME'];

// 실행 환경 변수를 검증하고 정규화된 설정 객체를 반환합니다.
function getConfig() {
  // 필수 변수 중 비어 있거나 누락된 항목만 추려냅니다.
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

  // 필수 환경 변수가 하나라도 없으면 즉시 에러를 발생시킵니다.
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  // 문자열 환경 변수를 실제 로직에서 쓰기 좋은 타입으로 변환해 반환합니다.
  return {
    // AWS SDK가 사용할 기본 리전 값입니다.
    region: process.env.AWS_REGION,
    // 얼굴 이미지를 업로드할 대상 S3 버킷 이름입니다.
    bucketName: process.env.S3_BUCKET_NAME,
    // Rekognition 비교 임계값을 숫자로 변환하며 기본값은 80입니다.
    similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD || 80),
    // 비교 대상 파일 목록은 쉼표 문자열을 배열로 분해해 공백/빈 값을 제거합니다.
    faceFiles: (process.env.FACE_FILES || 'face1.png,face2.png,face3.png,face4.png,face5.png,face6.png')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  };
}

// 설정 조회 함수를 외부에 노출합니다.
module.exports = {
  getConfig,
};
