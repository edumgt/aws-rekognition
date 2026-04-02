# AWS Rekognition 실습 리팩토링 가이드 (Node.js + Lambda + Shell 자동화)

이 문서는 이 저장소를 **실습 중심으로 재구성**한 최신 가이드입니다.  
목표는 아래 3가지를 한 번에 수행하는 것입니다.
 
1. `server` 기반 Node.js 코드로 Rekognition 실습 환경 구성
2. `face1.png ~ face4.png` 업로드 및 유사성 분석을 **AWS Lambda**로 실행
3. `scripts/aws_batch_ops.sh` 하나로 **버킷 준비 → Lambda 배포/호출 → 결과 수집** 자동화

---


## 문서 맵 (빠른 이동)

실습 목적에 따라 아래 문서를 함께 참고하세요.

- `Readme2.md`: 로컬 실행 중심 빠른 시작 및 트러블슈팅
- `Readme3.md`: S3 퍼블릭 접근/라이프사이클 운영 가이드
- `Readme4.md`: IAM Principal/AssumeRole 개념 정리
- `Lambda.md`: Lambda 목록 조회/백업 운영 가이드
- `DOC/README.md`: 10개 챕터 커리큘럼 인덱스

---
## 1) 리팩토링 핵심 구조

```bash
.
├─ server/
│  ├─ src/
│  │  ├─ awsClients.js         # AWS SDK 클라이언트 초기화
│  │  ├─ config.js             # 환경변수/실습 기본값 관리
│  │  ├─ fileUtils.js          # 이미지 파일 로딩 유틸
│  │  └─ faceWorkflow.js       # 얼굴 업로드 + 얼굴 비교 비즈니스 로직
│  ├─ lambda/
│  │  ├─ uploadFacesHandler.js # Lambda: face1~6 S3 업로드
│  │  └─ compareFacesHandler.js# Lambda: face1~6 유사도 비교
│  ├─ upload.js                # 로컬 실행용 업로드 엔트리
│  ├─ compare.js               # 로컬 실행용 비교 엔트리
│  ├─ extract.js               # 텍스트 감지 샘플
│  └─ web/                     # Node.js 웹 데모(파일 업로드 -> Lambda 호출)
└─ scripts/
   └─ aws_batch_ops.sh         # 버킷/Lambda/실습 배치 자동화
```

---

## 2) 사전 준비

- AWS 계정, IAM 사용자(또는 Role) 준비
- 최소 권한 권장 정책
  - S3: 버킷 생성/설정/업로드/조회
  - Lambda: 함수 생성/수정/호출
  - Rekognition: `CompareFaces`, `DetectText`
  - IAM: Lambda 생성 시 Role 조회 권한
- 로컬 도구
  - WSL Ubuntu 내부의 Node.js 18+
  - npm
  - AWS CLI v2
  - zip 명령어

---

## 3) 환경 변수 설정

루트 또는 `server/.env` 기준으로 아래 값 설정:

```env
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=polly-bucket-edumgt
SIMILARITY_THRESHOLD=80
FACE_FILES=face1.png,face2.png,face3.png,face4.png,face5.png,face6.png
```

> 실제 운영에서는 Access Key보다 IAM Role(예: EC2/CloudShell/Lambda 실행 역할)을 우선 권장합니다.

---

## 4) 로컬 실행(빠른 검증)
#### WSL Node.js 설치 및 확인


```bash
cd server
/usr/bin/node -v
/usr/bin/npm -v
npm install
npm run upload:faces
npm run compare:faces
npm run extract
```

- 이 저장소의 Node.js 스크립트는 Linux/WSL 런타임 기준으로 정리되어 있습니다.
- WSL 터미널에서 `npm run ...`을 실행하면 되고, 경로 충돌이 있을 때는 `/usr/bin/npm run <script>`를 우선 사용하세요.
- Windows Node.js가 직접 실행되면 즉시 중단하고 WSL 실행 방법을 안내합니다.

- `upload:faces`: `training/face1~6.png` 경로로 S3 업로드
- `compare:faces`: face1~6를 조합 비교하여 유사도 출력
- `extract`: `sample.png` 텍스트 검출

---


## 4-1) 웹 프론트엔드 모듈 실행 (신규)

`server/web`는 브라우저에서 이미지를 업로드하고 Lambda를 직접 호출하는 Node.js 웹 예제입니다.

