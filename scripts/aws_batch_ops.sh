#!/usr/bin/env bash
set -euo pipefail

BUCKET_NAME="${S3_BUCKET_NAME:-polly-bucket-edumgt}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PROFILE_OPT="${AWS_PROFILE:+--profile ${AWS_PROFILE}}"
WORK_DIR="${WORK_DIR:-./batch-work}"
UPLOAD_DIR="${UPLOAD_DIR:-./server}"
REPORT_FILE="${REPORT_FILE:-${WORK_DIR}/batch-report-$(date +%Y%m%d-%H%M%S).txt}"
LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-nodejs18.x}"
LAMBDA_ROLE_ARN="${LAMBDA_ROLE_ARN:-}"
LAMBDA_UPLOAD_FUNCTION="${LAMBDA_UPLOAD_FUNCTION:-rekognition-face-upload}"
LAMBDA_COMPARE_FUNCTION="${LAMBDA_COMPARE_FUNCTION:-rekognition-face-compare}"
LAMBDA_COMPARE_UPLOAD_FUNCTION="${LAMBDA_COMPARE_UPLOAD_FUNCTION:-rekognition-face-compare-upload}"
LAMBDA_TEXT_FUNCTION="${LAMBDA_TEXT_FUNCTION:-rekognition-text-detect}"
LAMBDA_CUSTOM_TRAIN_FUNCTION="${LAMBDA_CUSTOM_TRAIN_FUNCTION:-rekognition-custom-labels-train}"
LAMBDA_CUSTOM_PREDICT_FUNCTION="${LAMBDA_CUSTOM_PREDICT_FUNCTION:-rekognition-custom-labels-predict}"
CUSTOM_LABELS_PROJECT="${CUSTOM_LABELS_PROJECT:-rekognition-custom-labels-demo}"
CUSTOM_LABELS_MANIFEST_KEY="${CUSTOM_LABELS_MANIFEST_KEY:-custom-labels/manifest.jsonl}"
CUSTOM_LABELS_OUTPUT_PREFIX="${CUSTOM_LABELS_OUTPUT_PREFIX:-custom-labels/output/}"
CUSTOM_LABELS_VERSION_ARN="${CUSTOM_LABELS_VERSION_ARN:-}"
CUSTOM_LABELS_IMAGE_KEY="${CUSTOM_LABELS_IMAGE_KEY:-training/face1.png}"
LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-30}"
LAMBDA_MEMORY_SIZE="${LAMBDA_MEMORY_SIZE:-256}"

mkdir -p "${WORK_DIR}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

