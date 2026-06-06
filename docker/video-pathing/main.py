import os
import shutil
import tempfile
from pathlib import Path, PurePath
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from tracking_service import track_video


class TrackFileRequest(BaseModel):
    source_video_path: str = Field(..., description='Relative path to the input video under the allowed source root')
    output_video_path: Optional[str] = Field(default=None, description='Optional relative path for the annotated output video under the allowed output root')


app = FastAPI(
    title='YOLOv9 + ByteTrack Video Pathing',
    version='1.0.0',
    description='Dockerized people-pathing API that can replace Amazon Rekognition Video People Pathing.',
)


def _resolve_relative_path(raw_path: str, *, root_env_name: str, default_root: str) -> Path:
    root = Path(os.environ.get(root_env_name, default_root)).expanduser().resolve()
    relative_path = PurePath(raw_path)
    if relative_path.is_absolute():
        raise HTTPException(status_code=400, detail='Absolute paths are not allowed.')
    if not relative_path.parts:
        raise HTTPException(status_code=400, detail='Path is required.')

    resolved = (root.joinpath(*relative_path.parts)).resolve()
    if not resolved.is_relative_to(root):
        raise HTTPException(status_code=400, detail=f'Path must stay under {root}')

    return resolved


@app.get('/health')
def health() -> dict:
    return {'status': 'ok'}


@app.post('/track/file')
def track_file(payload: TrackFileRequest) -> dict:
    source_path = _resolve_relative_path(
        payload.source_video_path,
        root_env_name='VIDEO_ALLOWED_SOURCE_ROOT',
        default_root='/data',
    )
    if not source_path.is_file():
        raise HTTPException(status_code=400, detail=f'Video file not found: {source_path}')

    output_path = None
    if payload.output_video_path:
        output_path = _resolve_relative_path(
            payload.output_video_path,
            root_env_name='VIDEO_ALLOWED_OUTPUT_ROOT',
            default_root='/tmp/video-outputs',
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)

    return track_video(source_path=source_path, output_video_path=output_path)


@app.post('/track/upload')
async def track_upload(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or 'upload.mp4').suffix or '.mp4'
    input_dir = Path(os.environ.get('VIDEO_INPUT_DIR', '/tmp/video-inputs')).resolve()
    input_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(dir=input_dir, suffix=suffix, delete=False) as temp_file:
        shutil.copyfileobj(file.file, temp_file)
        source_path = Path(temp_file.name)

    try:
        return track_video(source_path=source_path)
    finally:
        source_path.unlink(missing_ok=True)
