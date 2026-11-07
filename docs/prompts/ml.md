# Prompt mẫu: dữ liệu và ML
Bối cảnh: dán mục 1, 4, 5 của AI_CONTEXT.md.
Nhiệm vụ: Viết ml/src/generate_synthetic.py sinh chuỗi 4 thông số mỗi 1 phút trong 60 ngày cho 2 node, nền gồm chu kỳ ngày đêm,
thủy triều (chu kỳ ~12,4 giờ), nhiễu cảm biến, trôi pH chậm; chèn sự kiện có nhãn cho 4 loại nguyên nhân
với cường độ, thời gian, độ trễ ngẫu nhiên, có sự kiện chồng nhau. Xuất CSV theo docs/data-schema.md.
Sau đó viết train.py (Isolation Forest + Random Forest) và evaluate.py (F1, ma trận nhầm lẫn, so với ngưỡng cố định,
đánh giá train-on-synthetic/test-on-real khi có dữ liệu thật). Lưu mô hình bằng joblib.
