// AWS SDK 모듈을 로드해 S3/Rekognition 클라이언트를 생성할 때 사용합니다.
const AWS = require('aws-sdk');
// 환경 변수 기반 설정 값을 읽어오기 위한 내부 설정 모듈입니다.
const { getAwsRegion } = require('./config');

// AWS 전역 설정을 한 번만 적용하기 위한 플래그입니다.
let initialized = false;

// AWS SDK 전역 설정(리전)을 지연 초기화합니다.
function initializeAws() {
  // 이미 초기화한 경우에는 중복 설정을 건너뜁니다.
  if (initialized) return;

  // Rekognition/S3 공통으로 필요한 AWS 리전만 먼저 검증합니다.
  const region = getAwsRegion();
  // Lambda에서는 Execution Role 기반 자격증명을 사용해야 합니다.
  // accessKeyId/secretAccessKey를 수동 주입하지 않습니다.
  // 모든 AWS 서비스 클라이언트가 공통으로 사용할 기본 리전을 등록합니다.
  AWS.config.update({ region });
  // 이후 호출부터는 재초기화를 막기 위해 true로 변경합니다.
  initialized = true;
}

// S3 업로드/다운로드에 사용할 클라이언트를 생성해 반환합니다.
function getS3() {
  // 클라이언트 생성 전에 전역 AWS 설정이 준비되었는지 보장합니다.
  initializeAws();
  // 최신 설정을 반영한 S3 인스턴스를 매번 새로 반환합니다.
  return new AWS.S3();
}

// Rekognition 분석 API 호출에 사용할 클라이언트를 생성해 반환합니다.
function getRekognition() {
  // 클라이언트 생성 전에 전역 AWS 설정이 준비되었는지 보장합니다.
  initializeAws();
  // 최신 설정을 반영한 Rekognition 인스턴스를 매번 새로 반환합니다.
  return new AWS.Rekognition();
}

// 다른 모듈에서 사용할 수 있도록 팩토리 함수를 외부로 노출합니다.
module.exports = {
  getS3,
  getRekognition,
};