run_aws() {
  # shellcheck disable=SC2086
  aws $PROFILE_OPT --region "${AWS_REGION}" "$@"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") <command>

Commands:
  init                 Create bucket(if absent), enable default encryption, and apply lifecycle
  upload               Upload sample assets to s3://${BUCKET_NAME}/training/
  sync                 Sync local images (*.png, *.jpg, *.jpeg) to s3://${BUCKET_NAME}/training/
  list                 List objects under training/
  report               Save bucket inventory report to ${REPORT_FILE}
  cleanup              Delete objects under training/ (safe cleanup)
  lambda-package       Package Lambda sources into batch-work/*.zip
  lambda-deploy        Create/update Lambda functions for upload+compare+web handlers
  lambda-invoke        Invoke upload and compare Lambda sequentially
  custom-labels-train  Package+deploy Custom Labels train Lambda and start model training
  custom-labels-predict  Invoke Custom Labels predict Lambda (requires CUSTOM_LABELS_VERSION_ARN)
  lab-all              Run init -> upload -> lambda-deploy -> lambda-invoke -> report

Environment variables:
  AWS_PROFILE          Optional AWS profile name
  AWS_REGION           Region (default: ap-northeast-2)
  S3_BUCKET_NAME       Bucket name (default: polly-bucket-edumgt)
  UPLOAD_DIR           Local source dir containing sample images (default: ./server)
  WORK_DIR             Working directory (default: ./batch-work)
  LAMBDA_ROLE_ARN      Required for lambda-deploy (IAM role for Lambda)
  LAMBDA_UPLOAD_FUNCTION   Upload Lambda function name
  LAMBDA_COMPARE_FUNCTION  Compare Lambda function name
  LAMBDA_COMPARE_UPLOAD_FUNCTION  Upload-file compare Lambda function name
  LAMBDA_TEXT_FUNCTION  DetectText Lambda function name
  LAMBDA_CUSTOM_TRAIN_FUNCTION   Custom Labels training Lambda function name
  LAMBDA_CUSTOM_PREDICT_FUNCTION Custom Labels predict Lambda function name
  CUSTOM_LABELS_PROJECT        Custom Labels project name
  CUSTOM_LABELS_MANIFEST_KEY   S3 key for the training manifest file
  CUSTOM_LABELS_OUTPUT_PREFIX  S3 prefix for training output
  CUSTOM_LABELS_VERSION_ARN    Project version ARN (required for custom-labels-predict)
  CUSTOM_LABELS_IMAGE_KEY      S3 key of the image to analyse (custom-labels-predict)
USAGE
}

create_lifecycle_json() {
  cat > "${WORK_DIR}/lifecycle.json" <<JSON
{
  "Rules": [
    {
      "ID": "ExpireTrainingObjects",
      "Filter": {"Prefix": "training/"},
      "Status": "Enabled",
      "Expiration": {"Days": 30},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }
  ]
}
JSON
}

init_bucket() {
  log "Checking caller identity"
  run_aws sts get-caller-identity >/dev/null

  if run_aws s3api head-bucket --bucket "${BUCKET_NAME}" >/dev/null 2>&1; then
    log "Bucket already exists: ${BUCKET_NAME}"
  else
    log "Creating bucket: ${BUCKET_NAME} (${AWS_REGION})"
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
      run_aws s3api create-bucket --bucket "${BUCKET_NAME}"
    else
      run_aws s3api create-bucket --bucket "${BUCKET_NAME}" \
        --create-bucket-configuration "LocationConstraint=${AWS_REGION}"
    fi
  fi

  log "Applying default bucket encryption"
  run_aws s3api put-bucket-encryption \
    --bucket "${BUCKET_NAME}" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

  create_lifecycle_json
  log "Applying lifecycle policy"
  run_aws s3api put-bucket-lifecycle-configuration \
    --bucket "${BUCKET_NAME}" \
    --lifecycle-configuration "file://${WORK_DIR}/lifecycle.json"

  log "Init completed"
}

upload_samples() {
  log "Uploading known sample assets from ${UPLOAD_DIR}"
  for f in sample.png face1.png face2.png face3.png face4.png; do
    if [[ -f "${UPLOAD_DIR}/${f}" ]]; then
      run_aws s3 cp "${UPLOAD_DIR}/${f}" "s3://${BUCKET_NAME}/training/${f}"
    else
      log "Skip missing file: ${UPLOAD_DIR}/${f}"
    fi
  done
}

sync_images() {
  log "Syncing image files from ${UPLOAD_DIR} to s3://${BUCKET_NAME}/training/"
  run_aws s3 sync "${UPLOAD_DIR}" "s3://${BUCKET_NAME}/training/" \
    --exclude "*" --include "*.png" --include "*.jpg" --include "*.jpeg"
}

list_objects() {
  run_aws s3 ls "s3://${BUCKET_NAME}/training/" --recursive
}

create_report() {
  {
    echo "# Batch Report"
    echo "Generated: $(date -Iseconds)"
    echo "Bucket: ${BUCKET_NAME}"
    echo "Region: ${AWS_REGION}"
    echo
    echo "## Caller Identity"
    run_aws sts get-caller-identity
    echo
    echo "## Bucket Location"
    run_aws s3api get-bucket-location --bucket "${BUCKET_NAME}"
    echo
    echo "## Object List (training/)"
    run_aws s3 ls "s3://${BUCKET_NAME}/training/" --recursive || true
  } >"${REPORT_FILE}"

  log "Report generated at ${REPORT_FILE}"
}

cleanup_objects() {
  log "Removing objects in s3://${BUCKET_NAME}/training/"
  run_aws s3 rm "s3://${BUCKET_NAME}/training/" --recursive
}

package_lambda() {
  local upload_zip="${WORK_DIR}/lambda-upload.zip"
  local compare_zip="${WORK_DIR}/lambda-compare.zip"
  local compare_upload_zip="${WORK_DIR}/lambda-compare-upload.zip"
  local text_zip="${WORK_DIR}/lambda-text.zip"
  local custom_train_zip="${WORK_DIR}/lambda-custom-train.zip"
  local custom_predict_zip="${WORK_DIR}/lambda-custom-predict.zip"

  log "Packaging Lambda source files"
  (
    cd server
    zip -qr "../${upload_zip}" lambda/uploadFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${compare_zip}" lambda/compareFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${compare_upload_zip}" lambda/compareUploadedFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${text_zip}" lambda/detectTextHandler.js src node_modules package.json package-lock.json
    zip -qr "../${custom_train_zip}" lambda/trainCustomModelHandler.js src node_modules package.json package-lock.json
    zip -qr "../${custom_predict_zip}" lambda/detectCustomLabelsHandler.js src node_modules package.json package-lock.json
  )

  log "Packaged: ${upload_zip}, ${compare_zip}, ${compare_upload_zip}, ${text_zip}, ${custom_train_zip}, ${custom_predict_zip}"
}

upsert_lambda() {
  local function_name="$1"
  local handler="$2"
  local zip_file="$3"

  if run_aws lambda get-function --function-name "${function_name}" >/dev/null 2>&1; then
    log "Updating code for Lambda: ${function_name}"
    run_aws lambda update-function-code \
      --function-name "${function_name}" \
      --zip-file "fileb://${zip_file}" >/dev/null

    run_aws lambda update-function-configuration \
      --function-name "${function_name}" \
      --handler "${handler}" \
      --runtime "${LAMBDA_RUNTIME}" \
      --timeout "${LAMBDA_TIMEOUT}" \
      --memory-size "${LAMBDA_MEMORY_SIZE}" \
      --environment "Variables={S3_BUCKET_NAME=${BUCKET_NAME}}" >/dev/null
  else
    if [[ -z "${LAMBDA_ROLE_ARN}" ]]; then
      echo "LAMBDA_ROLE_ARN is required to create a new Lambda function." >&2
      exit 1
    fi

    log "Creating Lambda: ${function_name}"
    run_aws lambda create-function \
      --function-name "${function_name}" \
      --runtime "${LAMBDA_RUNTIME}" \
      --role "${LAMBDA_ROLE_ARN}" \
      --handler "${handler}" \
      --timeout "${LAMBDA_TIMEOUT}" \
      --memory-size "${LAMBDA_MEMORY_SIZE}" \
      --zip-file "fileb://${zip_file}" \
      --environment "Variables={S3_BUCKET_NAME=${BUCKET_NAME}}" >/dev/null
  fi
}

deploy_lambda() {
  package_lambda

  upsert_lambda "${LAMBDA_UPLOAD_FUNCTION}" "lambda/uploadFacesHandler.handler" "${WORK_DIR}/lambda-upload.zip"
  upsert_lambda "${LAMBDA_COMPARE_FUNCTION}" "lambda/compareFacesHandler.handler" "${WORK_DIR}/lambda-compare.zip"
  upsert_lambda "${LAMBDA_COMPARE_UPLOAD_FUNCTION}" "lambda/compareUploadedFacesHandler.handler" "${WORK_DIR}/lambda-compare-upload.zip"
  upsert_lambda "${LAMBDA_TEXT_FUNCTION}" "lambda/detectTextHandler.handler" "${WORK_DIR}/lambda-text.zip"

  log "Lambda deploy completed"
}

invoke_lambda() {
  log "Invoking Lambda: ${LAMBDA_UPLOAD_FUNCTION}"
  run_aws lambda invoke \
    --function-name "${LAMBDA_UPLOAD_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload '{}' "${WORK_DIR}/upload-result.json" >/dev/null

  log "Invoking Lambda: ${LAMBDA_COMPARE_FUNCTION}"
  run_aws lambda invoke \
    --function-name "${LAMBDA_COMPARE_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload '{}' "${WORK_DIR}/compare-result.json" >/dev/null

  log "Lambda invoke outputs: ${WORK_DIR}/upload-result.json, ${WORK_DIR}/compare-result.json"
}

run_lab_all() {
  init_bucket
  upload_samples
  deploy_lambda
  invoke_lambda
  create_report
}

# ── Custom Labels 학습 ────────────────────────────────────────────────────────
# 1) 매니페스트 파일을 S3에 업로드합니다.
# 2) Custom Labels 학습 Lambda를 패키징/배포합니다.
# 3) 학습 Lambda를 호출해 프로젝트 생성 → 데이터셋 등록 → 학습 시작합니다.
#    (학습 완료에는 30분~수 시간이 소요됩니다)
custom_labels_train() {
  local manifest_src="server/training/custom-labels-manifest.jsonl"
  local train_zip="${WORK_DIR}/lambda-custom-train.zip"

  # 매니페스트 파일을 S3에 업로드합니다.
  if [[ -f "${manifest_src}" ]]; then
    log "Uploading Custom Labels manifest to s3://${BUCKET_NAME}/${CUSTOM_LABELS_MANIFEST_KEY}"
    run_aws s3 cp "${manifest_src}" "s3://${BUCKET_NAME}/${CUSTOM_LABELS_MANIFEST_KEY}"
  else
    log "Warning: ${manifest_src} not found — skipping manifest upload"
  fi

  # Lambda 패키징 후 배포합니다.
  log "Packaging Custom Labels train Lambda"
  (
    cd server
    zip -qr "../${train_zip}" lambda/trainCustomModelHandler.js src node_modules package.json package-lock.json
  )

  local env_vars="Variables={S3_BUCKET_NAME=${BUCKET_NAME},CUSTOM_LABELS_PROJECT=${CUSTOM_LABELS_PROJECT},CUSTOM_LABELS_MANIFEST_KEY=${CUSTOM_LABELS_MANIFEST_KEY},CUSTOM_LABELS_OUTPUT_PREFIX=${CUSTOM_LABELS_OUTPUT_PREFIX}}"
  if run_aws lambda get-function --function-name "${LAMBDA_CUSTOM_TRAIN_FUNCTION}" >/dev/null 2>&1; then
    log "Updating Custom Labels train Lambda: ${LAMBDA_CUSTOM_TRAIN_FUNCTION}"
    run_aws lambda update-function-code \
      --function-name "${LAMBDA_CUSTOM_TRAIN_FUNCTION}" \
      --zip-file "fileb://${train_zip}" >/dev/null
    run_aws lambda update-function-configuration \
      --function-name "${LAMBDA_CUSTOM_TRAIN_FUNCTION}" \
      --handler "lambda/trainCustomModelHandler.handler" \
      --runtime "${LAMBDA_RUNTIME}" \
      --timeout 60 \
      --memory-size 256 \
      --environment "${env_vars}" >/dev/null
  else
    if [[ -z "${LAMBDA_ROLE_ARN}" ]]; then
      echo "LAMBDA_ROLE_ARN is required to create a new Lambda function." >&2
      exit 1
    fi
    log "Creating Custom Labels train Lambda: ${LAMBDA_CUSTOM_TRAIN_FUNCTION}"
    run_aws lambda create-function \
      --function-name "${LAMBDA_CUSTOM_TRAIN_FUNCTION}" \
      --runtime "${LAMBDA_RUNTIME}" \
      --role "${LAMBDA_ROLE_ARN}" \
      --handler "lambda/trainCustomModelHandler.handler" \
      --timeout 60 \
      --memory-size 256 \
      --zip-file "fileb://${train_zip}" \
      --environment "${env_vars}" >/dev/null
  fi

  # 학습 Lambda를 호출합니다.
  log "Invoking Custom Labels train Lambda: ${LAMBDA_CUSTOM_TRAIN_FUNCTION}"
  run_aws lambda invoke \
    --function-name "${LAMBDA_CUSTOM_TRAIN_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload '{}' "${WORK_DIR}/custom-train-result.json" >/dev/null

  log "Custom Labels 학습 시작 결과: ${WORK_DIR}/custom-train-result.json"
  cat "${WORK_DIR}/custom-train-result.json"
  log "학습 완료까지 30분~수 시간이 소요됩니다. DescribeProjectVersions로 상태를 확인하세요."
}

# ── Custom Labels 추론 ────────────────────────────────────────────────────────
# CUSTOM_LABELS_VERSION_ARN 환경 변수에 학습 완료된 모델 ARN을 지정하세요.
# 1) Custom Labels 추론 Lambda를 패키징/배포합니다.
# 2) 추론 Lambda를 호출해 결과를 출력합니다.
custom_labels_predict() {
  if [[ -z "${CUSTOM_LABELS_VERSION_ARN}" ]]; then
    echo "Error: CUSTOM_LABELS_VERSION_ARN is required for custom-labels-predict." >&2
    echo "  export CUSTOM_LABELS_VERSION_ARN=arn:aws:rekognition:...:project/.../version/.../.." >&2
    exit 1
  fi

  local predict_zip="${WORK_DIR}/lambda-custom-predict.zip"

  # Lambda 패키징 후 배포합니다.
  log "Packaging Custom Labels predict Lambda"
  (
    cd server
    zip -qr "../${predict_zip}" lambda/detectCustomLabelsHandler.js src node_modules package.json package-lock.json
  )

  local env_vars="Variables={S3_BUCKET_NAME=${BUCKET_NAME},CUSTOM_LABELS_VERSION_ARN=${CUSTOM_LABELS_VERSION_ARN},CUSTOM_LABELS_IMAGE_KEY=${CUSTOM_LABELS_IMAGE_KEY}}"
  if run_aws lambda get-function --function-name "${LAMBDA_CUSTOM_PREDICT_FUNCTION}" >/dev/null 2>&1; then
    log "Updating Custom Labels predict Lambda: ${LAMBDA_CUSTOM_PREDICT_FUNCTION}"
    run_aws lambda update-function-code \
      --function-name "${LAMBDA_CUSTOM_PREDICT_FUNCTION}" \
      --zip-file "fileb://${predict_zip}" >/dev/null
    run_aws lambda update-function-configuration \
      --function-name "${LAMBDA_CUSTOM_PREDICT_FUNCTION}" \
      --handler "lambda/detectCustomLabelsHandler.handler" \
      --runtime "${LAMBDA_RUNTIME}" \
      --timeout 120 \
      --memory-size 256 \
      --environment "${env_vars}" >/dev/null
  else
    if [[ -z "${LAMBDA_ROLE_ARN}" ]]; then
      echo "LAMBDA_ROLE_ARN is required to create a new Lambda function." >&2
      exit 1
    fi
    log "Creating Custom Labels predict Lambda: ${LAMBDA_CUSTOM_PREDICT_FUNCTION}"
    run_aws lambda create-function \
      --function-name "${LAMBDA_CUSTOM_PREDICT_FUNCTION}" \
      --runtime "${LAMBDA_RUNTIME}" \
      --role "${LAMBDA_ROLE_ARN}" \
      --handler "lambda/detectCustomLabelsHandler.handler" \
      --timeout 120 \
      --memory-size 256 \
      --zip-file "fileb://${predict_zip}" \
      --environment "${env_vars}" >/dev/null
  fi

  # 추론 Lambda를 호출합니다.
  log "Invoking Custom Labels predict Lambda: ${LAMBDA_CUSTOM_PREDICT_FUNCTION}"
  run_aws lambda invoke \
    --function-name "${LAMBDA_CUSTOM_PREDICT_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload '{}' "${WORK_DIR}/custom-predict-result.json" >/dev/null

  log "Custom Labels 추론 결과: ${WORK_DIR}/custom-predict-result.json"
  cat "${WORK_DIR}/custom-predict-result.json"
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    init) init_bucket ;;
    upload) upload_samples ;;
    sync) sync_images ;;
    list) list_objects ;;
    report) create_report ;;
    cleanup) cleanup_objects ;;
    lambda-package) package_lambda ;;
    lambda-deploy) deploy_lambda ;;
    lambda-invoke) invoke_lambda ;;
    custom-labels-train) custom_labels_train ;;
    custom-labels-predict) custom_labels_predict ;;
    lab-all) run_lab_all ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
