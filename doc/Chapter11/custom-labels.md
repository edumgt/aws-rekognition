# Amazon Rekognition Custom Labels — 도메인 Fine-tuning 가이드

## 1. Custom Labels란?

Amazon Rekognition의 범용 모델은 수천 가지 일반 객체를 인식합니다.
**Custom Labels**는 여기에 **도메인 고유 클래스**를 추가 학습시켜 탐지하는 기능입니다.

### 사용 사례

| 산업 | 탐지 대상 예시 |
|---|---|
| 제조 | 부품 불량 여부, 스크래치 위치 |
| 유통/물류 | 특정 브랜드 로고, 박스 라벨 |
| 농업 | 작물 병충해 감염 징후 |
| 의료 | 특정 도구·약품 식별 (비진단용) |
| 보안 | 특정 유니폼·배지 착용 여부 |

---

## 2. 언제 Custom Labels vs 범용 Rekognition?

| 조건 | 선택 |
|---|---|
| 일반 객체(사람, 자동차, 동물) 탐지 | 범용 `DetectLabels` |
| 회사/도메인 전용 객체 탐지 | **Custom Labels** |
| 학습 이미지 클래스당 10장 이상 확보 가능 | **Custom Labels** |
| 즉시 프로토타이핑 필요 | 범용 API 먼저 시도 |

---

## 3. 학습 데이터 준비

### 3-1. 이미지 수집 기준

- 클래스(레이블)당 **최소 10장** 권장 (AWS 가이드라인)
- 다양한 조명·각도·배경 포함
- 지원 형식: JPEG, PNG (최대 15 MB, 최대 4096 × 4096 px)

### 3-2. S3 폴더 구조 예시

```
s3://my-bucket/custom-labels/
  images/
    defect/       # 불량 이미지
      img001.jpg
      img002.jpg
    normal/       # 정상 이미지
      img101.jpg
      img102.jpg
  manifests/
    train.manifest  # Ground Truth 포맷 manifest
  output/           # 학습 결과 저장 경로
```

### 3-3. manifest 파일 포맷 (SageMaker Ground Truth 호환)

각 줄은 하나의 이미지에 대한 JSON 객체입니다.

```json
{"source-ref":"s3://my-bucket/custom-labels/images/defect/img001.jpg","rekognition-custom-labels-image-level-label-metadata":{"confidence":1,"job-name":"labeling-job","class-name":"defect","human-annotated":"yes","creation-date":"2024-01-01T00:00:00","type":"groundtruth/image-classification"},"rekognition-custom-labels-image-level-label":1}
{"source-ref":"s3://my-bucket/custom-labels/images/normal/img101.jpg","rekognition-custom-labels-image-level-label-metadata":{"confidence":1,"job-name":"labeling-job","class-name":"normal","human-annotated":"yes","creation-date":"2024-01-01T00:00:00","type":"groundtruth/image-classification"},"rekognition-custom-labels-image-level-label":0}
```

> 이 저장소의 샘플 manifest: `server/training/domain/sample-manifest.json`

---

## 4. API 흐름

```
CreateProject
    ↓
CreateDataset (manifest S3 URI 지정)
    ↓
CreateProjectVersion (학습 시작) ← 비용 발생 시작
    ↓
DescribeProjectVersions (폴링 — TRAINING_COMPLETED 대기)
    ↓
StartProjectVersion (모델 배포) ← 추론 과금 시작
    ↓
DetectCustomLabels (이미지 분석)
    ↓
StopProjectVersion (모델 중지) ← 반드시 실행
```

---

## 5. Lambda 핸들러 사용법

핸들러: `lambda/customLabelsHandler.handler`

### 5-1. 프로젝트 생성

```json
{
  "action": "create-project",
  "projectName": "my-defect-detector"
}
```

### 5-2. 데이터셋 등록

```json
{
  "action": "create-dataset",
  "projectArn": "arn:aws:rekognition:ap-northeast-2:123456789:project/my-defect-detector/...",
  "datasetType": "TRAIN",
  "manifestS3Uri": "s3://my-bucket/custom-labels/manifests/train.manifest"
}
```

### 5-3. 학습 시작

