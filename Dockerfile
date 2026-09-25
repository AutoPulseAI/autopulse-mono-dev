FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

# Scenario files for the Debug UI / `make ai-scenarios` (read from the working dir).
COPY scenarios/ ./scenarios/

ENV PORT=8100
EXPOSE 8100

# API process. The worker uses the same image with:
#   saq upsell_agent.worker.main.settings
CMD ["uvicorn", "upsell_agent.main:app", "--host", "0.0.0.0", "--port", "8100"]
