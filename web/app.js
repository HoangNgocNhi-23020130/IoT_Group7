/**
 * Marine Pollution IoT - Real-time Dashboard Application (Vanilla JS)
 * Coordinates Chart.js real-time charts, WebSocket streaming, REST fallback,
 * and Alert acknowledgment.
 */

// Global Configuration
const API_BASE_URL = `http://${window.location.hostname || "localhost"}:8000`;
const WS_BASE_URL = `ws://${window.location.hostname || "localhost"}:8000/ws`;

// Global State
let selectedNode = "all";
let timeLimit = 20;
let soundEnabled = true;
let totalPackets = 0;
let unackAlertsCount = 0;

// Data History Buffers per Node
const historyData = {
    node01: { ts: [], ph: [], turb: [], tds: [], temp: [] },
    node02: { ts: [], ph: [], turb: [], tds: [], temp: [] },
};

// Chart.js Instances
let chartPh, chartTurbidity, chartTds, chartTemp;

// ==============================================================================
// Web Audio Synth Alert Sound (No external audio file needed)
// ==============================================================================
function playAlertChime() {
    if (!soundEnabled) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        // 2-tone alarm chime
        const playTone = (freq, start, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
            gain.gain.setValueAtTime(0.2, ctx.currentTime + start);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + start);
            osc.stop(ctx.currentTime + start + duration);
        };

        playTone(880, 0, 0.15);    // A5
        playTone(1174.66, 0.16, 0.25); // D6
    } catch (e) {
        console.warn("Audio playback not permitted yet (requires user gesture):", e);
    }
}

// ==============================================================================
// Chart.js Initialization
// ==============================================================================
const CHART_COLORS = {
    node01: { border: "#38bdf8", fill: "rgba(56, 189, 248, 0.1)" }, // Cyan
    node02: { border: "#f59e0b", fill: "rgba(245, 158, 11, 0.1)" }, // Amber
};

