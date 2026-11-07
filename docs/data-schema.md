# Lược đồ dữ liệu

Bảng `measurements`: node_id, ts, seq, temp_c, ph, tds_ppm, turbidity_ntu, color_r/g/b, rssi.
Bảng `alerts`: id, node_id, ts, type (anomaly), cause (nhãn nguyên nhân), confidence, acknowledged.
Bảng `nodes`: node_id, name, lat, lon, last_seen.
Nhãn nguyên nhân: normal, domestic_sewage, acidic_industrial, algal_bloom, runoff_sediment.