```bash
cd server
npm run web
```

브라우저 접속: `http://localhost:3000`

필요 환경 변수:

```env
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=polly-bucket-edumgt
LAMBDA_COMPARE_UPLOAD_FUNCTION=rekognition-face-compare-upload
LAMBDA_TEXT_FUNCTION=rekognition-text-detect
```
### 오류의 경우 필요한 확인

```
aws sts get-caller-identity --region ap-northeast-2
aws lambda list-functions --region ap-northeast-2 --query "Functions[?FunctionName=='rekognition-face-compare-upload'].FunctionName" --output text
aws lambda get-function --region ap-northeast-2 --function-name rekognition-face-compare-upload
```


- **이미지 유사성 비교**: source/target 이미지를 업로드해 CompareFaces Lambda 호출
- **텍스트 추출**: 단일 이미지를 업로드해 DetectText Lambda 호출

## 5) Lambda 배포 자동화 (핵심)

`scripts/aws_batch_ops.sh`가 Lambda 실습용 명령을 제공합니다.

### 5-1. 기본 배치 명령

```bash
# 버킷 초기화(없으면 생성, 암호화/lifecycle 적용)
./scripts/aws_batch_ops.sh init

# 샘플 파일 업로드(face1~6 + sample)
./scripts/aws_batch_ops.sh upload

# Lambda 배포 zip 생성
./scripts/aws_batch_ops.sh lambda-package
```

### 5-2. Lambda 함수 생성/업데이트

최초 생성 시 `LAMBDA_ROLE_ARN`이 필요합니다.

```
cat > trust-lambda.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
```
---
```
aws iam create-role \
  --role-name rekognition-lambda-role \
  --assume-role-policy-document file://trust-lambda.json
```
```
aws iam attach-role-policy \
  --role-name rekognition-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

---

```bash
export AWS_REGION=ap-northeast-2
export S3_BUCKET_NAME=polly-bucket-edumgt
export LAMBDA_ROLE_ARN=arn:aws:iam::086015456585:role/rekognition-lambda-role

./scripts/aws_batch_ops.sh lambda-deploy
```

자동으로 아래 함수가 생성(또는 업데이트)됩니다.

- `rekognition-face-upload` (`lambda/uploadFacesHandler.handler`)
- `rekognition-face-compare` (`lambda/compareFacesHandler.handler`)
- `rekognition-face-compare-upload` (`lambda/compareUploadedFacesHandler.handler`)
- `rekognition-text-detect` (`lambda/detectTextHandler.handler`)

---
```
aws lambda get-function-configuration \
  --region ap-northeast-2 \
  --function-name rekognition-face-upload \
  --query '{State:State, LastUpdateStatus:LastUpdateStatus, Reason:LastUpdateStatusReason}' \
  --output table
```


### 5-3. Lambda 호출 및 결과 파일 확인

```bash
./scripts/aws_batch_ops.sh lambda-invoke
```

결과 파일:

- `batch-work/upload-result.json`
- `batch-work/compare-result.json`

---
```
root@DESKTOP-D6A344Q:/home/AI-AWS-Rekognition# aws lambda get-function-configuration \
  --region ap-northeast-2 \
  --function-name rekognition-face-compare \
  --query '{Runtime:Runtime, Handler:Handler, Role:Role, Timeout:Timeout, MemorySize:MemorySize}' \
  --output table
--------------------------------------------------------------------------
|                        GetFunctionConfiguration                        |
+------------+-----------------------------------------------------------+
|  Handler   |  lambda/compareFacesHandler.handler                       |
|  MemorySize|  256                                                      |
|  Role      |  arn:aws:iam::086015456585:role/rekognition-lambda-role   |
|  Runtime   |  nodejs18.x                                               |
|  Timeout   |  30                                                       |
+------------+-----------------------------------------------------------+
root@DESKTOP-D6A344Q:/home/AI-AWS-Rekognition# 
```
---
```
aws lambda create-function \
  --region ap-northeast-2 \
  --function-name rekognition-face-compare-upload \
  --runtime nodejs24.x \
  --handler lambda/compareFacesHandler.handler \
  --role arn:aws:iam::086015456585:role/rekognition-lambda-role \
  --timeout 5 \
  --memory-size 128 \
  --zip-file fileb://./batch-work/lambda-compare-upload.zip
