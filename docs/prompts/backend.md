# Prompt mẫu: backend và gateway
Bối cảnh: dán mục 1–4, 6–7 của AI_CONTEXT.md.
Nhiệm vụ gateway: script Python subscribe marine/+/telemetry, kiểm tra schema, loại giá trị ngoài dải vật lý,
đệm SQLite, POST lô lên /api/v1/ingest kèm API key, retry exponential backoff.
Nhiệm vụ backend: FastAPI có /api/v1/ingest, /api/v1/nodes, /api/v1/measurements?node_id&from&to, /api/v1/alerts,
WebSocket đẩy dữ liệu mới, lưu PostgreSQL bằng SQLAlchemy, gửi Telegram khi có cảnh báo, nạp mô hình từ ml/models.
Kèm test bằng pytest và ví dụ lệnh curl.
