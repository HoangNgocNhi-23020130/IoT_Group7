# Dàn Ý Báo Cáo Thuyết Trình (Tối Đa 15 Slide)

**Đề tài:** Hệ Thống IoT Giám Sát Ô Nhiễm Nước Biển Ven Bờ Kết Hợp Machine Learning Suy Luận Nguyên Nhân  
**Học phần:** Internet of Things (IoT)  
**Nhóm thực hiện:** Nhóm 7  

---

### Slide 1: Trang Tiêu Đề & Giới Thiệu
- **Tiêu đề:** HỆ THỐNG IOT GIÁM SÁT Ô NHIỄM NƯỚC BIỂN VEN BỜ VÀ SUY LUẬN NGUYÊN NHÂN BẰNG MACHINE LEARNING
- **Phụ đề:** Thiết kế hệ thống 3 lớp: ESP32 Sensing Node - Edge Gateway - FastAPI Cloud & AI
- **Thành viên nhóm:** [Tên thành viên 1] (Firmware & Hardware), [Tên thành viên 2] (Gateway & Cloud Backend), [Tên thành viên 3] (Machine Learning & Data Science)
- **Giảng viên hướng dẫn:** [Tên Giảng Viên]
- **Thời gian báo cáo:** Tháng 11/2026

---

### Slide 2: Đặt Vấn Đề & Tính Cấp Thiết
- **Bối cảnh thực tế:** Ô nhiễm vùng biển ven bờ, cảng cá và khu công nghiệp ven biển diễn biến phức tạp; các sự cố xả thải trộm hóa chất thường diễn ra vào ban đêm.
- **Thực trạng giải pháp hiện nay:**
  - Lấy mẫu thủ công truyền thống: Tốn kém nhân lực, độ trễ phân tích trong phòng lab từ vài ngày đến hàng tuần.
  - Các hệ thống quan trắc dùng ngưỡng tĩnh (Fixed Threshold): Thường xuyên báo động giả do hiện tượng nhật triều tự nhiên và sinh vật phù du; không thể chỉ ra căn nguyên sự cố.
- **Tính cấp thiết:** Cần một giải pháp IoT tự chủ, chi phí thấp, phản ứng thời gian thực và tự động suy luận nguyên nhân nghi ngờ.

---

### Slide 3: Mục Tiêu Đề Tài & Tiêu Chí Chấm Điểm
- **Mục tiêu chính:** Xây dựng hệ thống IoT hoàn chỉnh từ cảm biến đến đám mây phục vụ giám sát môi trường nước biển ven bờ.
- **Tuân thủ tiêu chí đánh giá môn học:**
  - Đầy đủ 3 khối chức năng: IoT Nodes, IoT Edge Gateway, Cloud Data Center.
  - **Tự phát triển nền tảng (Self-built IoT Platform):** Toàn bộ firmware, dịch vụ gateway, backend API và web console do nhóm tự lập trình (không phụ thuộc vào Blynk hay ThingSpeak).
  - Tích hợp mô hình AI/ML phát hiện bất thường và phân loại nguyên nhân.
  - Kiểm nghiệm bằng mô hình thực tế (Prototype bể nước + Fomex) và bộ kịch bản kiểm thử rõ ràng.

---

### Slide 4: Tổng Quan Kiến Trúc Hệ Thống (3-Tier Architecture)
- **Sơ đồ khối 3 tầng:**
  - `[ESP32 Node 01 (Vật lý) + Node 02 (Trạm ảo)]` $\xrightarrow{\text{MQTT (QoS 1)}}$ `[Edge Gateway: Mosquitto + Python]`
  - `[Edge Gateway]` $\xrightarrow{\text{HTTPS POST (API Key)}}$ `[Cloud: FastAPI + PostgreSQL + ML]`
  - `[Cloud]` $\xrightarrow{\text{WebSocket / REST / Bot API}}$ `[Web Dashboard + Telegram Alerts]`