```
---
```
aws lambda get-function --region ap-northeast-2 --function-name rekognition-face-compare-upload
```
---
```
aws lambda get-function-configuration \
  --region ap-northeast-2 \
  --function-name rekognition-face-upload \
  --query 'Environment.Variables' \
  --output json
```
---
```
aws lambda update-function-configuration \
  --region ap-northeast-2 \
  --function-name rekognition-face-compare-upload \
  --environment "Variables={S3_BUCKET_NAME=polly-bucket-edumgt}"

aws lambda wait function-updated \
  --region ap-northeast-2 \
  --function-name rekognition-face-compare-upload
```

### 5-4. 실습 원클릭 파이프라인

```bash
./scripts/aws_batch_ops.sh lab-all
```

실행 순서:

1. `init`
2. `upload`
3. `lambda-deploy`
4. `lambda-invoke`
5. `report`

---

## 6) 스크립트 환경 변수 상세

- `AWS_PROFILE`: AWS CLI 프로파일 사용 시 지정
- `AWS_REGION`: 리전
- `S3_BUCKET_NAME`: 버킷명(기본 `polly-bucket-edumgt`)
- `UPLOAD_DIR`: 샘플 이미지 소스 경로(기본 `./server`)
- `WORK_DIR`: zip/리포트 출력 경로(기본 `./batch-work`)
- `LAMBDA_ROLE_ARN`: Lambda 생성 시 필요
- `LAMBDA_UPLOAD_FUNCTION`: 업로드 함수명 기본값
- `LAMBDA_COMPARE_FUNCTION`: 샘플 face1~6 비교 함수명 기본값
- `LAMBDA_COMPARE_UPLOAD_FUNCTION`: 웹 업로드 이미지 비교 함수명 기본값
- `LAMBDA_TEXT_FUNCTION`: 웹 텍스트 추출 함수명 기본값

---

## 7) 실습 체크리스트

### “임계값 80% 기준으로 98.47% 일치 → 동일 인물로 판단”
### “임계값 80% 기준으로 최대 62.10% → 동일 인물로 보기 어려움”


- [ ] `aws sts get-caller-identity` 정상 응답
- [ ] `init` 후 버킷 암호화, lifecycle 정책 적용 확인
- [ ] `upload` 후 `training/face1~6.png` 존재 확인
- [ ] `lambda-deploy` 성공 로그 확인
- [ ] `lambda-invoke` 결과 JSON에서 유사도 값 확인
- [ ] `report` 파일 생성 확인

---

## 8) 트러블슈팅

1. **Lambda 생성 실패 (`AccessDenied`)**
   - `LAMBDA_ROLE_ARN`의 신뢰 정책(Trust Policy)에 `lambda.amazonaws.com` 포함 여부 확인

2. **`InvalidParameterValueException` (핸들러/런타임 오류)**
   - 핸들러 문자열이 아래와 일치하는지 확인
     - `lambda/uploadFacesHandler.handler`
     - `lambda/compareFacesHandler.handler`


### 내일 체크 대상
---
```
{
  "errorType": "Runtime.ImportModuleError",
  "errorMessage": "Error: Cannot find module 'compareFacesHandler'\nRequire stack:\n- /var/runtime/index.mjs",
  "trace": [
    "Runtime.ImportModuleError: Error: Cannot find module 'compareFacesHandler'",
    "Require stack:",
    "- /var/runtime/index.mjs",
    "    at loadModule (file:///var/runtime/index.mjs:573:13)",
    "    at async UserFunctionLoader.load (file:///var/runtime/index.mjs:504:20)",
    "    at async createRuntime (file:///var/runtime/index.mjs:1217:52)",
    "    at async ignition (file:///var/runtime/index.mjs:1633:21)"
  ]
}
```
---
```
이 에러가 왜 나는지(핸들러 경로/파일명/번들링/ESM·CJS 불일치)부터 짚고, Lambda에서 바로 동작하는 정답 핸들러 설정 + 파일 구조 + 빌드/배포 체크리스트를 한 번에 정리해줄게요.

24s 동안 생각함

이 에러는 Lambda가 “compareFacesHandler”라는 모듈(파일)을 런타임에서 못 찾는다는 뜻이에요. 거의 항상 아래 4가지 중 하나입니다.

1) Handler 값이 잘못됨 (가장 흔함)

