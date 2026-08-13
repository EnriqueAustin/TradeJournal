# Signal analytics microservice.
FROM python:3.12-slim

WORKDIR /app

# System deps kept minimal; pandas/numpy ship manylinux wheels.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
