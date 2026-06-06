import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import supervision as sv
import torch


MODEL_CACHE: Dict[str, Any] = {}


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f'Invalid float value for {name}: {value}') from error


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f'Invalid integer value for {name}: {value}') from error



def _ensure_weights(weights_path: Path) -> None:
    if weights_path.is_file():
        return

    weights_url = os.environ.get('YOLOV9_WEIGHTS_URL')
    if not weights_url:
        raise FileNotFoundError(
            f'Model weights not found: {weights_path}. Set YOLOV9_WEIGHTS or provide YOLOV9_WEIGHTS_URL.'
        )

    weights_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(weights_url, weights_path)



def _load_model() -> Any:
    repo_dir = Path(os.environ.get('YOLOV9_REPO_DIR', '/opt/yolov9')).resolve()
    weights_path = Path(os.environ.get('YOLOV9_WEIGHTS', '/models/yolov9-c.pt')).resolve()
    device = os.environ.get('YOLO_DEVICE', 'cpu')
    cache_key = f'{repo_dir}:{weights_path}:{device}'

    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    if not repo_dir.is_dir():
        raise FileNotFoundError(f'YOLOv9 repository not found: {repo_dir}')

    _ensure_weights(weights_path)

    if str(repo_dir) not in sys.path:
        sys.path.insert(0, str(repo_dir))

    model = torch.hub.load(str(repo_dir), 'custom', path=str(weights_path), source='local', autoshape=True)
    model.to(device)
    model.conf = _env_float('YOLO_CONFIDENCE_THRESHOLD', 0.25)
    model.iou = _env_float('YOLO_IOU_THRESHOLD', 0.45)
    MODEL_CACHE[cache_key] = model
    return model



def _build_tracker(fps: float) -> sv.ByteTrack:
    return sv.ByteTrack(
        track_activation_threshold=_env_float('TRACK_ACTIVATION_THRESHOLD', 0.25),
        lost_track_buffer=_env_int('TRACK_BUFFER_SECONDS', 2) * max(int(fps or 1), 1),
        minimum_matching_threshold=_env_float('TRACK_MATCHING_THRESHOLD', 0.8),
        frame_rate=max(int(fps or 1), 1),
    )



def _empty_detections() -> sv.Detections:
    return sv.Detections(
        xyxy=np.empty((0, 4), dtype=np.float32),
        confidence=np.array([], dtype=np.float32),
        class_id=np.array([], dtype=np.int32),
    )



def _person_detections(results: Any) -> sv.Detections:
    prediction = results.xyxy[0]
    if prediction is None or len(prediction) == 0:
        return _empty_detections()

    rows = prediction.detach().cpu().numpy()
    person_class_id = _env_int('YOLO_PERSON_CLASS_ID', 0)
    rows = rows[rows[:, 5].astype(int) == person_class_id]
    if rows.size == 0:
        return _empty_detections()

    return sv.Detections(
        xyxy=rows[:, :4].astype(np.float32),
        confidence=rows[:, 4].astype(np.float32),
        class_id=rows[:, 5].astype(np.int32),
    )



def _draw_paths(frame: np.ndarray, tracks: Dict[int, List[Dict[str, Any]]]) -> np.ndarray:
    annotated = frame.copy()
    for track_id, points in tracks.items():
        if len(points) < 2:
            continue

        line = np.array([[int(point['x']), int(point['y'])] for point in points], dtype=np.int32)
        cv2.polylines(annotated, [line], isClosed=False, color=(0, 255, 255), thickness=2)
        last_x = int(points[-1]['x'])
        last_y = int(points[-1]['y'])
        cv2.putText(
            annotated,
            f'#{track_id}',
            (last_x + 6, last_y - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 255),
            2,
            cv2.LINE_AA,
        )
    return annotated



def track_video(source_path: Path, output_video_path: Optional[Path] = None) -> Dict[str, Any]:
    model = _load_model()
    source_path = source_path.resolve()
    output_dir = Path(os.environ.get('VIDEO_OUTPUT_DIR', '/tmp/video-outputs')).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if output_video_path is None:
        output_video_path = output_dir / f'{source_path.stem}-tracked.mp4'
    output_video_path.parent.mkdir(parents=True, exist_ok=True)
    output_json_path = output_dir / f'{source_path.stem}-tracks.json'

    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        raise ValueError(f'Unable to open video: {source_path}')

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    tracker = _build_tracker(fps)
    frame_stride = max(_env_int('FRAME_STRIDE', 1), 1)
    img_size = _env_int('YOLO_IMAGE_SIZE', 640)

    writer = cv2.VideoWriter(
        str(output_video_path),
        cv2.VideoWriter_fourcc(*'mp4v'),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        cap.release()
        raise ValueError(f'Unable to create output video: {output_video_path}')

    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator(text_position=sv.Position.TOP_LEFT)
    tracks: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    frame_index = 0
    processed_frames = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_index += 1
            if frame_index % frame_stride != 0:
                writer.write(frame)
                continue

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = model(rgb_frame, size=img_size)
            detections = _person_detections(results)
            detections = tracker.update_with_detections(detections)
            processed_frames += 1

            labels = []
            detection_count = len(detections.xyxy)
            tracker_ids = (
                detections.tracker_id
                if detections.tracker_id is not None
                else np.full(detection_count, -1, dtype=np.int32)
            )
            confidences = (
                detections.confidence
                if detections.confidence is not None
                else np.zeros(detection_count, dtype=np.float32)
            )
            if len(tracker_ids) != detection_count or len(confidences) != detection_count:
                raise ValueError(
                    'Tracker output is inconsistent: '
                    f'expected {detection_count} xyxy items, '
                    f'got {len(tracker_ids)} tracker_ids and {len(confidences)} confidences.'
                )

            for index, xyxy in enumerate(detections.xyxy):
                confidence = float(confidences[index])
                tracker_id = int(tracker_ids[index])
                if tracker_id < 0:
                    continue
                x1, y1, x2, y2 = xyxy.tolist()
                center_x = round((x1 + x2) / 2, 2)
                foot_y = round(y2, 2)
                tracks[tracker_id].append(
                    {
                        'frame': frame_index,
                        'x': center_x,
                        'y': foot_y,
                        'confidence': round(confidence, 4),
                    }
                )
                labels.append(f'#{tracker_id} {confidence:.2f}')

            annotated = box_annotator.annotate(scene=frame.copy(), detections=detections)
            annotated = label_annotator.annotate(scene=annotated, detections=detections, labels=labels)
            annotated = _draw_paths(annotated, tracks)
            writer.write(annotated)
    finally:
        cap.release()
        writer.release()

    track_items = [
        {
            'track_id': track_id,
            'points': points,
            'start_frame': points[0]['frame'],
            'end_frame': points[-1]['frame'],
            'path_length': len(points),
        }
        for track_id, points in sorted(tracks.items())
        if points
    ]

    result = {
        'source_video_path': str(source_path),
        'annotated_video_path': str(output_video_path),
        'tracks_json_path': str(output_json_path),
        'metadata': {
            'fps': round(float(fps), 2),
            'width': width,
            'height': height,
            'total_frames': total_frames,
            'processed_frames': processed_frames,
            'frame_stride': frame_stride,
        },
        'summary': {
            'track_count': len(track_items),
            'max_path_points': max((item['path_length'] for item in track_items), default=0),
        },
        'tracks': track_items,
    }

    output_json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
