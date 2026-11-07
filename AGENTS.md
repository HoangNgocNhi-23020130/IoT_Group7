# AI_CONTEXT: thông tin dự án để dán vào prompt cho AI

> Dán toàn bộ file này (hoặc phần liên quan) vào đầu cuộc hội thoại với AI, rồi thêm nhiệm vụ cụ thể.
> Công cụ như Claude Code đọc được file này trực tiếp nếu đổi tên thành `CLAUDE.md`.

## 1. Dự án
Hệ thống IoT giám sát ô nhiễm nước biển ven bờ: nhiều node đo phân tán, gateway, cloud tự xây, web console,
cảnh báo Telegram, và mô hình ML phát hiện bất thường rồi suy luận nguyên nhân nghi ngờ.
Đây là đồ án môn học (1 tháng, 3 người, ngân sách thấp), trình diễn bằng prototype fomex + bể nước.

## 2. Ràng buộc chấm điểm (phải tuân thủ)
- Phải là hệ thống IoT đủ khối: IoT nodes, IoT gateway, cloud/data center. Không phải hệ nhúng/tự động hóa.
- Tự xây IoT platform: phần mềm trên node, gateway, server và web console. KHÔNG dùng Blynk/ThingSpeak làm nền tảng chính.
- Có AI/ML phân tích dữ liệu và/hoặc triển khai cloud.
- Cần demo chạy ổn định, video 5–7 phút, báo cáo .docx/.pdf, tối đa 15 slide.

## 3. Kiến trúc
```
[ESP32 node x2] --MQTT--> [Gateway: Mosquitto + Python] --HTTPS (API key)--> [Cloud: FastAPI + PostgreSQL + ML]
                                                                              |--> Web console (REST/WebSocket)
                                                                              |--> Telegram bot (cảnh báo)
```
- Node: đọc nhiệt độ (DS18B20), pH, TDS/EC, độ đục qua ADS1115, tùy chọn cảm biến màu TCS34725.
- Gateway: kiểm tra bản tin, lọc nhiễu, đệm SQLite khi mất mạng, chuyển tiếp lên cloud, có thể chạy kiểm tra bất thường đơn giản.
- Cloud: lưu dữ liệu, chạy mô hình, tạo cảnh báo, phục vụ web.

## 4. Giao thức và dữ liệu
Topic: `marine/{node_id}/telemetry`, `marine/{node_id}/status` (LWT), `marine/{node_id}/cmd`. Chi tiết trong `docs/mqtt-topics.md`.
Telemetry payload (JSON):
`{"node_id","seq","ts"(ISO8601 UTC),"temp_c","ph","tds_ppm","turbidity_ntu","color":{"r","g","b"},"rssi"}`
Bảng: `nodes`, `measurements`, `alerts`. Chi tiết trong `docs/data-schema.md`.

## 5. Mô hình ML
- Bước 1: phát hiện bất thường (Isolation Forest trên cửa sổ trượt; có thể thêm LSTM autoencoder).
- Bước 2: phân loại nguyên nhân (Random Forest/XGBoost) với nhãn: `normal`, `domestic_sewage`, `acidic_industrial`, `algal_bloom`, `runoff_sediment`.
- Dữ liệu: tổng hợp (nền theo ngày đêm/thủy triều + sự kiện có nhãn) trộn với dữ liệu thật đo từ bể nước prototype.
- Lưu ý: cảm biến pH trôi dễ nhầm với ô nhiễm; cần xử lý hiệu chuẩn/drift.
- Đánh giá: precision/recall/F1, ma trận nhầm lẫn, so với ngưỡng cố định; kiểm tra train-on-synthetic/test-on-real.

## 6. Công nghệ
ESP32 + PlatformIO (Arduino), Mosquitto, Python 3.12, FastAPI, SQLAlchemy, PostgreSQL, scikit-learn, Docker Compose, web HTML/JS + Chart.js, Telegram Bot API.

## 7. Quy ước
- Python: type hints, PEP 8, không hardcode bí mật (dùng `.env`, `secrets.h` bị git-ignore).
- Code ngắn gọn, có xử lý lỗi và log; hàm chính có docstring.
- Commit theo dạng `feat:`, `fix:`, `docs:`; mỗi người làm trên nhánh riêng (`feat/firmware-*`, `feat/backend-*`, `feat/ml-*`).
- Mọi thay đổi định dạng bản tin phải cập nhật `docs/mqtt-topics.md` trước.

## 8. Cách viết prompt hiệu quả
1. Dán mục 1–6 liên quan + trạng thái hiện tại của file.
2. Nêu một nhiệm vụ cụ thể, đầu vào, đầu ra mong muốn, ràng buộc.
3. Yêu cầu giải thích ngắn lựa chọn và cách kiểm thử.
Mẫu prompt theo vai trò nằm trong `docs/prompts/`.
