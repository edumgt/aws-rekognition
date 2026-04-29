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
LAMBDA_FACE_COLLECTION_FUNCTION="${LAMBDA_FACE_COLLECTION_FUNCTION:-rekognition-face-collection}"
LAMBDA_CUSTOM_LABELS_FUNCTION="${LAMBDA_CUSTOM_LABELS_FUNCTION:-rekognition-custom-labels}"
LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-30}"
LAMBDA_MEMORY_SIZE="${LAMBDA_MEMORY_SIZE:-256}"

# Custom Labels 관련 환경 변수입니다.
CUSTOM_LABELS_PROJECT="${CUSTOM_LABELS_PROJECT:-rekognition-custom-labels-demo}"
CUSTOM_LABELS_VERSION_NAME="${CUSTOM_LABELS_VERSION_NAME:-v$(date +%Y%m%d%H%M%S)}"
CUSTOM_LABELS_MANIFEST_S3_URI="${CUSTOM_LABELS_MANIFEST_S3_URI:-s3://${BUCKET_NAME}/custom-labels/manifests/train.manifest}"
CUSTOM_LABELS_OUTPUT_S3_URI="${CUSTOM_LABELS_OUTPUT_S3_URI:-s3://${BUCKET_NAME}/custom-labels/output/}"
CUSTOM_LABELS_VERSION_ARN="${CUSTOM_LABELS_VERSION_ARN:-}"
CUSTOM_LABELS_TEST_IMAGE_PATH="${CUSTOM_LABELS_TEST_IMAGE_PATH:-./server/training/domain/test.jpg}"

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
  lambda-deploy        Create/update Lambda functions for upload+compare+web+fine-tuning handlers
  lambda-invoke        Invoke upload and compare Lambda sequentially
  custom-labels-train  Start Custom Labels model training (requires CUSTOM_LABELS_PROJECT, CUSTOM_LABELS_MANIFEST_S3_URI)
  custom-labels-infer  Run DetectCustomLabels inference (requires CUSTOM_LABELS_VERSION_ARN, CUSTOM_LABELS_TEST_IMAGE_PATH)
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
  LAMBDA_FACE_COLLECTION_FUNCTION  Face Collection Lambda function name
  LAMBDA_CUSTOM_LABELS_FUNCTION    Custom Labels Lambda function name
  CUSTOM_LABELS_PROJECT            Custom Labels project name
  CUSTOM_LABELS_VERSION_NAME       Model version name (default: timestamp)
  CUSTOM_LABELS_MANIFEST_S3_URI    S3 URI of the training manifest file
  CUSTOM_LABELS_OUTPUT_S3_URI      S3 URI prefix for training output
  CUSTOM_LABELS_VERSION_ARN        Deployed model ARN (required for custom-labels-infer)
  CUSTOM_LABELS_TEST_IMAGE_PATH    Local image path for inference test
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
  local face_collection_zip="${WORK_DIR}/lambda-face-collection.zip"
  local custom_labels_zip="${WORK_DIR}/lambda-custom-labels.zip"

  log "Packaging Lambda source files"
  (
    cd server
    zip -qr "../${upload_zip}" lambda/uploadFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${compare_zip}" lambda/compareFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${compare_upload_zip}" lambda/compareUploadedFacesHandler.js src node_modules package.json package-lock.json
    zip -qr "../${text_zip}" lambda/detectTextHandler.js src node_modules package.json package-lock.json
    zip -qr "../${face_collection_zip}" lambda/faceCollectionHandler.js src node_modules package.json package-lock.json
    zip -qr "../${custom_labels_zip}" lambda/customLabelsHandler.js src node_modules package.json package-lock.json
  )

  log "Packaged: ${upload_zip}, ${compare_zip}, ${compare_upload_zip}, ${text_zip}, ${face_collection_zip}, ${custom_labels_zip}"
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
  upsert_lambda "${LAMBDA_FACE_COLLECTION_FUNCTION}" "lambda/faceCollectionHandler.handler" "${WORK_DIR}/lambda-face-collection.zip"
  upsert_lambda "${LAMBDA_CUSTOM_LABELS_FUNCTION}" "lambda/customLabelsHandler.handler" "${WORK_DIR}/lambda-custom-labels.zip"

  log "Lambda deploy completed"
}

