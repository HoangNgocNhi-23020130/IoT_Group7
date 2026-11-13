#!/usr/bin/env python3
"""Virtual Marine IoT Node Simulator.

Simulates physical ESP32 sensor nodes for testing the complete end-to-end pipeline:
  [Virtual Node] --MQTT--> [IoT Gateway] --HTTPS--> [Cloud Backend + ML] --> [Web Console + Telegram]

Features:
- Real-time physics-based baseline with diurnal temperature & tidal cycles.
- Interactive keyboard trigger (1-6, r, h, q) to inject real-world pollution scenarios on demand.
- Automated sequence mode (--mode auto) for unattended stress testing or presentation demos.
- Full MQTT LWT (Last Will and Testament) and command subscription (marine/{node_id}/cmd).
- Complies with docs/mqtt-topics.md and docs/test-scenarios.md.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
import math
import os
import random
import select
import sys
import threading
import time
from typing import Any, Dict, Optional

import paho.mqtt.client as mqtt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [SimNode] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("marine.sim_node")

# ==============================================================================
# Scenario Definitions & Environmental Baseline
# ==============================================================================
SCENARIOS = {
    "normal": {
        "name": "Bình thường (Normal Coastal Seawater)",
        "label": "normal",
        "temp_base": 28.0,
        "ph_base": 8.10,
        "tds_base": 2200.0,
        "turb_base": 5.0,
        "color": {"r": 100, "g": 140, "b": 125},
        "description": "Nước biển ven bờ ổn định, chu kỳ nhật triều tự nhiên.",
    },
    "acidic_industrial": {
        "name": "Nước thải axit công nghiệp (Acidic Industrial)",
        "label": "acidic_industrial",
        "temp_base": 28.5,
        "ph_base": 4.10,
        "tds_base": 3100.0,
        "turb_base": 18.0,
        "color": {"r": 140, "g": 155, "b": 110},
        "description": "Xả thải axit: pH giảm mạnh (< 4.5), TDS tăng do ion hòa tan.",
    },
    "domestic_sewage": {
        "name": "Nước thải sinh hoạt (Domestic Sewage)",
        "label": "domestic_sewage",
        "temp_base": 29.2,
        "ph_base": 7.00,
        "tds_base": 3500.0,
        "turb_base": 65.0,
        "color": {"r": 85, "g": 110, "b": 90},
        "description": "Nước thải sinh hoạt: TDS tăng vọt, độ đục cao, nước chuyển màu xám đục.",
    },
    "algal_bloom": {
        "name": "Tảo nở hoa / Thủy triều đỏ (Algal Bloom)",
        "label": "algal_bloom",
        "temp_base": 28.5,
        "ph_base": 9.10,
        "tds_base": 2400.0,
        "turb_base": 45.0,
        "color": {"r": 70, "g": 205, "b": 95},
        "description": "Tảo quang hợp mạnh rút CO2 làm pH kiềm hóa (> 8.8), màu lục đậm (diệp lục).",
    },
    "runoff_sediment": {
        "name": "Nước lũ phù sa / Sau mưa lớn (Runoff Sediment)",
        "label": "runoff_sediment",
        "temp_base": 26.5,
        "ph_base": 7.50,
        "tds_base": 1300.0,
        "turb_base": 170.0,
        "color": {"r": 185, "g": 145, "b": 75},
        "description": "Nước lũ phù sa: độ đục tăng cực đại (> 150 NTU), TDS tụt dốc do nước ngọt pha loãng, màu nâu đỏ.",
    },
}


class VirtualNode:
    """Simulates a physical IoT marine station node communicating via MQTT."""

    def __init__(
        self,
        node_id: str = "node02",
        broker: str = "localhost",
        port: int = 1883,
        username: Optional[str] = None,
        password: Optional[str] = None,
        interval: float = 5.0,
        active_scenario: str = "normal",
        tank_mode: bool = False,
    ) -> None:
        self.node_id = node_id
        self.broker = broker
        self.port = port
        self.username = username
        self.password = password
        self.interval = interval
        self.active_scenario = active_scenario
        self.tank_mode = tank_mode  # Scale TDS down for low-cost tap water / tank demo

        self.seq = 0
        self.running = False
        self.connected = False
        self.last_publish_ts = 0.0

        # Topics
        self.topic_telemetry = f"marine/{self.node_id}/telemetry"
        self.topic_status = f"marine/{self.node_id}/status"
        self.topic_cmd = f"marine/{self.node_id}/cmd"

        # Initialize MQTT client
        try:
            self.client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"sim_{self.node_id}_{os.getpid()}",
            )
        except AttributeError:
            self.client = mqtt.Client(client_id=f"sim_{self.node_id}_{os.getpid()}")

        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)

        # Configure Last Will and Testament (LWT)
        lwt_payload = json.dumps({
            "node_id": self.node_id,
            "status": "offline",
            "reason": "abrupt_disconnect_or_power_loss",
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        self.client.will_set(self.topic_status, payload=lwt_payload, qos=1, retain=True)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client: Any, userdata: Any, flags: Any, rc: Any, properties: Any = None) -> None:
        rc_val = getattr(rc, "value", rc)
        if rc_val == 0:
            self.connected = True
            logger.info(f"Connected to Mosquitto MQTT Broker at {self.broker}:{self.port}")
            # Announce online state
            online_payload = json.dumps({
                "node_id": self.node_id,
                "status": "online",
                "firmware_version": "sim-2.1.0",
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            self.client.publish(self.topic_status, payload=online_payload, qos=1, retain=True)
            # Subscribe to remote commands
            self.client.subscribe(self.topic_cmd, qos=1)
            logger.info(f"Published LWT online status to '{self.topic_status}'")
            logger.info(f"Listening for remote commands on '{self.topic_cmd}'")
        else:
            logger.error(f"MQTT connection failed with code {rc_val}")

    def _on_disconnect(self, client: Any, userdata: Any, flags: Any, rc: Any, properties: Any = None) -> None:
        self.connected = False
        logger.warning(f"MQTT connection lost (rc={rc})")

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            logger.info(f"[CMD INCOMING] Received command on {msg.topic}: {payload}")
            if "interval_s" in payload:
                new_interval = float(payload["interval_s"])
                if 1.0 <= new_interval <= 300.0:
                    self.interval = new_interval
                    logger.info(f"[CMD] Sampling interval updated to {self.interval}s")
            if payload.get("cmd") == "ping":
                logger.info(f"[CMD] Ping received, node [{self.node_id}] is ALIVE")
        except Exception as e:
            logger.error(f"Failed to parse remote command payload: {e}")

    def generate_telemetry(self) -> Dict[str, Any]:
        """Generate physics-consistent sensor readings based on active scenario."""
        cfg = SCENARIOS.get(self.active_scenario, SCENARIOS["normal"])
        now_dt = datetime.now(timezone.utc)
        self.seq += 1

        # Diurnal Solar Cycle (24h period)
        hour_fraction = now_dt.hour + now_dt.minute / 60.0
        diurnal_temp = 1.2 * math.sin(2.0 * math.pi * (hour_fraction - 9.0) / 24.0)
        diurnal_ph = 0.15 * math.sin(2.0 * math.pi * (hour_fraction - 10.0) / 24.0)

        # Baseline calculation with Gaussian sensor noise
        temp_c = round(cfg["temp_base"] + diurnal_temp + random.gauss(0, 0.15), 2)
        ph = round(cfg["ph_base"] + diurnal_ph + random.gauss(0, 0.04), 2)

        # TDS with realistic sensor noise
        tds_ppm = round(max(50.0, cfg["tds_base"] + random.gauss(0, 25.0)), 1)
        turbidity_ntu = round(max(0.5, cfg["turb_base"] + random.gauss(0, 0.8)), 2)

        # Optical color sensor (TCS34725 / GY-33 simulation)
        color = {
            "r": max(0, min(255, int(cfg["color"]["r"] + random.randint(-4, 4)))),
            "g": max(0, min(255, int(cfg["color"]["g"] + random.randint(-4, 4)))),
            "b": max(0, min(255, int(cfg["color"]["b"] + random.randint(-4, 4)))),
        }

        rssi = random.randint(-68, -55)

        return {
            "node_id": self.node_id,
            "seq": self.seq,
            "ts": now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "temp_c": temp_c,
            "ph": ph,
            "tds_ppm": tds_ppm,
            "turbidity_ntu": turbidity_ntu,
            "color": color,
            "rssi": rssi,
        }

    def publish_packet(self) -> bool:
        """Publish one telemetry packet over MQTT."""
        if not self.connected:
            return False

        telemetry = self.generate_telemetry()
        payload = json.dumps(telemetry)
        result = self.client.publish(self.topic_telemetry, payload, qos=1)

        cfg = SCENARIOS.get(self.active_scenario, SCENARIOS["normal"])
        color_str = f"({telemetry['color']['r']},{telemetry['color']['g']},{telemetry['color']['b']})"
        logger.info(
            f"[{self.node_id}] seq={telemetry['seq']:04d} | "
            f"Temp: {telemetry['temp_c']:4.1f}°C | pH: {telemetry['ph']:4.2f} | "
            f"TDS: {telemetry['tds_ppm']:7.1f}ppm | Turb: {telemetry['turbidity_ntu']:5.1f}NTU | "
            f"RGB: {color_str:13s} | Scenario: [{cfg['name']}]"
        )
        return result.rc == mqtt.MQTT_ERR_SUCCESS

    def start(self) -> None:
        """Connect to broker and start loop."""
        logger.info(f"Starting Virtual Node [{self.node_id}] -> Broker {self.broker}:{self.port}")
        self.running = True
        try:
            self.client.connect(self.broker, self.port, keepalive=60)
            self.client.loop_start()
        except Exception as e:
            logger.error(f"Cannot connect to MQTT broker: {e}")
            self.running = False

    def stop(self) -> None:
        """Gracefully disconnect."""
        logger.info(f"Stopping Virtual Node [{self.node_id}]...")
        self.running = False
        if self.connected:
            # Publish orderly offline status
            offline_payload = json.dumps({
                "node_id": self.node_id,
                "status": "offline",
                "reason": "orderly_shutdown",
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            self.client.publish(self.topic_status, payload=offline_payload, qos=1, retain=True)
            time.sleep(0.3)
        self.client.loop_stop()
        self.client.disconnect()
        logger.info("Virtual Node stopped cleanly.")


def print_banner() -> None:
    print("\n" + "=" * 70)
    print("   🌊 MARINE WATER POLLUTION MONITORING - VIRTUAL NODE SIMULATOR 🌊")
    print("=" * 70)
    print(" Interactive Controls (Press key + Enter or single key):")
    print("   [1] Normal baseline        -> Nước biển sạch chuẩn, dao động tự nhiên")
    print("   [2] Acidic Industrial      -> Nước thải axit (pH < 4.5, cảnh báo đỏ)")
    print("   [3] Domestic Sewage        -> Nước thải sinh hoạt (Độ đục cao, TDS giảm)")
    print("   [4] Algal Bloom (Red Tide) -> Tảo nở hoa (pH > 8.8, màu lục đậm)")
    print("   [5] Runoff Sediment        -> Nước lũ phù sa (Độ đục > 150, TDS tụt dốc)")
    print("   [6] Toggle LWT / Offline   -> Giả lập mất kết nối mạng đột ngột")
    print("   [r] Reset to Normal        -> Quay về trạng thái bình thường")
    print("   [h] Help                   -> In lại bảng điều khiển")
    print("   [q] Quit                   -> Dừng mô phỏng và thoát")
    print("=" * 70 + "\n")


def interactive_keyboard_thread(node: VirtualNode) -> None:
    """Non-blocking keyboard listener for interactive scenario switching."""
    while node.running:
        try:
            # Check if input is available (works on Linux/macOS)
            rlist, _, _ = select.select([sys.stdin], [], [], 0.5)
            if not rlist:
                continue
            line = sys.stdin.readline().strip().lower()
            if not line:
                continue

            cmd = line[0]
            if cmd == "1" or cmd == "r":
                node.active_scenario = "normal"
                print(f"\n🔄 >>> Switched to SCENARIO: [1] Normal (Bình thường)\n")
            elif cmd == "2":
                node.active_scenario = "acidic_industrial"
                print(f"\n⚠️  >>> Switched to SCENARIO: [2] Acidic Industrial Discharge (Nước thải Axit)!\n")
            elif cmd == "3":
                node.active_scenario = "domestic_sewage"
                print(f"\n⚠️  >>> Switched to SCENARIO: [3] Domestic Sewage Discharge (Nước thải Sinh hoạt)!\n")
            elif cmd == "4":
                node.active_scenario = "algal_bloom"
                print(f"\n⚠️  >>> Switched to SCENARIO: [4] Algal Bloom / Red Tide (Tảo nở hoa)!\n")
            elif cmd == "5":
                node.active_scenario = "runoff_sediment"
                print(f"\n⚠️  >>> Switched to SCENARIO: [5] Runoff Sediment (Nước phù sa sau mưa)!\n")
            elif cmd == "6":
                print(f"\n⚡ >>> Simulating sudden Network Drop / LWT trigger...")
                offline_payload = json.dumps({
                    "node_id": node.node_id,
                    "status": "offline",
                    "reason": "simulated_hardware_power_loss",
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
                node.client.publish(node.topic_status, payload=offline_payload, qos=1, retain=True)
            elif cmd == "h":
                print_banner()
            elif cmd == "q":
                print("\n🛑 Exiting simulator requested...")
                node.running = False
                break
        except Exception:
            break


def run_auto_mode(node: VirtualNode, cycle_seconds: int = 25) -> None:
    """Automatically cycles through all scenarios for automated testing or video demo."""
    scenario_order = ["normal", "acidic_industrial", "normal", "domestic_sewage", "normal", "runoff_sediment", "algal_bloom"]
    scenario_idx = 0
    next_switch_time = time.time() + cycle_seconds

    logger.info(f"Running in AUTO mode: switching scenario every {cycle_seconds}s")
    node.active_scenario = scenario_order[scenario_idx]

    while node.running:
        node.publish_packet()
        time.sleep(node.interval)

        if time.time() >= next_switch_time:
            scenario_idx = (scenario_idx + 1) % len(scenario_order)
            node.active_scenario = scenario_order[scenario_idx]
            next_switch_time = time.time() + cycle_seconds
            print(f"\n🤖 [AUTO SWITCH] >>> Now running: [{SCENARIOS[node.active_scenario]['name']}]\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Marine Pollution IoT Virtual Node Simulator")
    parser.add_argument("--broker", type=str, default="localhost", help="Mosquitto broker host (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="Mosquitto broker port (default: 1883)")
    parser.add_argument("--user", type=str, default=None, help="MQTT username (optional)")
    parser.add_argument("--password", type=str, default=None, help="MQTT password (optional)")
    parser.add_argument("--node-id", type=str, default="node02", help="Station ID (default: node02)")
    parser.add_argument("--interval", type=float, default=3.0, help="Publish interval in seconds (default: 3.0)")
    parser.add_argument(
        "--mode",
        type=str,
        default="interactive",
        choices=["interactive", "auto", "normal", "acidic_industrial", "domestic_sewage", "algal_bloom", "runoff_sediment"],
        help="Operating mode (default: interactive)",
    )
    parser.add_argument("--cycle-duration", type=int, default=20, help="Duration per scenario in auto mode (seconds)")
    parser.add_argument("--tank-mode", action="store_true", help="Scale TDS to small prototype water tank levels")

    args = parser.parse_args()

    init_scenario = "normal" if args.mode in ["interactive", "auto"] else args.mode

    node = VirtualNode(
        node_id=args.node_id,
        broker=args.broker,
        port=args.port,
        username=args.user,
        password=args.password,
        interval=args.interval,
        active_scenario=init_scenario,
        tank_mode=args.tank_mode,
    )

    node.start()

    # Wait for initial connection
    time.sleep(1.0)

    if not node.connected:
        logger.warning(
            f"Broker {args.broker}:{args.port} seems unreachable right now. "
            f"Simulator will continue retrying in background..."
        )

    if args.mode == "auto":
        try:
            run_auto_mode(node, cycle_seconds=args.cycle_duration)
        except KeyboardInterrupt:
            pass
    elif args.mode == "interactive":
        print_banner()
        # Start keyboard listening thread
        kb_thread = threading.Thread(target=interactive_keyboard_thread, args=(node,), daemon=True)
        kb_thread.start()

        try:
            while node.running:
                node.publish_packet()
                time.sleep(node.interval)
        except KeyboardInterrupt:
            print("\nStopped by user.")
    else:
        # Static single scenario mode
        logger.info(f"Running static scenario: [{args.mode}]")
        try:
            while node.running:
                node.publish_packet()
                time.sleep(node.interval)
        except KeyboardInterrupt:
            pass

    node.stop()


if __name__ == "__main__":
    main()