- **Điểm nổi bật:**
  - Khả năng mở rộng mạng phân tán (hỗ trợ nhiều node đồng thời).
  - Tách bạch rõ ràng giữa mạng cảm biến cục bộ (Local IoT Mesh) và mạng diện rộng (WAN/Internet).

---

### Slide 5: Thiết Kế Trạm Đo Phân Tán (IoT Sensing Node)
- **Bộ vi điều khiển:** ESP32 Dual-Core 240MHz, tích hợp Wi-Fi 802.11 b/g/n.
- **Module ADC chuyên dụng 16-bit ADS1115 (I2C):**
  - Giải quyết triệt để lỗi phi tuyến tính và vùng mù của ADC nội ESP32.
  - Phân giải tín hiệu điện áp siêu nhỏ ($0.125\text{mV/bit}$), bảo vệ ESP32 trước cảm biến 5V.
- **Hệ cảm biến tích hợp:**
  - Cảm biến nhiệt độ DS18B20 vỏ inox chống nước (OneWire).
  - Cảm biến độ pH 4502C (Điện cực BNC gel không sạc lại).
  - Cảm biến tổng chất rắn hòa tan TDS V1.0 (Bù nhiệt độ động).
  - Cảm biến quang học đo độ đục Turbidity V1.0.

---

### Slide 6: Xử Lý Tín Hiệu Tại Biên & Bù Trôi Cảm Biến
- **Thuật toán lọc trung vị cắt tỉa (Trimmed-Mean Filter):**
  - Đọc 10 mẫu điện áp liên tiếp, loại bỏ 2 đỉnh cao nhất và 2 đáy thấp nhất, lấy trung bình 6 mẫu.
  - Khử triệt để 99% gai nhiễu điện áp do sóng biển vỗ vào đầu dò.
- **Bù trôi nhiệt độ (Thermal Drift Compensation):**
  - Tự động hiệu chỉnh hệ số Nernst theo nhiệt độ tức thời từ DS18B20.
- **Đệm vòng bộ nhớ RAM (Circular Buffer):**
  - Lưu trữ tối đa 200 bản tin trong RAM khi mất sóng Wi-Fi; tự động xả đệm khi phục hồi mạng.
- **Cơ chế LWT (Last Will and Testament):**
  - Báo cáo lập tức trạng thái mất nguồn/đứt kết nối tới Gateway.

---

### Slide 7: Thiết Kế Cổng Giao Tiếp Biên (IoT Edge Gateway)
- **Vai trò trung tâm:** Nằm giữa mạng cảm biến và máy chủ Cloud.
- **Mosquitto MQTT Broker nội bộ:**
  - Tiếp nhận các luồng telemetry `marine/+/telemetry` với chất lượng dịch vụ QoS 1.
  - Quản lý lệnh điều khiển trạm ngược chiều `marine/+/cmd`.
- **Dịch vụ Gateway Core (Python 3.12):**
  - Kiểm tra tính hợp lệ của cấu trúc JSON và giới hạn vật lý môi trường biển (Physical Bounds Validation: $T \in [-10, 60]^\circ\text{C}$, $\text{pH} \in [0, 14]$, $\text{TDS} \in [0, 50000]\text{ppm}$).
  - Loại bỏ các gói tin rác phát sinh do hỏng hóc phần cứng trước khi đẩy lên Cloud.

---

### Slide 8: Cơ Chế Chịu Lỗi Ngoại Tuyến (Store-and-Forward)
- **Bộ đệm bền vững SQLite (Persistent SQLite Buffer):**
  - Thiết kế an toàn luồng (`threading.Lock`), dung lượng đệm lên tới 5,000 bản ghi.
  - Mọi bản tin hợp lệ đều được ghi xuống cơ sở dữ liệu đệm cục bộ trước khi phát hành HTTP POST.
