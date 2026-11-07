# Marine Pollution IoT

Hệ thống IoT giám sát chất lượng nước biển ven bờ, cảnh báo ô nhiễm và phân tích nguyên nhân bằng học máy.
Đồ án môn IoT, nhóm 3 người.

## Kiến trúc
Node (ESP32) -> MQTT -> Gateway -> HTTPS -> Cloud (FastAPI, PostgreSQL, ML) -> Web console + Telegram.

## Cấu trúc thư mục
| Thư mục | Nội dung |
|---|---|
| `firmware/node` | Firmware ESP32 (PlatformIO) |
| `gateway` | Mosquitto + script Python tiền xử lý, đệm, chuyển tiếp |
| `backend` | API FastAPI, cơ sở dữ liệu, cảnh báo, suy luận ML |
| `ml` | Sinh dữ liệu tổng hợp, huấn luyện, đánh giá |
| `web` | Web console |
| `prototype` | Sơ đồ đấu nối, ảnh, danh mục linh kiện |
| `docs` | Kiến trúc, MQTT, schema, kịch bản test, báo cáo, slide, prompt cho AI |

## Chạy nhanh (cloud)
```
cp .env.example .env
docker compose up --build
```
API: http://localhost:8000/health, Web: http://localhost:8080

## Phân công
- A: phần cứng, firmware, prototype
- B: gateway, backend, web, cloud
- C: dữ liệu, ML, báo cáo, slide, video