# Custom Labels 모델 학습을 시작합니다.
# 필수 환경 변수: CUSTOM_LABELS_PROJECT, CUSTOM_LABELS_MANIFEST_S3_URI, CUSTOM_LABELS_OUTPUT_S3_URI
custom_labels_train() {
  if [[ -z "${LAMBDA_ROLE_ARN}" ]]; then
    echo "LAMBDA_ROLE_ARN is required for custom-labels-train (Lambda must exist)." >&2
    exit 1
  fi

  log "Starting Custom Labels training: project=${CUSTOM_LABELS_PROJECT}, version=${CUSTOM_LABELS_VERSION_NAME}"

  # 1. 프로젝트 생성을 시도합니다. 이미 존재하면 무시합니다.
  local create_payload
  create_payload=$(printf '{"action":"create-project","projectName":"%s"}' "${CUSTOM_LABELS_PROJECT}")
  run_aws lambda invoke \
    --function-name "${LAMBDA_CUSTOM_LABELS_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload "${create_payload}" \
    "${WORK_DIR}/custom-labels-create-project.json" >/dev/null || true
  log "Project creation result: $(cat "${WORK_DIR}/custom-labels-create-project.json")"

  # 2. 학습을 시작합니다. projectArn은 create-project 응답에서 추출합니다.
  local project_arn
  project_arn=$(python3 -c "import json,sys; d=json.load(open('${WORK_DIR}/custom-labels-create-project.json')); b=json.loads(d.get('body','{}') if isinstance(d,dict) else '{}'); print(b.get('projectArn',''))" 2>/dev/null || true)

  if [[ -z "${project_arn}" ]]; then
    log "Could not extract projectArn. Check ${WORK_DIR}/custom-labels-create-project.json"
    log "Attempting to use describe-versions to find existing project ARN..."
    echo '{"action":"describe-versions","projectArn":""}' > /dev/null
    echo "Please set CUSTOM_LABELS_VERSION_ARN manually after training starts." >&2
    exit 1
  fi

  local train_payload
  train_payload=$(printf '{"action":"train","projectArn":"%s","versionName":"%s","outputS3Uri":"%s"}' \
    "${project_arn}" "${CUSTOM_LABELS_VERSION_NAME}" "${CUSTOM_LABELS_OUTPUT_S3_URI}")

  log "Invoking Lambda to start training..."
  run_aws lambda invoke \
    --function-name "${LAMBDA_CUSTOM_LABELS_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload "${train_payload}" \
    "${WORK_DIR}/custom-labels-train-result.json" >/dev/null
  log "Training started. Result: $(cat "${WORK_DIR}/custom-labels-train-result.json")"
  log "Training takes minutes to hours. Poll status with:"
  log "  action=describe-versions, projectArn=${project_arn}"
}

# Custom Labels 추론을 실행합니다.
# 필수 환경 변수: CUSTOM_LABELS_VERSION_ARN, CUSTOM_LABELS_TEST_IMAGE_PATH
custom_labels_infer() {
  if [[ -z "${CUSTOM_LABELS_VERSION_ARN}" ]]; then
    echo "CUSTOM_LABELS_VERSION_ARN is required for custom-labels-infer." >&2
    exit 1
  fi
  if [[ ! -f "${CUSTOM_LABELS_TEST_IMAGE_PATH}" ]]; then
    # 지정 경로에 이미지가 없으면 server/ 디렉터리의 첫 번째 PNG를 대신 사용합니다.
    local fallback
    fallback=$(find "${UPLOAD_DIR}" -maxdepth 1 -name "*.png" | head -n 1)
    if [[ -z "${fallback}" ]]; then
      echo "Test image not found: ${CUSTOM_LABELS_TEST_IMAGE_PATH}" >&2
      echo "Set CUSTOM_LABELS_TEST_IMAGE_PATH to an existing image file." >&2
      exit 1
    fi
    log "Test image not found at '${CUSTOM_LABELS_TEST_IMAGE_PATH}', using fallback: ${fallback}"
    CUSTOM_LABELS_TEST_IMAGE_PATH="${fallback}"
  fi

  log "Encoding test image: ${CUSTOM_LABELS_TEST_IMAGE_PATH}"
  local image_base64
  image_base64=$(base64 -w 0 "${CUSTOM_LABELS_TEST_IMAGE_PATH}")

  local detect_payload
  detect_payload=$(printf '{"action":"detect","projectVersionArn":"%s","imageBase64":"%s","minConfidence":50}' \
    "${CUSTOM_LABELS_VERSION_ARN}" "${image_base64}")

  log "Invoking Lambda for inference..."
  run_aws lambda invoke \
    --function-name "${LAMBDA_CUSTOM_LABELS_FUNCTION}" \
    --cli-binary-format raw-in-base64-out \
    --payload "${detect_payload}" \
    "${WORK_DIR}/custom-labels-result.json" >/dev/null

  log "Inference result saved to ${WORK_DIR}/custom-labels-result.json"
  cat "${WORK_DIR}/custom-labels-result.json"
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
    custom-labels-infer) custom_labels_infer ;;
    lab-all) run_lab_all ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