- **Đẩy dữ liệu theo lô (Batch HTTP Forwarder):**
  - Gom các bản tin theo lô (batch size = 10) giúp giảm thiểu số lượng HTTP request và tiết kiệm băng thông mạng 4G/LTE.
- **Thuật toán tái kết nối Exponential Backoff:**
  - Khi đứt cáp hoặc Cloud bảo trì, gateway tự động giãn cách chu kỳ thử lại ($2, 4, 8, \dots, 60\text{ giây}$) tránh gây bão request làm sập máy chủ.

---

### Slide 9: Hạ Tầng Điện Toán Đám Mây (Cloud Backend & Database)
- **Kiến trúc Cloud tự xây dựng (FastAPI Stack):**
  - Xử lý bất đồng bộ AsyncIO, thời gian phản hồi API $< 5\text{ms}$.
  - Bảo mật bằng cơ chế Ingestion API Key (`X-API-Key`).
- **Cơ sở dữ liệu quan hệ PostgreSQL 16:**
  - Bảng `nodes`: Thông tin địa lý (Lat/Lon), trạng thái kết nối trạm.
  - Bảng `measurements`: Dữ liệu chuỗi thời gian, đánh chỉ mục kép `(node_id, ts)`.
  - Bảng `alerts`: Lưu trữ lịch sử sự cố, nhãn nguyên nhân, độ tin cậy và trạng thái xác nhận.
- **Hệ thống WebSocket Manager:**
  - Truyền dữ liệu thời gian thực tới tất cả các phiên Web Console đang mở đồng thời.

---

### Slide 10: Quy Trình AI/ML 2 Giai Đoạn (Two-Stage Machine Learning)
- **Giai đoạn 1: Phát hiện dị thường không giám sát (Isolation Forest):**
  - 150 cây quyết định, phát hiện ngay các phân bố dị biệt trong không gian đa chiều mà không cần nhãn từ trước.
- **Giai đoạn 2: Phân loại nguyên nhân ô nhiễm (Random Forest Classifier):**
  - 120 cây quyết định, phân loại chính xác 5 nhóm nguyên nhân: `normal`, `acidic_industrial`, `domestic_sewage`, `algal_bloom`, `runoff_sediment`.
- **Đặc trưng vi phân vật lý - môi trường:**
  - $\Delta 5\text{m}$ (tốc độ biến thiên 5 phút): Nhận diện cú sốc xả thải hóa chất.
  - Mã hóa chu kỳ ngày đêm $\sin/\cos$: Phân biệt hiện tượng quang hợp sinh học với ô nhiễm nhân tạo.
  - Tỷ số quang học $G/R, B/R$ và tỷ số $\text{Turb}/\text{TDS}$.

---

### Slide 11: Bảng Điều Khiển Web Console & Cảnh Báo Telegram
- **Web Console Dashboard (HTML5 / Vanilla JS / Chart.js):**
  - Giao diện Dark-Mode chuyên nghiệp, hiển thị trực quan 4 đồ thị thời gian thực song song.
  - Thẻ KPI trạng thái mạng lưới, chuông cảnh báo âm thanh sử dụng Web Audio API.
  - Nút **Xác nhận sự cố (/ack)** phục vụ công tác quản lý vận hành.
- **Kênh thông báo khẩn cấp Telegram Bot:**
  - Bắn thông báo ngay tức thì ($<1\text{ giây}$) kèm mức độ nguy hiểm, giá trị cảm biến đột biến và khuyến nghị ứng phó tại hiện trường.

---