function createSensorChart(ctxId, label, unit, minVal, maxVal, safeZoneMin = null, safeZoneMax = null) {
    const ctx = document.getElementById(ctxId).getContext("2d");
    return new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Node 01 (Ngoài khơi)",
                    data: [],
                    borderColor: CHART_COLORS.node01.border,
                    backgroundColor: CHART_COLORS.node01.fill,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.35,
                    fill: false,
                },
                {
                    label: "Node 02 (Cửa sông)",
                    data: [],
                    borderColor: CHART_COLORS.node02.border,
                    backgroundColor: CHART_COLORS.node02.fill,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.35,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { mode: "index", intersect: false },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.08)" },
                    ticks: {
                        color: "#94a3b8",
                        callback: (v) => `${v} ${unit}`,
                    },
                    suggestedMin: minVal,
                    suggestedMax: maxVal,
                },
            },
            plugins: {
                legend: {
                    labels: { color: "#cbd5e1", boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${c.dataset.label}: ${c.parsed.y} ${unit}`,
                    },
                },
            },
        },
    });
}

function initCharts() {
    chartPh = createSensorChart("chartPh", "Độ pH", "pH", 6.0, 9.5, 6.5, 8.5);
    chartTurbidity = createSensorChart("chartTurbidity", "Độ đục", "NTU", 0.0, 60.0);
    chartTds = createSensorChart("chartTds", "Tổng chất rắn TDS", "ppm", 1000.0, 3500.0);
    chartTemp = createSensorChart("chartTemp", "Nhiệt độ", "°C", 24.0, 34.0);
}

// ==============================================================================
// Real-time Chart Data Updates
// ==============================================================================
function updateCharts() {
    // Generate unified chronological time labels
    const allTs = Array.from(
        new Set([...historyData.node01.ts, ...historyData.node02.ts])
    ).sort().slice(-timeLimit);

    const formatTime = (isoStr) => {
        try {
            const d = new Date(isoStr);
            return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch {
            return isoStr;
        }
    };

    const formattedLabels = allTs.map(formatTime);

    const syncDataset = (chart, paramKey) => {
        chart.data.labels = formattedLabels;

        // Map values aligned with unified timestamps
        chart.data.datasets[0].data = allTs.map((t) => {
            const idx = historyData.node01.ts.indexOf(t);
            return idx !== -1 ? historyData.node01[paramKey][idx] : null;
        });

        chart.data.datasets[1].data = allTs.map((t) => {
            const idx = historyData.node02.ts.indexOf(t);
            return idx !== -1 ? historyData.node02[paramKey][idx] : null;
        });

        // Filter visible datasets based on selectedNode filter
        if (selectedNode === "node01") {
            chart.data.datasets[0].hidden = false;
            chart.data.datasets[1].hidden = true;
        } else if (selectedNode === "node02") {
            chart.data.datasets[0].hidden = true;
            chart.data.datasets[1].hidden = false;
        } else {
            chart.data.datasets[0].hidden = false;
            chart.data.datasets[1].hidden = false;
        }

        chart.update("none"); // update smoothly without full re-render
    };

    syncDataset(chartPh, "ph");
    syncDataset(chartTurbidity, "turb");
    syncDataset(chartTds, "tds");
    syncDataset(chartTemp, "temp");
}

function pushMeasurement(meas) {
    const node = meas.node_id;
    if (!historyData[node]) return;

    totalPackets++;
    document.getElementById("kpiTotalPackets").textContent = totalPackets.toLocaleString();

    // Push into node history buffer
    historyData[node].ts.push(meas.ts);
    historyData[node].ph.push(meas.ph);
    historyData[node].turb.push(meas.turbidity_ntu);
    historyData[node].tds.push(meas.tds_ppm);
    historyData[node].temp.push(meas.temp_c);

    // Keep history buffer capped at max limit
    const maxBuf = 150;
    if (historyData[node].ts.length > maxBuf) {
        historyData[node].ts.shift();
        historyData[node].ph.shift();
        historyData[node].turb.shift();
        historyData[node].tds.shift();
        historyData[node].temp.shift();
    }

    // Update Station Card Mini Info
    updateStationCard(meas);

    // Refresh charts
    updateCharts();
}

function updateStationCard(meas) {
    const isNode1 = meas.node_id === "node01";
    const suffix = isNode1 ? "Node01" : "Node02";

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal(`valPh${suffix}`, meas.ph?.toFixed(2));
    setVal(`valTurb${suffix}`, `${meas.turbidity_ntu?.toFixed(1)} NTU`);
    setVal(`valTds${suffix}`, `${meas.tds_ppm?.toFixed(0)} ppm`);
    setVal(`valTemp${suffix}`, `${meas.temp_c?.toFixed(1)} °C`);
    setVal(`valRssi${suffix}`, `${meas.rssi || -60} dBm`);

    // Color swatch preview
    const swatchEl = document.getElementById(`colorSwatch${suffix}`);
    if (swatchEl) {
        const r = meas.color_r ?? 100;
        const g = meas.color_g ?? 140;
        const b = meas.color_b ?? 120;
        swatchEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }
}

// ==============================================================================
// Alert System & Notification Banner
// ==============================================================================
const CAUSE_TRANSLATIONS = {
    acidic_industrial: { name: "Xả thải axit công nghiệp nguy hại", class: "cause-acidic_industrial" },
    domestic_sewage: { name: "Nước thải sinh hoạt hữu cơ", class: "cause-domestic_sewage" },
    algal_bloom: { name: "Tảo nở hoa / Thủy triều đỏ", class: "cause-algal_bloom" },
    runoff_sediment: { name: "Nước lũ bùn đất / Bồi lắng phù sa", class: "cause-runoff_sediment" },
    normal: { name: "Bình thường", class: "cause-normal" },
};

function triggerLiveAlert(alert) {
    playAlertChime();

    // Show top banner
    const banner = document.getElementById("liveAlertBanner");
    const title = document.getElementById("bannerTitle");
    const desc = document.getElementById("bannerDesc");

    const info = CAUSE_TRANSLATIONS[alert.cause] || { name: alert.cause, class: "cause-acidic_industrial" };

    title.textContent = `🚨 CẢNH BÁO BẤT THƯỜNG TẠI ${alert.node_id.toUpperCase()}: ${info.name}`;
    desc.textContent = `Độ tin cậy Machine Learning: ${alert.confidence}% • pH: ${alert.ph || "--"}, TDS: ${alert.tds_ppm || "--"} ppm, Độ đục: ${alert.turbidity_ntu || "--"} NTU.`;

    banner.classList.remove("hidden");

    // Update overall status KPI
    const kpiStatus = document.getElementById("kpiEnvStatus");
    const kpiDesc = document.getElementById("kpiEnvDesc");
    kpiStatus.textContent = "PHÁT HIỆN SỰ CỐ!";
    kpiStatus.className = "kpi-value danger";
    kpiDesc.textContent = `Cảnh báo mới nhất: ${info.name}`;

    // Prepend to alerts table
    prependAlertToTable(alert);
}

function dismissBanner() {
    document.getElementById("liveAlertBanner").classList.add("hidden");
}

function prependAlertToTable(alert) {
    const tbody = document.getElementById("alertsTableBody");
    const emptyRow = tbody.querySelector(".empty-state");
    if (emptyRow) emptyRow.closest("tr").remove();

    unackAlertsCount++;
    document.getElementById("kpiUnackAlerts").textContent = unackAlertsCount;

    const info = CAUSE_TRANSLATIONS[alert.cause] || { name: alert.cause, class: "cause-acidic_industrial" };
    const timeStr = new Date(alert.ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const row = document.createElement("tr");
    row.id = `alert-row-${alert.id}`;
    row.innerHTML = `
        <td>#${alert.id}</td>
        <td>${timeStr}</td>
        <td><b>${alert.node_id}</b></td>
        <td><span class="cause-badge ${info.class}">${info.name}</span></td>
        <td><b>${alert.confidence}%</b></td>
        <td>pH: ${alert.ph ?? "--"}, TDS: ${alert.tds_ppm ?? "--"}</td>
        <td><span class="badge ${alert.acknowledged ? 'badge-online' : 'badge-offline'}" id="status-badge-${alert.id}">
            ${alert.acknowledged ? 'ĐÃ XỬ LÝ' : 'CHỜ KIỂM TRA'}
        </span></td>
        <td>
            <button class="ack-btn" onclick="acknowledgeAlert(${alert.id})" id="ack-btn-${alert.id}" ${alert.acknowledged ? 'disabled' : ''}>
                ${alert.acknowledged ? '✓ Đã xác nhận' : 'Xác nhận'}
            </button>
        </td>
    `;
    tbody.prepend(row);
}

async function acknowledgeAlert(alertId) {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/v1/alerts/${alertId}/ack`, { method: "POST" });
        if (resp.ok) {
            const badge = document.getElementById(`status-badge-${alertId}`);
            const btn = document.getElementById(`ack-btn-${alertId}`);
            if (badge) {
                badge.className = "badge badge-online";
                badge.textContent = "ĐÃ XỬ LÝ";
            }
            if (btn) {
                btn.textContent = "✓ Đã xác nhận";
                btn.disabled = true;
            }
            if (unackAlertsCount > 0) {
                unackAlertsCount--;
                document.getElementById("kpiUnackAlerts").textContent = unackAlertsCount;
            }
        }
    } catch (e) {
        console.error("Failed to acknowledge alert:", e);
    }
}