Lambda의 Handler는 파일경로.익스포트이름 형식이어야 해요.

✅ 올바른 예

파일이 루트에 있고 export가 handler라면
Handler = compareFacesHandler.handler

파일이 src/compareFacesHandler.js라면
Handler = src/compareFacesHandler.handler

빌드 결과가 dist/compareFacesHandler.js라면
Handler = dist/compareFacesHandler.handler

❌ 잘못된 예

compareFacesHandler (점 없이 파일만 적음) → 런타임이 “패키지 모듈”처럼 해석해서 못 찾는 경우가 많음

2) 배포 zip 안에 파일이 “루트”에 없거나, 경로가 한 단계 더 들어가 있음

Lambda는 /var/task(zip 풀린 최상위) 기준으로 핸들러 파일을 찾습니다.

흔한 실수

zip 구조가 이렇게 됨:

function.zip
  my-project/
    compareFacesHandler.js
    package.json

→ Lambda는 루트에 compareFacesHandler.js가 없어서 못 찾음

✅ 올바른 zip 구조
function.zip
  compareFacesHandler.js
  package.json
  node_modules/...
✅ zip 만들 때 추천 커맨드

빌드 산출물이 dist/에 있다면:

cd dist
zip -r ../function.zip .

zip -r function.zip dist 처럼 “폴더째” 넣으면 한 단계 더 들어가서 깨지는 경우가 많아요.

3) 파일 확장자/ESM(CJS) 방식이 핸들러와 안 맞음

런타임이 index.mjs로 부팅되는 건 정상이고, 당신 코드가 ESM이든 CJS든 맞춰주면 돼요.

✅ CommonJS 방식(가장 무난)

compareFacesHandler.js

exports.handler = async (event) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

Handler: compareFacesHandler.handler

✅ ESM 방식

파일 확장자를 .mjs로 하거나

package.json에 "type": "module" 설정

compareFacesHandler.mjs

export const handler = async (event) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

Handler: compareFacesHandler.handler (확장자 없음)

TS로 빌드한다면 **최종 산출물(.js)이 어디에 생기는지(dist 등)**와 Handler 경로가 반드시 일치해야 합니다.

4) 대소문자 불일치 (리눅스는 대소문자 구분)

로컬(Windows/Mac)에서는 통과해도, Lambda(Linux)는 구분합니다.

파일명: compareFacesHandler.js

Handler: compareFacesHandler.handler
이 둘이 철자/대소문자까지 정확히 같아야 해요.

빠른 해결 순서 (이대로 하면 대부분 끝)

Lambda 설정 → Handler를 compareFacesHandler.handler (또는 실제 폴더 경로 포함)로 수정

배포 zip을 열어보고 **루트에 compareFacesHandler.js(또는 dist/… 경로)**가 실제로 있는지 확인

코드가 CJS면 exports.handler, ESM이면 export const handler인지 확인 + package.json type/확장자 확인

파일명 대소문자 확인

원하면, 지금 프로젝트의 실제 파일 트리(핸들러 파일 위치) + Lambda의 Handler 설정 값 + 빌드/배포 방식(SAM/CDK/Serverless/콘솔 zip) 이 3가지만 붙여주면, 당신 상황에 맞는 “정답 Handler 값 + 올바른 zip 커맨드”를 딱 한 줄로 확정해줄게요.
```

3. **S3 업로드 실패**
   - `S3_BUCKET_NAME`, 리전, 버킷 정책, 퍼블릭 차단과 무관한 IAM 권한 확인

4. **유사도 결과가 0 또는 낮음**
   - 입력 이미지 품질, 얼굴 정면 여부, 조명 조건을 조정
   - `SIMILARITY_THRESHOLD`를 70~90 범위에서 실험

---

## 9) 비용/보안 정리

실습 후 반드시 아래를 수행하세요.

- 불필요한 Lambda 함수 삭제
- 테스트 객체 정리: `./scripts/aws_batch_ops.sh cleanup`
- Access Key 미사용 시 비활성화/삭제
- CloudWatch 로그 보존 기간 설정

---

## 10) 참고

- Amazon Rekognition Docs: https://docs.aws.amazon.com/rekognition/
- AWS Lambda Docs: https://docs.aws.amazon.com/lambda/
- AWS CLI Docs: https://docs.aws.amazon.com/cli/
