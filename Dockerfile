FROM python:3.11-slim

# Prevent Python from buffering stdout/stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Install system libraries needed by GDAL / GeoPandas / Fiona
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Step 1: Install CPU-only PyTorch first (saves ~2GB vs default CUDA wheel)
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Step 2: Install remaining dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Step 3: Copy application source, data, artifacts, and scripts
COPY src/ ./src/
COPY data/ ./data/
COPY artifacts/ ./artifacts/
COPY scripts/ ./scripts/
COPY web/ ./web/

# Expose the default port (Render will inject $PORT)
EXPOSE 8000

# Start Uvicorn bound to 0.0.0.0 and dynamically use $PORT if set by Render
CMD ["sh", "-c", "uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
