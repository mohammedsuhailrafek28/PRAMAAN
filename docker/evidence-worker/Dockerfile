# Sandboxed document-reading worker. Build context: ./python
#   docker build -t pramaan-evidence-worker:local -f docker/evidence-worker/Dockerfile python
# It is meant to be run ONLY with the flags in src/modules/evidenceIntelligence/worker-container.ts (no network, read-only
# root, non-root user, no capabilities, pid/memory limits, tmpfs scratch, no volumes, no environment). The file arrives on
# stdin and the JSON result leaves on stdout; nothing else crosses the boundary.
FROM python:3.12-slim-bookworm

COPY requirements.txt /tmp/requirements.txt
# RapidOCR depends on the GUI build of OpenCV; the headless build needs no libGL/X11 and keeps the image small.
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && pip uninstall -y opencv-python \
 && pip install --no-cache-dir opencv-python-headless \
 && rm /tmp/requirements.txt \
 && groupadd --gid 10001 worker \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin worker

COPY --chown=root:root evidence_worker /app/evidence_worker
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 OMP_NUM_THREADS=2 HOME=/tmp
USER 10001:10001
ENTRYPOINT ["python", "-m", "evidence_worker.worker"]
