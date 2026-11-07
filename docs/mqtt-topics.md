# MQTT topics và định dạng bản tin

| Topic | Hướng | Mô tả |
|---|---|---|
| `marine/{node_id}/telemetry` | node -> gateway | Dữ liệu đo (QoS 1) |
| `marine/{node_id}/status` | node -> gateway | online/offline (LWT, retained) |
| `marine/{node_id}/cmd` | gateway -> node | Lệnh: đổi chu kỳ lấy mẫu, hiệu chuẩn |

## Telemetry JSON
```json
{
  "node_id": "node01",
  "seq": 1234,
  "ts": "2026-11-20T08:15:30Z",
  "temp_c": 28.4,
  "ph": 7.9,
  "tds_ppm": 1820,
  "turbidity_ntu": 12.5,
  "color": {"r": 120, "g": 140, "b": 98},
  "rssi": -61
}
```
