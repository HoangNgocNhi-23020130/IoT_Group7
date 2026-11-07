# Prompt mẫu: firmware ESP32
Bối cảnh: dán mục 1–4 của AI_CONTEXT.md.
Nhiệm vụ: Viết firmware PlatformIO cho ESP32 đọc DS18B20, pH, TDS, độ đục qua ADS1115 (chia áp cho cảm biến 5V),
trung bình 10 mẫu, gửi JSON theo docs/mqtt-topics.md qua MQTT QoS1 mỗi 10 giây, có LWT, tự kết nối lại Wi-Fi/MQTT,
lưu đệm tối đa 200 bản tin khi mất mạng rồi gửi bù, và lệnh hiệu chuẩn pH 2 điểm qua topic cmd.
Ràng buộc: không block loop dài, secrets trong secrets.h. Hãy kèm sơ đồ đấu dây dạng văn bản và cách kiểm thử bằng Serial.