async function loadAlerts() {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/v1/alerts?limit=15`);
        if (!resp.ok) return;
        const alerts = await resp.json();

        const tbody = document.getElementById("alertsTableBody");
        tbody.innerHTML = "";

        if (alerts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center empty-state">Không có sự cố ô nhiễm nào được ghi nhận. Hệ thống an toàn!</td></tr>`;
            unackAlertsCount = 0;
            document.getElementById("kpiUnackAlerts").textContent = "0";
            return;
        }

        unackAlertsCount = alerts.filter(a => !a.acknowledged).length;
        document.getElementById("kpiUnackAlerts").textContent = unackAlertsCount;

        alerts.forEach(alert => {
            let params = {};
            if (alert.details) {
                try { params = JSON.parse(alert.details); } catch {}
            }
            const info = CAUSE_TRANSLATIONS[alert.cause] || { name: alert.cause, class: "cause-acidic_industrial" };
            const timeStr = new Date(alert.ts).toLocaleString("vi-VN");

            const row = document.createElement("tr");
            row.id = `alert-row-${alert.id}`;
            row.innerHTML = `
                <td>#${alert.id}</td>
                <td>${timeStr}</td>
                <td><b>${alert.node_id}</b></td>
                <td><span class="cause-badge ${info.class}">${info.name}</span></td>
                <td><b>${alert.confidence}%</b></td>
                <td>pH: ${params.ph ?? "--"}, TDS: ${params.tds_ppm ?? "--"}</td>
                <td><span class="badge ${alert.acknowledged ? 'badge-online' : 'badge-offline'}" id="status-badge-${alert.id}">
                    ${alert.acknowledged ? 'ĐÃ XỬ LÝ' : 'CHỜ KIỂM TRA'}
                </span></td>
                <td>
                    <button class="ack-btn" onclick="acknowledgeAlert(${alert.id})" id="ack-btn-${alert.id}" ${alert.acknowledged ? 'disabled' : ''}>
                        ${alert.acknowledged ? '✓ Đã xác nhận' : 'Xác nhận'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error("Error loading alerts:", e);
    }
}

// ==============================================================================
// Initial Data Preload (REST)
// ==============================================================================
async function preloadHistory() {
    try {
        // Load initial historical records
        const resp = await fetch(`${API_BASE_URL}/api/v1/measurements?limit=40`);
        if (!resp.ok) return;
        const measurements = await resp.json();

        // Measurements are returned descending -> reverse to chronological order
        measurements.reverse().forEach((m) => {
            const node = m.node_id;
            if (historyData[node]) {
                historyData[node].ts.push(m.ts);
                historyData[node].ph.push(m.ph);
                historyData[node].turb.push(m.turbidity_ntu);
                historyData[node].tds.push(m.tds_ppm);
                historyData[node].temp.push(m.temp_c);
                updateStationCard(m);
            }
        });
        updateCharts();
    } catch (e) {
        console.warn("Could not preload history from REST API:", e);
    }
}

// ==============================================================================
// WebSocket Real-time Streaming
// ==============================================================================
let socket = null;
let reconnectTimer = null;

function connectWebSocket() {
    const pill = document.getElementById("connectionPill");
    const text = document.getElementById("connectionText");

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    pill.className = "status-pill connecting";
    text.textContent = "Đang kết nối...";

    try {
        socket = new WebSocket(WS_BASE_URL);

        socket.onopen = () => {
            pill.className = "status-pill";
            text.textContent = "WebSocket Real-time";
            console.log("WebSocket connected successfully.");
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === "telemetry" && msg.data) {
                    pushMeasurement(msg.data);
                    if (msg.alert) {
                        triggerLiveAlert(msg.alert);
                    }
                }
            } catch (e) {
                console.error("Error parsing WebSocket message:", e);
            }
        };

        socket.onclose = () => {
            pill.className = "status-pill error";
            text.textContent = "Mất kết nối (Tự kết nối lại...)";
            console.warn("WebSocket closed. Attempting reconnect in 3s...");
            reconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            socket.close();
        };

    } catch (e) {
        console.error("WebSocket connection failure:", e);
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    }
}

// ==============================================================================
// UI Control Handlers
// ==============================================================================
function selectNode(nodeId) {
    selectedNode = nodeId;
    document.querySelectorAll(".node-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-node") === nodeId);
    });
    updateCharts();
}

function setTimeLimit(limit) {
    timeLimit = limit;
    document.querySelectorAll(".time-range-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.textContent.includes(limit.toString()));
    });
    updateCharts();
}

// Sound toggle
document.getElementById("soundToggleBtn").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    const label = document.getElementById("soundLabel");
    label.textContent = soundEnabled ? "Âm thanh: Bật" : "Âm thanh: Tắt";
    document.getElementById("soundToggleBtn").classList.toggle("active", soundEnabled);
});

// Real-time Clock
function startClock() {
    const el = document.getElementById("clockDisplay");
    setInterval(() => {
        const now = new Date();
        el.textContent = `${now.toLocaleTimeString("vi-VN")} ICT`;
    }, 1000);
}

// ==============================================================================
// Application Startup
// ==============================================================================
window.addEventListener("DOMContentLoaded", async () => {
    startClock();
    initCharts();
    await preloadHistory();
    await loadAlerts();
    connectWebSocket();
});

