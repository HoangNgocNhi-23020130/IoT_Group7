"""Telegram Bot Alert Notification Service."""

from __future__ import annotations

import logging
from typing import Any, Dict
import httpx

from app.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger("marine.telegram")

CAUSE_NAMES = {
    "acidic_industrial": "Xả thải axit công nghiệp nguy hại",
    "domestic_sewage": "Ô nhiễm nước thải sinh hoạt",
    "algal_bloom": "Hiện tượng vi tảo nở hoa (Thủy triều đỏ)",
    "runoff_sediment": "Bồi lắng phù sa / lũ bùn đất sau mưa",
    "normal": "Bình thường",
}


async def send_telegram_alert(alert_data: Dict[str, Any]) -> bool:
    """Send an environmental pollution alert message to a Telegram chat asynchronously."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.debug("Telegram credentials not configured. Skipping alert notification.")
        return False

    cause_code = alert_data.get("cause", "unknown")
    cause_vn = CAUSE_NAMES.get(cause_code, cause_code)
    confidence = alert_data.get("confidence", 0.0)
    node_id = alert_data.get("node_id", "unknown")
    ts = alert_data.get("ts", "")
    temp = alert_data.get("temp_c", "N/A")
    ph = alert_data.get("ph", "N/A")
    tds = alert_data.get("tds_ppm", "N/A")
    turb = alert_data.get("turbidity_ntu", "N/A")

    message_text = (
        f"🚨 <b>CẢNH BÁO Ô NHIỄM NƯỚC BIỂN</b> 🚨\n\n"
        f"📍 <b>Trạm quan trắc:</b> <code>{node_id}</code>\n"
        f"⏰ <b>Thời điểm:</b> {ts}\n"
        f"⚠️ <b>Nguyên nhân nghi ngờ:</b> <b>{cause_vn}</b> (<code>{cause_code}</code>)\n"
        f"🎯 <b>Độ tin cậy mô hình ML:</b> <b>{confidence:.1f}%</b>\n\n"
        f"📊 <b>Thông số hiện thời:</b>\n"
        f" • pH: <b>{ph}</b>\n"
        f" • TDS: <b>{tds} ppm</b>\n"
        f" • Độ đục: <b>{turb} NTU</b>\n"
        f" • Nhiệt độ: <b>{temp} °C</b>\n\n"
        f"🔗 <i>Hệ thống IoT Marine Pollution Group 7</i>"
    )

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message_text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                logger.info(f"Telegram alert successfully dispatched for node {node_id}.")
                return True
            else:
                logger.error(f"Telegram API error {resp.status_code}: {resp.text}")
                return False
    except Exception as e:
        logger.error(f"Failed to deliver Telegram notification: {e}")
        return False

