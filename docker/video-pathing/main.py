import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from tracking_service import track_video


class TrackFileRequest(BaseModel):
    source_video_path: str = Field(..., description='Absolute path to the input video inside the container')
    output_video_path: Optional[str] = Field(default=None, description='Optional absolute path for the annotated output video')


app = FastAPI(
    title='YOLOv9 + ByteTrack Video Pathing',
    version='1.0.0',
    description='Dockerized people-pathing API that can replace Amazon Rekognition Video People Pathing.',
)


@app.get('/health')
def health() -> dict:
    return {'status': 'ok'}


@app.post('/track/file')
def track_file(payload: TrackFileRequest) -> dict:
    source_path = Path(payload.source_video_path).expanduser().resolve()
    if not source_path.is_file():
        raise HTTPException(status_code=400, detail=f'Video file not found: {source_path}')

    output_path = None
    if payload.output_video_path:
        output_path = Path(payload.output_video_path).expanduser().resolve()
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
