# Hệ Thống IoT Giám Sát Ô Nhiễm Nước Biển Ven Bờ & Suy Luận Nguyên Nhân Bằng Machine Learning

> Đồ án môn học Internet of Things (IoT) - Nhóm 7  
> Kiến trúc 3 tầng: **ESP32 Node $\rightarrow$ IoT Edge Gateway $\rightarrow$ FastAPI Cloud & Machine Learning $\rightarrow$ Web Console & Telegram Bot**.

---

## 1. Kiến Trúc Hệ Thống

```
[ESP32 Node 01 (Bể thử nghiệm)] ──┐
                                  ├──MQTT (QoS 1)──> [IoT Gateway: Mosquitto + Python]
[Python Virtual Node 02] ─────────┘                                 │
                                                             HTTPS POST (API Key)
                                                                    ▼
                                                    [Cloud: FastAPI + PostgreSQL + ML]
                                                           │                  │
                                                   WebSocket Stream      Telegram Bot
                                                           ▼                  ▼
                                                     [Web Console]     [Cảnh Báo Di Động]
```

- **IoT Nodes:** Đo Nhiệt độ (DS18B20), pH (4502C), TDS V1.0, Độ đục qua ADC 16-bit ADS1115. Lọc 10 mẫu trung vị cắt tỉa, đệm vòng RAM 200 bản tin.
- **IoT Gateway:** Mosquitto Broker + Python Gateway lọc biên vật lý, lưu đệm ngoại tuyến vào SQLite (Store-and-Forward) và đẩy dữ liệu theo lô lên Cloud.
- **Cloud Backend & ML:** FastAPI + PostgreSQL 16 + Mô hình ML 2 giai đoạn:
  - *Giai đoạn 1:* Isolation Forest phát hiện dị thường không giám sát.
  - *Giai đoạn 2:* Random Forest phân loại 5 nhóm nguyên nhân (`normal`, `acidic_industrial`, `domestic_sewage`, `algal_bloom`, `runoff_sediment`) đạt **98.79% Macro F1**.
- **Web Console & Telegram:** Bảng điều khiển thời gian thực Chart.js, cảnh báo chuông Web Audio API và tin nhắn Telegram khẩn cấp.

---

## 2. Cấu Trúc Thư Mục Dự Án

```
├── AGENTS.md                  # Hướng dẫn quy ước & bối cảnh dự án
├── README.md                  # Hướng dẫn cài đặt & vận hành hệ thống
├── docker-compose.yml         # Khởi chạy toàn bộ hệ thống bằng 1 lệnh
├── backend/                   # FastAPI Cloud Backend
│   ├── Dockerfile
│   ├── app/                   # Mã nguồn API, database, ML service, Telegram
│   └── tests/                 # Kiểm thử tự động API (pytest)
├── gateway/                   # IoT Edge Gateway
│   ├── Dockerfile
│   ├── app/gateway.py         # Lọc dữ liệu, đệm SQLite, HTTP forwarder
│   ├── mosquitto/             # Cấu hình Mosquitto MQTT Broker
│   └── tests/                 # Kiểm thử tự động Gateway (pytest)
├── ml/                        # Pipeline Trí tuệ nhân tạo
│   ├── data/synthetic/        # Dữ liệu tổng hợp vật lý 60 ngày
│   ├── models/                # File mô hình đã huấn luyện (marine_model.joblib)
│   └── src/                   # Sinh dữ liệu, trích xuất đặc trưng, huấn luyện & đánh giá
├── web/                       # Bảng điều khiển Web Console (HTML5/CSS/JS + Chart.js)
├── firmware/node/             # Firmware ESP32 (C++/Arduino PlatformIO)
├── scripts/
│   └── simulate_node.py       # Trạm ảo giả lập và bơm kịch bản ô nhiễm thực tế
└── docs/                      # Tài liệu kỹ thuật, báo cáo & slide thuyết trình
    ├── architecture.md        # Kiến trúc kỹ thuật chi tiết
    ├── data-schema.md         # Lược đồ cơ sở dữ liệu PostgreSQL
    ├── test-scenarios.md      # 5 kịch bản kiểm nghiệm bể nước
    ├── report/final_report.md # Báo cáo hoàn chỉnh đồ án môn học
    └── slides/presentation_outline.md # Dàn ý 15 slide thuyết trình
```

