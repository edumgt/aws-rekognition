ARG BASE_IMAGE=pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    YOLOV9_REPO_DIR=/opt/yolov9 \
    VIDEO_INPUT_DIR=/tmp/video-inputs \
    VIDEO_OUTPUT_DIR=/tmp/video-outputs \
    YOLOV9_WEIGHTS=/models/yolov9-c.pt

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/WongKinYiu/yolov9.git ${YOLOV9_REPO_DIR} \
    && pip install -r ${YOLOV9_REPO_DIR}/requirements.txt

WORKDIR /app
COPY docker/video-pathing/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt
COPY docker/video-pathing/main.py ./main.py
COPY docker/video-pathing/tracking_service.py ./tracking_service.py

EXPOSE 8080
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
