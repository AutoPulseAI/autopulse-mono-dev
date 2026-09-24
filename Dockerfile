FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install --no-cache-dir .

ENV PORT=8100
EXPOSE 8100

CMD ["uvicorn", "upsell_agent.main:app", "--host", "0.0.0.0", "--port", "8100"]
