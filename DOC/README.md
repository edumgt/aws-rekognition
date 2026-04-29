# DOC 커리큘럼 가이드

이 폴더는 AWS Rekognition 학습을 단계적으로 따라갈 수 있도록 구성된 커리큘럼 문서 모음입니다.
아래 10개 챕터를 순서대로 학습하면, 기초 보안부터 자동화 운영까지 한 흐름으로 이해할 수 있습니다.

> 실습 버킷 기본값: `polly-bucket-edumgt`

---

## 추천 학습 순서

1. Chapter01 - AWS 기초와 계정 보안
2. Chapter02 - IAM 심화와 권한 설계
3. Chapter03 - AWS CLI 실무 사용법
4. Chapter04 - S3 핵심 아키텍처
5. Chapter05 - Node.js와 AWS SDK 연동
6. Chapter06 - Amazon Rekognition 기본
7. Chapter07 - Rekognition 실전 API
8. Chapter08 - 운영 자동화와 배치 스크립트
9. Chapter09 - 모니터링·비용·보안 점검
10. Chapter10 - 최종 프로젝트와 확장 로드맵
11. Chapter11 - 도메인 Fine-tuning (Custom Labels & Face Collection)

---

## 챕터별 학습 목표(요약)

- **Chapter01~02**: AWS 계정/IAM 보안 모델의 기본기를 다지고 최소 권한 설계 감각을 익힙니다.
- **Chapter03~04**: CLI와 S3 실무 명령을 통해 데이터 저장소 운영 능력을 확보합니다.
- **Chapter05~07**: Node.js 코드에서 Rekognition API를 호출하며 기능을 실제로 구현합니다.
- **Chapter08~10**: 배치 자동화, 운영 관측성, 확장 아키텍처까지 포함해 실무형 프로젝트로 연결합니다.
- **Chapter11**: Custom Labels Fine-tuning과 Face Collection으로 도메인 특화 AI를 구축합니다.

---

## 학습 방법 가이드

1. 각 챕터를 읽기 전에 해당 챕터의 "실습 목표"를 먼저 확인합니다.
2. 문서의 CLI 명령은 복사 실행 후, 출력 결과를 반드시 스스로 해석해 봅니다.
3. 실패한 명령은 그대로 넘어가지 말고 IAM/리전/리소스명을 역추적합니다.
4. 챕터 완료 후 "내 환경에서 재현 가능한 최소 명령 세트"를 개인 노트로 정리합니다.

---

## 권장 준비물

- AWS CLI v2
- Node.js 18+
- `jq`, `zip`, `unzip` 등 보조 도구
- 실습용 IAM 사용자 또는 Role(최소 권한 기준)

---

## 완료 기준(체크리스트)

- [ ] S3 버킷 생성/업로드/정책 설정을 CLI로 수행 가능
- [ ] Rekognition CompareFaces/DetectText를 코드와 Lambda에서 각각 실행 가능
- [ ] 배치 스크립트로 배포 및 검증 자동화 가능
- [ ] 권한 오류 발생 시 원인(IAM/리전/리소스)을 독립적으로 진단 가능