---

## 3. Hướng Dẫn Khởi Chạy Nhanh (Quick Start)

### 3.1. Khởi chạy toàn bộ hệ thống bằng Docker Compose (Khuyên dùng)
Chỉ cần 1 lệnh duy nhất để khởi động toàn bộ: PostgreSQL, Backend, Web Console, Mosquitto và Gateway:
```bash
# 1. Tạo file cấu hình môi trường từ mẫu
cp .env.example .env

# 2. Khởi chạy tất cả các dịch vụ nền tảng
docker compose up --build
```
- **Web Console Dashboard:** [http://localhost:8080](http://localhost:8080)
- **FastAPI Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check Endpoint:** [http://localhost:8000/health](http://localhost:8000/health)

---

### 3.2. Giả lập Trạm Ảo & Bơm Kịch Bản Ô Nhiễm (Virtual Node Simulator)
Mở một cửa sổ dòng lệnh mới và chạy script mô phỏng tương tác:
```bash
# Kích hoạt môi trường ảo (nếu chạy trên host)
source .venv/bin/activate

# Chạy trạm ảo node02 ở chế độ tương tác bàn phím
python scripts/simulate_node.py --node-id node02 --interval 3.0
```

**Bảng phím tắt điều khiển kịch bản trên bàn phím:**
- Phím `1` hoặc `r`: Trạng thái bình thường (*Normal Seawater Baseline*)
- Phím `2`: Xả thải axit công nghiệp (*Acidic Industrial Discharge* - $\text{pH} < 4.5$, cảnh báo đỏ)
- Phím `3`: Xả thải nước sinh hoạt (*Domestic Sewage Discharge* - TDS & độ đục tăng)
- Phím `4`: Tảo nở hoa / Thủy triều đỏ (*Algal Bloom* - $\text{pH} > 8.8$, sắc tố diệp lục xanh)
- Phím `5`: Nước lũ phù sa sau mưa (*Runoff Sediment* - Độ đục $> 150\text{ NTU}$, TDS tụt dốc)
- Phím `6`: Giả lập mất mạng đột ngột (Kích hoạt MQTT LWT `offline`)
- Phím `q`: Thoát mô phỏng an toàn

Hoặc chạy chế độ tự động xoay vòng kịch bản (*Auto Demo Mode* cho quay video 5-7 phút):
```bash
python scripts/simulate_node.py --mode auto --cycle-duration 25
```

---

### 3.3. Nạp Firmware Cho ESP32 Thật (Physical Hardware Node)
1. Cài đặt tiện ích mở rộng **PlatformIO IDE** trong VS Code.
2. Mở thư mục `firmware/node`.
3. Sao chép cấu hình bí mật:
   ```bash
   cp include/secrets.example.h include/secrets.h
   ```
4. Điền tên mạng Wi-Fi, mật khẩu và IP của máy tính chạy Mosquitto Broker vào `secrets.h`.
5. Cắm ESP32 vào cổng USB và ấn nút **Build & Upload** trên thanh công cụ PlatformIO.

---

### 3.4. Chạy Bộ Kiểm Thử Tự Động (Automated Testing)
```bash
source .venv/bin/activate
pytest
```
*Kết quả kiểm thử: Toàn bộ 11/11 bài test API, xác thực dữ liệu và bộ đệm SQLite đều vượt qua.*

---

## 4. Phân Công Thành Viên Nhóm 7
- **Thành viên 1:** Thiết kế mô hình phần cứng, hộp Fomex, lắp ráp cảm biến và lập trình firmware ESP32.
- **Thành viên 2:** Thiết kế IoT Edge Gateway, cấu hình Mosquitto, xây dựng Cloud FastAPI, PostgreSQL và Web Console.
- **Thành viên 3:** Thuật toán Machine Learning (Isolation Forest + Random Forest), sinh dữ liệu, viết báo cáo môn học và slide thuyết trình.