```json
{
  "action": "train",
  "projectArn": "arn:aws:rekognition:...",
  "versionName": "v1",
  "outputS3Uri": "s3://my-bucket/custom-labels/output/"
}
```

### 5-4. 학습 상태 조회 (폴링)

```json
{
  "action": "describe-versions",
  "projectArn": "arn:aws:rekognition:..."
}
```

응답 예시:

```json
{
  "versions": [
    {
      "projectVersionArn": "arn:aws:rekognition:...",
      "status": "TRAINING_COMPLETED",
      "billableTrainingTimeInSeconds": 5400
    }
  ]
}
```

### 5-5. 모델 배포

```json
{
  "action": "start-model",
  "projectVersionArn": "arn:aws:rekognition:...",
  "minInferenceUnits": 1
}
```

### 5-6. 추론 (커스텀 레이블 탐지)

```json
{
  "action": "detect",
  "projectVersionArn": "arn:aws:rekognition:...",
  "imageBase64": "<base64-encoded-image>",
  "minConfidence": 60
}
```

응답 예시:

```json
{
  "count": 1,
  "labels": [
    { "name": "defect", "confidence": 92.34, "geometry": null }
  ]
}
```

### 5-7. 모델 중지 (비용 절감)

```json
{
  "action": "stop-model",
  "projectVersionArn": "arn:aws:rekognition:..."
}
```

---

## 6. 배포 자동화 (aws_batch_ops.sh)

```bash
# 환경 변수 설정
export S3_BUCKET_NAME=my-bucket
export CUSTOM_LABELS_PROJECT=my-defect-detector
export CUSTOM_LABELS_MANIFEST_S3_URI=s3://my-bucket/custom-labels/manifests/train.manifest
export CUSTOM_LABELS_OUTPUT_S3_URI=s3://my-bucket/custom-labels/output/
export LAMBDA_ROLE_ARN=arn:aws:iam::123456789:role/rekognition-lambda-role

# Lambda 패키징 및 배포
./scripts/aws_batch_ops.sh lambda-deploy

# 학습 시작
./scripts/aws_batch_ops.sh custom-labels-train

# 추론 실행 (학습 완료 후)
export CUSTOM_LABELS_VERSION_ARN=arn:aws:rekognition:...
export CUSTOM_LABELS_TEST_IMAGE_PATH=./server/training/domain/test.jpg
./scripts/aws_batch_ops.sh custom-labels-infer
```

결과: `batch-work/custom-labels-result.json`

---

## 7. 비용 구조

| 항목 | 단가 (서울 리전 기준) |
|---|---|
| 학습 시간 | $1.00 / 시간 |
| 모델 배포(추론 단위) | $4.00 / 시간 per unit |
| 추론 API 호출 | $0.001 / 이미지 |

> ⚠️ **비용 주의**: 모델 배포 후 `StopProjectVersion`을 호출하지 않으면 시간당 과금이 계속됩니다.
> 실습 완료 후 즉시 `stop-model`을 실행하세요.

---

## 8. IAM 추가 권한

Lambda 실행 역할에 아래 권한을 추가해야 합니다.

```json
{
  "Effect": "Allow",
  "Action": [
    "rekognition:CreateProject",
    "rekognition:DeleteProject",
    "rekognition:CreateDataset",
    "rekognition:CreateProjectVersion",
    "rekognition:DescribeProjectVersions",
    "rekognition:StartProjectVersion",
    "rekognition:StopProjectVersion",
    "rekognition:DetectCustomLabels"
  ],
  "Resource": "*"
}
```

---

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `AccessDeniedException` | IAM 권한 부족 | 위 권한 추가 |
| `ResourceInUseException` | 동일 프로젝트명 중복 | 다른 `projectName` 사용 |
| `InvalidS3ObjectException` | manifest S3 URI 오류 | 버킷/키 경로 확인 |
| 학습 상태 `TRAINING_FAILED` | 이미지 수 부족 또는 형식 오류 | 클래스당 10장 이상, JPEG/PNG 확인 |
| `ResourceNotReadyException` | 모델이 아직 배포 중 | `StartProjectVersion` 후 수 분 대기 |