### Slide 12: Thiết Kế Kịch Bản Kiểm Thử Bể Thực Nghiệm
- **Kịch bản 1: Môi trường bình thường (Baseline)** $\rightarrow$ Nước biển nhân tạo ổn định, kiểm tra chu kỳ nhật triều.
- **Kịch bản 2: Xả thải axit công nghiệp (`acidic_industrial`)** $\rightarrow$ Châm giấm/chanh làm pH giảm đột ngột $< 4.5$.
- **Kịch bản 3: Nước thải sinh hoạt hữu cơ (`domestic_sewage`)** $\rightarrow$ Thêm nước thải pha đục + muối, TDS tăng, độ đục tăng.
- **Kịch bản 4: Nước lũ phù sa sau mưa (`runoff_sediment`)** $\rightarrow$ Thêm nước ngọt + bùn sét, TDS tụt dốc, độ đục tăng vọt $> 150\text{ NTU}$.
- **Kịch bản 5: Thử nghiệm ngắt kết nối mạng (Network Drop Resilience)** $\rightarrow$ Ngắt Wi-Fi trong 2 phút; kiểm tra khả năng tích đệm và gửi bù dữ liệu của Node và Gateway.

---

### Slide 13: Kết Quả Thực Nghiệm & Đánh Giá
- **Hiệu năng mô hình Machine Learning:**
  - **Macro F1:** Đạt **98.79%** (Vượt trội +21.26% so với phương pháp Ngưỡng tĩnh 77.53%).
  - **Weighted F1:** Đạt **99.75%**; Độ chính xác Accuracy: **99.75%**.
  - Tách biệt hoàn hảo các ca xả thải axit và nước lũ phù sa (Recall $> 98.6\%$).
- **Số liệu đo đạc hệ thống thực nghiệm:**
  - **Độ trễ trung bình end-to-end (Node $\rightarrow$ Web):** $[120\text{ ms} - 280\text{ ms}]$
  - **Thời gian từ khi xả thải đến khi Telegram nhận cảnh báo:** $[< 1.5\text{ giây}]$
  - **Tỷ lệ mất mát gói tin khi mất mạng 2 phút:** **$0.0\%$** (Được đệm và truyền bù toàn bộ 100%).

---

### Slide 14: Thảo Luận, Hạn Chế & Hướng Phát Triển
- **Hạn chế của đề tài:**
  - Mô hình ML được huấn luyện chủ yếu trên dữ liệu tổng hợp vật lý kết hợp dữ liệu bể nước prototype (chưa có điều kiện ngâm thực tế dài ngày tại bờ biển thật do chi phí phao neo).
  - Cảm biến pH thủy tinh giá rẻ dễ bám bẩn sinh học (bio-fouling) sau vài tuần nếu không được vệ sinh cơ học.
- **Hướng phát triển trong tương lai:**
  - Bổ sung cơ chế tự làm sạch đầu dò bằng cần gạt siêu âm / khí nén.
  - Sử dụng module pin năng lượng mặt trời + chuẩn truyền thông tầm xa LoRaWAN để triển khai phao nổi ngoài khơi xa $> 5\text{km}$.
  - Ứng dụng mô hình Deep Learning (LSTM Autoencoder) cho các chuỗi biến thiên phức tạp hơn.

---

### Slide 15: Kết Luận & Demo Hệ Thống
- **Tổng kết thành quả:**
  - Xây dựng thành công một nền tảng IoT đầy đủ, tự chủ từ phần cứng, phần mềm cổng biên, đám mây đến giao diện người dùng.
  - Tích hợp thành công Machine Learning giải quyết bài toán cốt lõi: không chỉ báo có ô nhiễm mà còn chỉ ra nguyên nhân nghi ngờ.
  - Đáp ứng xuất sắc toàn bộ tiêu chí ràng buộc của học phần.
- **Kế hoạch trình chiếu Demo:**
  - Trình diễn trạm vật lý Node 01 trong bể nước + Trạm ảo Node 02.
  - Bơm kịch bản ô nhiễm axit $\rightarrow$ Quan sát đồ thị giật dốc trên Web $\rightarrow$ Nhận tin nhắn Telegram $\rightarrow$ Xác nhận sự cố.
- **Cảm ơn Thầy Cô và Các Bạn đã lắng nghe! (Q&A)**

