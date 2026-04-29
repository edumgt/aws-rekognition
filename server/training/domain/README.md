# 도메인 학습 이미지 폴더

이 폴더는 Amazon Rekognition Custom Labels 학습에 사용할 도메인 이미지를 저장하는 곳입니다.

## 폴더 구조 권장 예시

```
domain/
  defect/        # 불량 이미지 (클래스당 최소 10장)
    img001.jpg
    img002.jpg
    ...
  normal/        # 정상 이미지 (클래스당 최소 10장)
    img101.jpg
    img102.jpg
    ...
  sample-manifest.json  # S3 manifest 예시 파일
```

## 사용 방법

1. 도메인 이미지를 클래스별 하위 폴더에 저장합니다.
2. `sample-manifest.json`을 참고해 실제 S3 경로로 manifest를 작성합니다.
3. manifest와 이미지를 S3에 업로드합니다.
4. `scripts/aws_batch_ops.sh custom-labels-train` 또는 Lambda `customLabelsHandler`를 통해 학습을 시작합니다.

## 주의 사항

- 실제 이미지 파일은 이 저장소에 커밋하지 마세요 (`.gitignore`에 `*.jpg`, `*.jpeg` 추가 권장).
- `sample-manifest.json`의 `s3://my-bucket/...` 경로를 실제 버킷 경로로 교체해야 합니다.
