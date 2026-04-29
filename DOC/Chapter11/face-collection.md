# Amazon Rekognition Face Collection — 도메인별 얼굴 DB 가이드

## 1. Face Collection이란?

`CompareFaces`가 두 이미지를 1:1 비교한다면,
**Face Collection**은 조직이 관리하는 **다수의 등록 얼굴을 DB처럼 유지**하고
새 이미지로 1:N 검색을 수행합니다.

### 사용 사례

| 시나리오 | 설명 |
|---|---|
| 사원 출입 관리 | 카메라 이미지를 Collection에서 검색해 사원 확인 |
| 이벤트 참가자 확인 | 행사 현장 사진에서 등록 참가자 탐지 |
| VIP 고객 인식 | 매장 입장 시 등록 고객 자동 인식 |
| 보안 감시 | 관심 인물 목록과 실시간 매칭 |

---

## 2. 범용 CompareFaces vs Face Collection

| 비교 항목 | `CompareFaces` | Face Collection |
|---|---|---|
| 비교 방식 | 1:1 | 1:N |
| 사전 등록 필요 | 없음 | 있음 (`IndexFaces`) |
| 적합한 규모 | 소규모(수 장) | 수백 ~ 수천만 장 |
| 검색 속도 | O(1) | O(log N) |
| 외부 ID 연결 | 불가 | `ExternalImageId` 활용 |

---

## 3. 핵심 API 흐름

```
CreateCollection
    ↓
IndexFaces (이미지 → 얼굴 특징 벡터 저장)
    ↓
SearchFacesByImage (새 이미지 → Collection에서 유사 얼굴 검색)
    ↓
(필요 시) DeleteFaces / DeleteCollection
```

---

## 4. Lambda 핸들러 사용법

핸들러: `lambda/faceCollectionHandler.handler`

### 4-1. Collection 생성

```json
{
  "action": "create-collection",
  "collectionId": "company-employees"
}
```

응답 예시:

```json
{
  "collectionArn": "arn:aws:rekognition:ap-northeast-2:123456789:collection/company-employees",
  "statusCode": 200
}
```

### 4-2. 얼굴 등록 (IndexFaces)

```json
{
  "action": "index-face",
  "collectionId": "company-employees",
  "imageBase64": "<base64-encoded-image>",
  "externalImageId": "employee-홍길동-001"
}
```

응답 예시:

```json
{
  "indexed": [
    {
      "faceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "externalImageId": "employee-홍길동-001",
      "confidence": 99.8,
      "boundingBox": { "Width": 0.4, "Height": 0.5, "Left": 0.3, "Top": 0.1 }
    }
  ],
  "unindexedCount": 0
}
```

> `externalImageId`에 사원번호·이름·부서 등의 식별자를 저장하면,
> 검색 결과에서 바로 사원 정보를 확인할 수 있습니다.

### 4-3. 등록된 얼굴 목록 조회

```json
{
  "action": "list-faces",
  "collectionId": "company-employees",
  "maxFaces": 20
}
```

### 4-4. 이미지로 얼굴 검색 (SearchFacesByImage)

```json
{
  "action": "search-face",
  "collectionId": "company-employees",
  "imageBase64": "<base64-encoded-image>",
  "maxFaces": 5
}
```

응답 예시:

```json
{
  "matched": true,
  "matches": [
    {
      "faceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "externalImageId": "employee-홍길동-001",
      "similarity": 98.54,
      "confidence": 99.8
    }
  ]
}
```

### 4-5. 특정 얼굴 삭제

```json
{
  "action": "delete-face",
  "collectionId": "company-employees",
  "faceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### 4-6. Collection 삭제

```json
{
  "action": "delete-collection",
  "collectionId": "company-employees"
}
```

---

## 5. 로컬 실행

```bash
cd server
export COLLECTION_ID=rekognition-demo-collection
npm run lambda:face-collection:local
```

실행 순서: Collection 생성 → face1.png 등록 → 목록 조회 → 이미지 검색

---

## 6. IAM 필요 권한

```json
{
  "Effect": "Allow",
  "Action": [
    "rekognition:CreateCollection",
    "rekognition:DeleteCollection",
    "rekognition:ListCollections",
    "rekognition:IndexFaces",
    "rekognition:ListFaces",
    "rekognition:SearchFacesByImage",
    "rekognition:DeleteFaces"
  ],
  "Resource": "*"
}
```

---

## 7. 실습 시나리오: 사내 출입 관리 시스템

### 시나리오 흐름

```
[입사 시] 신규 사원 사진 3장 촬영
    → IndexFaces (externalImageId = 사원번호)
    → Collection에 얼굴 특징 벡터 저장

[출입 시] 카메라 이미지 캡처
    → SearchFacesByImage
    → similarity > 80% → 입장 허가
    → 매칭 없음 → 입장 거부 / 경보
```

### 구현 팁

- 동일 인물에 대해 **여러 각도·조명** 사진 3~5장을 등록하면 인식률이 높아집니다.
- `FaceMatchThreshold`를 조정해 보안 강도와 편의성을 조율하세요(기본 80%).
- 퇴사 사원의 `faceId`는 즉시 `DeleteFaces`로 제거하세요.

---

## 8. 비용 구조

| 항목 | 단가 (서울 리전 기준) |
|---|---|
| IndexFaces | $0.001 / 이미지 |
| SearchFacesByImage | $0.001 / 이미지 |
| 얼굴 메타데이터 저장 | $0.01 / 1,000 얼굴/월 |

> CompareFaces 대비 추가 저장 비용이 있지만, 대규모 1:N 검색에서는 훨씬 효율적입니다.

---

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `ResourceAlreadyExistsException` | 동일 ID의 Collection이 이미 존재 | `list-collections`로 확인 후 재사용 |
| `InvalidParameterException` | 이미지에서 얼굴 미탐지 | 정면 사진, 충분한 조명 확인 |
| `ImageTooLargeException` | 이미지 15 MB 초과 | 이미지 리사이징 후 재시도 |
| 검색 결과 `matched: false` | 임계값이 너무 높거나 등록 이미지 부족 | `FaceMatchThreshold` 낮추거나 추가 등록 |
