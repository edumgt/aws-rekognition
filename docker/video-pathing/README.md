# YOLOv9 + ByteTrack Video Pathing

이 디렉터리는 Amazon Rekognition **Video People Pathing** 대체 용도의 Docker 기반 추론 서비스를 제공합니다.

## 구성

- **YOLOv9**: 사람(person) 객체 검출
- **ByteTrack**: 프레임 간 동일 인물 추적
- **FastAPI**: 로컬/사내 환경에서 바로 호출 가능한 HTTP API
- **Docker**: PyTorch CUDA 런타임 기반 배포

## 준비물

1. `models/` 디렉터리에 YOLOv9 weight 파일을 두거나
2. `YOLOV9_WEIGHTS_URL` 환경 변수에 다운로드 URL을 지정합니다.

기본 weight 경로는 `/models/yolov9-c.pt` 입니다.

## 실행

```bash
cd docker/video-pathing
docker compose up --build
```

## API

### 1. 컨테이너 내부 파일 경로 기반 실행

```bash
curl -X POST http://localhost:8080/track/file \
  -H 'Content-Type: application/json' \
  -d '{
    "source_video_path": "/data/people.mp4",
    "output_video_path": "/tmp/video-outputs/people-tracked.mp4"
  }'
```

`/track/file` 엔드포인트는 기본적으로 `/data` 아래 입력 파일과 `/tmp/video-outputs` 아래 출력 경로만 허용합니다.

### 2. 파일 업로드 기반 실행

```bash
curl -X POST http://localhost:8080/track/upload \
  -F 'file=@/absolute/path/to/people.mp4'
```

## 결과

응답 JSON에는 아래 정보가 포함됩니다.

- `annotated_video_path`: 추적 박스와 이동 경로가 그려진 출력 비디오
- `tracks_json_path`: 트랙별 좌표 시퀀스가 저장된 JSON 파일
- `summary.track_count`: 감지된 사람 트랙 수
- `tracks[].points[]`: 프레임별 사람 이동 좌표 `(x, y)`

## 주요 환경 변수

- `YOLO_DEVICE`: `cpu`, `cuda:0` 등
- `YOLOV9_WEIGHTS`: 모델 weight 경로
- `YOLOV9_WEIGHTS_URL`: weight 자동 다운로드 URL
- `YOLO_CONFIDENCE_THRESHOLD`: 검출 임계값
- `YOLO_IOU_THRESHOLD`: NMS IoU 임계값
- `FRAME_STRIDE`: n 프레임마다 한 번만 추론
- `TRACK_BUFFER_SECONDS`: 추적 손실 허용 시간
- `TRACK_MATCHING_THRESHOLD`: ByteTrack 매칭 임계값
- `VIDEO_ALLOWED_SOURCE_ROOT`: `/track/file` 입력 허용 루트(기본 `/data`)
- `VIDEO_ALLOWED_OUTPUT_ROOT`: `/track/file` 출력 허용 루트(기본 `/tmp/video-outputs`)
