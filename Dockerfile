# ─────────────────────────────────────────────
# Stage 1: Build the React / Vite frontend
# ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Install dependencies first (layer-cached)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy source and build
COPY frontend/ ./
RUN npm run build          # outputs to frontend/dist


# ─────────────────────────────────────────────
# Stage 2: Python / Django backend
# ─────────────────────────────────────────────
FROM python:3.12-slim AS final

# Don't write .pyc files; don't buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (needed for gunicorn wheel compilation on some arches)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Backend source
COPY backend/ ./

# ── Drop in the compiled frontend ──────────────────────────────────────────
# Django is configured to serve the built React app via WhiteNoise.
# We copy the dist output into backend/frontend_dist/,
# then the updated settings.py tells STATICFILES_DIRS to include it,
# and the catch-all URL pattern serves index.html for any non-API route.
COPY --from=frontend-build /app/frontend/dist ./frontend_dist

# Collect static files (WhiteNoise CompressedManifestStaticFilesStorage)
RUN python manage.py collectstatic --noinput

# Expose the port Render / gunicorn will listen on
EXPOSE 8000

# Start gunicorn
CMD ["gunicorn", "eldcore.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
