# Chapter 11. 도메인 Fine-tuning — Amazon Rekognition Custom Labels

## 챕터 개요

일반 Rekognition API(CompareFaces, DetectLabels 등)는 범용 AI 모델을 사용합니다.
도메인 특화 문제(공장 불량품 검출, 의류 카테고리 분류 등)는 자체 이미지와 라벨로
**Custom Labels 모델을 Fine-tuning**해야 높은 정확도를 얻을 수 있습니다.

이 챕터에서는 **Amazon Rekognition Custom Labels** 서비스를 이용해
학습 데이터를 준비하고 → 모델을 훈련하고 → 추론하는 전체 파이프라인을 실습합니다.

---

## 학습 목표

- 일반 Rekognition과 Custom Labels의 차이를 이해한다
- S3 매니페스트(JSONL) 형식으로 학습 데이터를 준비한다
- `CreateProject → CreateDataset → CreateProjectVersion`으로 학습을 시작한다
- `StartProjectVersion → DetectCustomLabels → StopProjectVersion`으로 추론을 실행한다
- Lambda 핸들러와 배치 스크립트로 전체 파이프라인을 자동화한다

---

## 1. 일반 Rekognition vs Custom Labels 비교

| 항목 | 일반 Rekognition | Custom Labels |
|---|---|---|
| 모델 | AWS 사전 학습 범용 모델 | 사용자 데이터로 Fine-tuned |
| 라벨 종류 | AWS 정의 수천 개 | 사용자 정의 클래스 |
| 학습 필요 여부 | ❌ 없음 | ✅ 필요 (30분~수 시간) |
| 비용 | API 호출 건당 | 학습 시간 + 모델 호스팅 시간 |
| 적합한 사례 | 범용 얼굴/텍스트/물체 인식 | 도메인 특화 분류/검출 |

---

## 2. 지원 리전 확인

Custom Labels는 모든 리전에서 사용할 수 없습니다.
실습 전에 아래 명령으로 현재 리전 지원 여부를 확인하세요.

```bash
aws rekognition describe-projects --region ap-northeast-2
```

