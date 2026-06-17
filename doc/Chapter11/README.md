# Chapter 11. 도메인 Fine-tuning — Custom Labels & Face Collection

## 챕터 개요

Amazon Rekognition의 범용 모델은 일반 객체·얼굴·텍스트를 잘 다루지만,
**특정 도메인**(제조 불량 판별, 사내 출입 인식, 특정 브랜드 로고 탐지 등)에는
추가 학습이 필요합니다.

이 챕터는 두 가지 도메인 특화 접근법을 다룹니다.

| 기법 | API | 언제 사용? |
|---|---|---|
| **Custom Labels** | `CreateProject` / `DetectCustomLabels` | 도메인 전용 객체·분류 탐지 |
| **Face Collection** | `CreateCollection` / `IndexFaces` / `SearchFacesByImage` | 조직 내 특정 인물 인식·출입 관리 |

---

## 학습 목표

- Custom Labels 프로젝트 생성 → 데이터셋 등록 → 학습 → 배포 → 추론 → 중지 흐름 이해
- Face Collection을 사용해 조직별 얼굴 DB를 구축하고 실시간 검색 수행
- 비용 구조와 비용 최소화 전략 습득

---

## 문서 구성

- [`custom-labels.md`](./custom-labels.md) — Custom Labels 개념, 학습 데이터 준비, API 흐름, 비용 안내
- [`face-collection.md`](./face-collection.md) — Face Collection CRUD, IndexFaces, SearchFacesByImage 실습

---

## 선수 지식

- Chapter 06 (Rekognition 기본) 완료
- Chapter 07 (Rekognition 실전 API) 완료
- S3 버킷 운영 가능 (Chapter 04)
- Lambda 배포 가능 (Chapter 08)

---

## 관련 코드

```
server/
  lambda/
    customLabelsHandler.js   # Custom Labels Lambda 핸들러
    faceCollectionHandler.js # Face Collection Lambda 핸들러
  local/
    customLabelsLocal.js     # 로컬 테스트 진입점
    faceCollectionLocal.js   # 로컬 테스트 진입점
  training/
    domain/                  # 도메인 학습 이미지 폴더
      sample-manifest.json   # S3 manifest 예시
```

---

## 실습 체크리스트

- [ ] IAM 역할에 Custom Labels 권한 추가 확인
- [ ] S3 버킷에 학습 이미지 업로드 (클래스당 최소 10장)
- [ ] manifest JSON 작성 및 S3 업로드
- [ ] `custom-labels-train` 실행 후 `DescribeProjectVersions` 상태 확인
- [ ] 모델 배포(`start-model`) 후 `detect` 추론 실행
- [ ] 실습 완료 후 `stop-model` 호출로 비용 중단 확인
- [ ] Face Collection 생성 → 얼굴 등록 → 검색 성공 확인

---

## 완료 기준

- Custom Labels 추론 결과(`custom-labels-result.json`)에서 커스텀 레이블 1개 이상 탐지
- Face Collection 검색에서 등록된 인물 매칭 성공
- `stop-model` 호출로 배포 비용 중지 확인