> ⚠️ 지원 리전: `us-east-1`, `us-east-2`, `us-west-2`, `eu-west-1`, `ap-northeast-1`, `ap-northeast-2` 등.
> 최신 목록은 [AWS 공식 문서](https://docs.aws.amazon.com/rekognition/latest/customlabels-dg/what-is.html)를 확인하세요.

---

## 3. 필요 IAM 권한

기존 실습용 Role에 아래 권한을 추가하세요.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateProject",
        "rekognition:DescribeProjects",
        "rekognition:CreateDataset",
        "rekognition:DescribeDataset",
        "rekognition:CreateProjectVersion",
        "rekognition:DescribeProjectVersions",
        "rekognition:StartProjectVersion",
        "rekognition:StopProjectVersion",
        "rekognition:DetectCustomLabels",
        "rekognition:DeleteProject",
        "rekognition:DeleteProjectVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

```bash
# 편의상 관리형 정책을 사용할 수도 있습니다 (실습 환경 한정).
aws iam attach-role-policy \
  --role-name rekognition-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonRekognitionCustomLabelsFullAccess
```

---

## 4. 데이터셋 준비

### 4-1. 이미지 업로드

학습용 이미지를 S3의 `custom-labels/images/` 경로에 업로드합니다.
이미지는 JPEG 또는 PNG 형식이어야 하며, 클래스당 최소 10장 이상을 권장합니다.

```bash
# 예: 로컬 images/ 폴더를 S3에 동기화
aws s3 sync ./images/ s3://${S3_BUCKET_NAME}/custom-labels/images/ \
  --region ap-northeast-2
```

### 4-2. 매니페스트(JSONL) 작성

`server/training/custom-labels-manifest.jsonl` 파일을 참고해 매니페스트를 작성합니다.
각 줄이 하나의 이미지와 라벨 정보를 JSON으로 나타냅니다.

**매니페스트 필드 설명**

| 필드 | 설명 |
|---|---|
| `source-ref` | S3 이미지 URI (`s3://버킷명/경로`) |
| `<job-name>` | 라벨 어노테이션 정보 (bounding box 또는 image-level) |
| `<job-name>-metadata` | 클래스 맵, 신뢰도, 어노테이션 타입 등 메타데이터 |

**이미지 수준 분류(Image Classification) 예시**

```jsonl
{"source-ref":"s3://MY-BUCKET/custom-labels/images/cat_001.jpg","my-labels":{"confidence":1},"my-labels-metadata":{"class-name":"cat","type":"groundtruth/image-classification","human-annotated":"yes","creation-date":"2026-01-01T00:00:00","job-name":"my-labels"}}
{"source-ref":"s3://MY-BUCKET/custom-labels/images/dog_001.jpg","my-labels":{"confidence":1},"my-labels-metadata":{"class-name":"dog","type":"groundtruth/image-classification","human-annotated":"yes","creation-date":"2026-01-01T00:00:00","job-name":"my-labels"}}
```

**객체 검출(Object Detection) 예시**

Bounding box 어노테이션이 필요하며, `server/training/custom-labels-manifest.jsonl` 예시를 참고하세요.

### 4-3. 매니페스트를 S3에 업로드

```bash
aws s3 cp server/training/custom-labels-manifest.jsonl \
  s3://${S3_BUCKET_NAME}/custom-labels/manifest.jsonl \
  --region ap-northeast-2
```

---

## 5. 학습 파이프라인

### 5-1. 배치 스크립트로 실행 (권장)

```bash
export AWS_REGION=ap-northeast-2
export S3_BUCKET_NAME=my-rekognition-bucket
export LAMBDA_ROLE_ARN=arn:aws:iam::123456789012:role/rekognition-lambda-role
# 필요시 프로젝트 이름 변경
export CUSTOM_LABELS_PROJECT=my-defect-detector

./scripts/aws_batch_ops.sh custom-labels-train
```

실행 결과로 `batch-work/custom-train-result.json`에 아래와 같은 내용이 저장됩니다.

```json
{
  "projectName": "my-defect-detector",
  "projectArn": "arn:aws:rekognition:ap-northeast-2:...:project/my-defect-detector/...",
  "datasetArn": "arn:aws:rekognition:ap-northeast-2:...:project/.../dataset/train/...",
  "projectVersionArn": "arn:aws:rekognition:ap-northeast-2:...:project/.../version/v.../...",
  "versionName": "v1700000000000",
  "message": "학습이 시작되었습니다. 완료까지 30분~수 시간이 소요될 수 있습니다."
}
```

### 5-2. 로컬 Node.js로 실행

```bash
cd server
npm run custom-labels:train
```

### 5-3. 학습 상태 확인

```bash
# projectVersionArn을 custom-train-result.json에서 복사해 붙여넣으세요.
PROJECT_ARN="arn:aws:rekognition:ap-northeast-2:...:project/my-defect-detector/..."
VERSION_NAME="v1700000000000"

aws rekognition describe-project-versions \
  --project-arn "${PROJECT_ARN}" \
  --version-names "${VERSION_NAME}" \
  --region ap-northeast-2 \
  --query "ProjectVersionDescriptions[0].{Status:Status,Message:StatusMessage,F1:EvaluationResult.F1Score}" \
  --output table
```

상태 값 설명:

| 상태 | 의미 |
|---|---|
| `TRAINING_IN_PROGRESS` | 학습 진행 중 |
| `TRAINING_COMPLETED` | 학습 완료 (추론 가능) |
| `TRAINING_FAILED` | 학습 실패 |
| `STARTING` | 모델 배포 시작 |
| `RUNNING` | 추론 요청 수신 가능 |
| `STOPPING` | 모델 중지 중 |
| `STOPPED` | 모델 중지 완료 |

---

## 6. 추론 파이프라인

학습 상태가 `TRAINING_COMPLETED` 또는 `RUNNING`이어야 합니다.

### 6-1. 배치 스크립트로 실행

```bash
export CUSTOM_LABELS_VERSION_ARN="arn:aws:rekognition:ap-northeast-2:...:project/.../version/.../.."
export CUSTOM_LABELS_IMAGE_KEY="training/face1.png"  # 분석할 이미지의 S3 키

./scripts/aws_batch_ops.sh custom-labels-predict
```

결과는 `batch-work/custom-predict-result.json`에 저장됩니다.

```json
{
  "projectName": "my-defect-detector",
  "versionName": "v1700000000000",
  "imageKey": "training/face1.png",
  "labelCount": 1,
  "labels": [
    { "Name": "defect", "Confidence": 94.5 }
  ]
}
```

### 6-2. 로컬 Node.js로 실행

```bash
export CUSTOM_LABELS_VERSION_ARN="arn:aws:rekognition:ap-northeast-2:...:project/.../version/.../.."
export CUSTOM_LABELS_IMAGE_KEY="training/face1.png"

cd server
npm run custom-labels:predict
```

### 6-3. AWS CLI로 직접 실행

```bash
# 모델 시작
aws rekognition start-project-version \
  --project-version-arn "${CUSTOM_LABELS_VERSION_ARN}" \
  --min-inference-units 1 \
  --region ap-northeast-2

# 상태가 RUNNING이 될 때까지 대기 (수 분 소요)
aws rekognition describe-project-versions \
  --project-arn "${PROJECT_ARN}" \
  --version-names "${VERSION_NAME}" \
  --region ap-northeast-2 \
  --query "ProjectVersionDescriptions[0].Status"

# 추론 실행
aws rekognition detect-custom-labels \
  --project-version-arn "${CUSTOM_LABELS_VERSION_ARN}" \
  --image '{"S3Object":{"Bucket":"MY-BUCKET","Name":"training/face1.png"}}' \
  --min-confidence 50 \
  --region ap-northeast-2

# 모델 중지 (비용 절감 필수!)
aws rekognition stop-project-version \
  --project-version-arn "${CUSTOM_LABELS_VERSION_ARN}" \
  --region ap-northeast-2
```

---

## 7. 신규 파일 구조

이 챕터에서 추가된 파일들입니다.

```
server/
├─ lambda/
│  ├─ trainCustomModelHandler.js     # Lambda: 프로젝트 생성 + 학습 시작
│  └─ detectCustomLabelsHandler.js   # Lambda: 모델 시작 + 추론 + 모델 중지
├─ src/
│  └─ customLabelsWorkflow.js        # 비즈니스 로직 (학습/추론 파이프라인)
├─ local/
│  ├─ customLabelsTrainLocal.js      # 로컬 학습 실행기
│  └─ customLabelsPredictLocal.js    # 로컬 추론 실행기
└─ training/
   └─ custom-labels-manifest.jsonl   # 예시 학습 매니페스트 (수정 후 사용)
scripts/
└─ aws_batch_ops.sh                  # custom-labels-train / custom-labels-predict 추가
```

---

## 8. 비용 주의사항

> Custom Labels는 **학습 시간과 모델 호스팅 시간** 모두 과금됩니다.

| 항목 | 과금 단위 | 예시 비용 (서울 리전) |
|---|---|---|
| 학습 | 시간당 | $1.00/hr × 소요 시간 |
| 모델 호스팅(추론 가능 상태) | 시간당 × 추론 유닛 수 | $4.00/hr × 유닛 수 |
| 추론 API 호출 | 건당 | $0.001/이미지 |

**비용 절감 팁**

- 추론이 끝나면 **반드시 `StopProjectVersion`으로 모델을 중지**하세요.
  이 레포의 `detectCustomLabelsHandler.js`와 `custom-labels-predict` 스크립트는
  추론 후 자동으로 모델을 중지합니다.
- 실습이 완전히 끝나면 프로젝트 버전과 프로젝트를 삭제하세요.

```bash
# 프로젝트 버전 삭제
aws rekognition delete-project-version \
  --project-version-arn "${CUSTOM_LABELS_VERSION_ARN}" \
  --region ap-northeast-2

# 프로젝트 삭제 (버전이 모두 삭제된 후)
aws rekognition delete-project \
  --project-arn "${PROJECT_ARN}" \
  --region ap-northeast-2
```

---

## 9. 트러블슈팅

### 학습이 TRAINING_FAILED로 끝남

- 매니페스트의 `source-ref` 경로(S3 URI)와 실제 이미지 위치가 일치하는지 확인
- 클래스당 이미지 수가 최소 요건(보통 10장 이상)을 충족하는지 확인
- Lambda Role에 S3 읽기 권한과 `rekognition:CreateProjectVersion` 권한이 있는지 확인

### `ResourceNotFoundException` (DetectCustomLabels)

- 모델 ARN이 정확한지, 리전이 일치하는지 확인
- `DescribeProjectVersions`로 모델 상태를 확인해 `RUNNING` 상태인지 검증

### 추론 결과 라벨이 비어 있음

- `MinConfidence` 값을 낮춰 보세요 (예: 50 → 30)
- 학습 이미지와 테스트 이미지의 도메인이 동일한지 확인
- 학습 데이터(매니페스트)의 라벨이 정확한지 재검토

---

## 10. 완료 기준

- [ ] 매니페스트 파일을 작성하고 S3에 업로드할 수 있다
- [ ] `custom-labels-train` 스크립트로 학습을 시작할 수 있다
- [ ] `DescribeProjectVersions`로 학습 상태를 확인할 수 있다
- [ ] `custom-labels-predict` 스크립트로 추론 결과를 얻을 수 있다
- [ ] 실습 후 모델 중지 및 리소스 정리를 완료한다
