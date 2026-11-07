"""Synthetic Marine Pollution Dataset Generator.

Generates realistic time-series sensor data for coastal marine water quality
monitoring nodes (ESP32 nodes). Simulates natural environmental baselines
(diurnal cycles, M2 semi-diurnal tidal cycles, sensor noise, sensor drift)
and injects labeled pollution anomaly events.

Target classes:
- normal: Baseline natural fluctuations.
- domestic_sewage: Decreased pH, high TDS, elevated turbidity, slight temp rise.
- acidic_industrial: Severe pH drop (<5.5), high TDS, slight turbidity rise.
- algal_bloom: Abnormally high pH (>8.7), high turbidity, strong green/red color shift.
- runoff_sediment: Low TDS (freshwater intrusion), extreme turbidity, slight temp drop.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd


CLASSES = [
    "normal",
    "domestic_sewage",
    "acidic_industrial",
    "algal_bloom",
    "runoff_sediment",
]


def smooth_event_profile(length: int, attack_ratio: float = 0.2, decay_ratio: float = 0.3) -> np.ndarray:
    """Generate a smooth bell-shaped/trapezoid profile [0.0, 1.0] for realistic event transitions."""
    if length <= 1:
        return np.ones(length)
    attack_len = max(1, int(length * attack_ratio))
    decay_len = max(1, int(length * decay_ratio))
    sustain_len = max(0, length - attack_len - decay_len)

    attack = 0.5 * (1 - np.cos(np.linspace(0, np.pi, attack_len)))
    sustain = np.ones(sustain_len)
    decay = 0.5 * (1 + np.cos(np.linspace(0, np.pi, decay_len)))
    profile = np.concatenate([attack, sustain, decay])
    if len(profile) < length:
        profile = np.pad(profile, (0, length - len(profile)), mode="edge")
    elif len(profile) > length:
        profile = profile[:length]
    return profile


def generate_node_baseline(
    timestamps: pd.DatetimeIndex,
    node_id: str,
    phase_offset_hours: float = 0.0,
    rng: np.random.Generator | None = None,
) -> pd.DataFrame:
    """Generate baseline environmental dynamics without pollution events."""
    if rng is None:
        rng = np.random.default_rng(42)

    n = len(timestamps)
    hours = np.array([(ts - timestamps[0]).total_seconds() / 3600.0 for ts in timestamps])
    day_of_year = timestamps.dayofyear.to_numpy()
    hour_of_day = timestamps.hour.to_numpy() + timestamps.minute.to_numpy() / 60.0

    # 1. Diurnal cycle (24h period)
    # Peak water temperature around 14:00, trough around 05:00
    diurnal_temp = np.sin(2 * np.pi * (hour_of_day - 8.0) / 24.0)
    # Photosynthesis increases pH during daytime (peaks ~14:00), drops at night
    diurnal_ph = np.sin(2 * np.pi * (hour_of_day - 8.0) / 24.0)

    # 2. Semi-diurnal tidal cycle M2 (period 12.4206 hours)
    tidal_time = hours + phase_offset_hours
    m2_period = 12.4206
    tide_height = np.sin(2 * np.pi * tidal_time / m2_period)
    # Tidal current speed (max at mid-tide when rate of change of tide is highest)
    tide_current = np.abs(np.cos(2 * np.pi * tidal_time / m2_period))

    # 3. Seasonal / synoptic weather drift (multi-day variations)
    weather_cycle = np.sin(2 * np.pi * hours / (24.0 * 7.0)) * 0.8

    # 4. Sensor Drift (slow electrochemical glass electrode drift on pH)
    # Typically drifts ~ -0.004 pH / day unless recalibrated
    drift_ph = -0.0035 * (hours / 24.0)
    # Simulate a periodic recalibration every 20 days resetting drift partially
    recal_steps = (hours // (24.0 * 20.0))
    drift_ph += recal_steps * 0.05

    # Base values
    node_delta = 0.3 if node_id == "node01" else -0.3
    base_temp = 27.5 + node_delta + 1.8 * diurnal_temp + 0.3 * tide_height + weather_cycle
    base_ph = 8.05 + 0.12 * diurnal_ph + 0.04 * tide_height + drift_ph
    # Coastal brackish/seawater TDS (base around 2100-2400 ppm for prototype estuary demo)
    base_tds = 2200.0 + (50 if node_id == "node01" else -50) + 280.0 * tide_height
    # Baseline turbidity: low (3-7 NTU), elevated when tidal current stirs sediment
    base_turbidity = 5.0 + 2.5 * tide_current + 0.5 * np.maximum(0, tide_height)

    # Base Colors (clear coastal greenish-blue water)
    base_r = np.full(n, 100.0) + 5.0 * tide_current
    base_g = np.full(n, 140.0) + 8.0 * diurnal_ph
    base_b = np.full(n, 125.0) - 6.0 * tide_current

    # 5. Gaussian Sensor Noise
    temp_c = base_temp + rng.normal(0, 0.15, n)
    ph = base_ph + rng.normal(0, 0.03, n)
    tds_ppm = base_tds + rng.normal(0, 18.0, n)
    turbidity_ntu = base_turbidity + rng.normal(0, 0.3, n)

    color_r = np.clip(base_r + rng.normal(0, 3.0, n), 0, 255).astype(int)
    color_g = np.clip(base_g + rng.normal(0, 3.0, n), 0, 255).astype(int)
    color_b = np.clip(base_b + rng.normal(0, 3.0, n), 0, 255).astype(int)

    # RSSI: typical Wi-Fi signal (-62 dBm to -74 dBm) with noise
    rssi_base = -63 if node_id == "node01" else -68
    rssi = np.clip(rssi_base + rng.normal(0, 2.5, n), -95, -40).astype(int)

    df = pd.DataFrame({
        "node_id": node_id,
        "ts": [ts.strftime("%Y-%m-%dT%H:%M:%SZ") for ts in timestamps],
        "temp_c": np.round(temp_c, 2),
        "ph": np.round(ph, 2),
        "tds_ppm": np.round(tds_ppm, 1),
        "turbidity_ntu": np.round(np.clip(turbidity_ntu, 0.1, None), 2),
        "color_r": color_r,
        "color_g": color_g,
        "color_b": color_b,
        "rssi": rssi,
        "label": "normal",
        "is_anomaly": 0,
    })
    return df


def inject_pollution_events(
    df: pd.DataFrame,
    rng: np.random.Generator,
    num_events: int = 45,
) -> pd.DataFrame:
    """Inject labeled pollution anomalies into the baseline dataframe."""
    n = len(df)
    temp = df["temp_c"].to_numpy().copy()
    ph = df["ph"].to_numpy().copy()
    tds = df["tds_ppm"].to_numpy().copy()
    turb = df["turbidity_ntu"].to_numpy().copy()
    col_r = df["color_r"].to_numpy().copy()
    col_g = df["color_g"].to_numpy().copy()
    col_b = df["color_b"].to_numpy().copy()
    labels = df["label"].to_numpy().copy()
    is_anomaly = df["is_anomaly"].to_numpy().copy()

    event_types = ["domestic_sewage", "acidic_industrial", "algal_bloom", "runoff_sediment"]
    event_weights = [0.35, 0.25, 0.15, 0.25]

    # Generate random event start indices ensuring space
    potential_starts = np.sort(rng.choice(np.arange(100, n - 3000), size=num_events, replace=False))

    for start_idx in potential_starts:
        event_type = rng.choice(event_types, p=event_weights)

        if event_type == "domestic_sewage":
            # Duration: 45 min to 3.5 hours (at 1 min/step)
            dur = rng.integers(45, 210)
            profile = smooth_event_profile(dur, attack_ratio=0.15, decay_ratio=0.35)
            end_idx = min(n, start_idx + dur)
            eff_len = end_idx - start_idx
            p = profile[:eff_len]

            # Effects: pH drops moderately, TDS jumps, turbidity spikes, slight temp rise
            ph[start_idx:end_idx] -= p * rng.uniform(0.7, 1.4)
            tds[start_idx:end_idx] += p * rng.uniform(700, 1800)
            turb[start_idx:end_idx] += p * rng.uniform(35, 110)
            temp[start_idx:end_idx] += p * rng.uniform(0.5, 1.4)
            # Dark / greyish water
            col_r[start_idx:end_idx] = np.clip(col_r[start_idx:end_idx] - p * 25, 0, 255)
            col_g[start_idx:end_idx] = np.clip(col_g[start_idx:end_idx] - p * 30, 0, 255)
            col_b[start_idx:end_idx] = np.clip(col_b[start_idx:end_idx] - p * 35, 0, 255)

        elif event_type == "acidic_industrial":
            # Duration: 30 min to 2.5 hours (illegal night/dawn discharge)
            dur = rng.integers(30, 150)
            profile = smooth_event_profile(dur, attack_ratio=0.1, decay_ratio=0.3)
            end_idx = min(n, start_idx + dur)
            eff_len = end_idx - start_idx
            p = profile[:eff_len]

            # Effects: Severe pH drop (<5.5, down to 3.8 - 5.0), high TDS (dissolved ions)
            target_ph_drop = rng.uniform(2.6, 4.2)
            ph[start_idx:end_idx] -= p * target_ph_drop
            tds[start_idx:end_idx] += p * rng.uniform(500, 1500)
            turb[start_idx:end_idx] += p * rng.uniform(5, 25)
            # Yellowish tint from chemical effluents
            col_r[start_idx:end_idx] = np.clip(col_r[start_idx:end_idx] + p * 40, 0, 255)
            col_g[start_idx:end_idx] = np.clip(col_g[start_idx:end_idx] + p * 20, 0, 255)

        elif event_type == "algal_bloom":
            # Duration: 8 hours to 36 hours (prolonged biological bloom)
            dur = rng.integers(480, 2160)
            profile = smooth_event_profile(dur, attack_ratio=0.3, decay_ratio=0.4)
            end_idx = min(n, start_idx + dur)
            eff_len = end_idx - start_idx
            p = profile[:eff_len]

            # Effects: High pH (>8.7 - 9.4), high turbidity, strong green/red color shift
            ph[start_idx:end_idx] += p * rng.uniform(0.7, 1.4)
            turb[start_idx:end_idx] += p * rng.uniform(25, 75)
            tds[start_idx:end_idx] += p * rng.uniform(100, 350)
            # Intense green shift (chlorophyll) or reddish-brown (dinoflagellates)
            if rng.random() > 0.3:
                # Green bloom
                col_g[start_idx:end_idx] = np.clip(col_g[start_idx:end_idx] + p * 65, 0, 255)
                col_r[start_idx:end_idx] = np.clip(col_r[start_idx:end_idx] - p * 30, 0, 255)
            else:
                # Red tide
                col_r[start_idx:end_idx] = np.clip(col_r[start_idx:end_idx] + p * 70, 0, 255)
                col_g[start_idx:end_idx] = np.clip(col_g[start_idx:end_idx] - p * 20, 0, 255)

        elif event_type == "runoff_sediment":
            # Duration: 3 hours to 14 hours (post-storm river plume)
            dur = rng.integers(180, 840)
            profile = smooth_event_profile(dur, attack_ratio=0.15, decay_ratio=0.45)
            end_idx = min(n, start_idx + dur)
            eff_len = end_idx - start_idx
            p = profile[:eff_len]

            # Effects: Freshwater drops TDS dramatically, massive suspended sediment turbidity
            tds[start_idx:end_idx] -= p * rng.uniform(500, 1100)
            turb[start_idx:end_idx] += p * rng.uniform(70, 260)
            temp[start_idx:end_idx] -= p * rng.uniform(0.8, 2.2)
            ph[start_idx:end_idx] -= p * rng.uniform(0.3, 0.7)
            # Muddy brown water
            col_r[start_idx:end_idx] = np.clip(col_r[start_idx:end_idx] + p * 55, 0, 255)
            col_g[start_idx:end_idx] = np.clip(col_g[start_idx:end_idx] + p * 35, 0, 255)
            col_b[start_idx:end_idx] = np.clip(col_b[start_idx:end_idx] - p * 45, 0, 255)

        # Mark anomaly label where profile > 0.2
        active_indices = start_idx + np.where(profile[:eff_len] > 0.2)[0]
        labels[active_indices] = event_type
        is_anomaly[active_indices] = 1

    df["temp_c"] = np.round(temp, 2)
    df["ph"] = np.round(np.clip(ph, 1.0, 14.0), 2)
    df["tds_ppm"] = np.round(np.clip(tds, 50.0, None), 1)
    df["turbidity_ntu"] = np.round(np.clip(turb, 0.1, None), 2)
    df["color_r"] = col_r.astype(int)
    df["color_g"] = col_g.astype(int)
    df["color_b"] = col_b.astype(int)
    df["label"] = labels
    df["is_anomaly"] = is_anomaly.astype(int)

    return df


def generate_dataset(
    days: int = 60,
    freq: str = "1min",
    start_time: str = "2026-09-01T00:00:00Z",
    seed: int = 42,
    num_events_per_node: int = 50,
) -> pd.DataFrame:
    """Generate combined multi-node synthetic dataset."""
    rng = np.random.default_rng(seed)
    start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(days=days)
    timestamps = pd.date_range(start=start_dt, end=end_dt, freq=freq, inclusive="left")

    print(f"Generating synthetic data: {days} days ({len(timestamps)} timestamps per node)...")

    # Node 01
    df1 = generate_node_baseline(timestamps, node_id="node01", phase_offset_hours=0.0, rng=rng)
    df1 = inject_pollution_events(df1, rng=rng, num_events=num_events_per_node)
    df1["seq"] = np.arange(1, len(df1) + 1)

    # Node 02 (tidal phase offset 0.5h, slightly different events)
    rng_node2 = np.random.default_rng(seed + 101)
    df2 = generate_node_baseline(timestamps, node_id="node02", phase_offset_hours=0.5, rng=rng_node2)
    df2 = inject_pollution_events(df2, rng=rng_node2, num_events=num_events_per_node)
    df2["seq"] = np.arange(1, len(df2) + 1)

    # Combine and sort by timestamp
    combined = pd.concat([df1, df2], ignore_index=True)
    combined = combined.sort_values(by=["ts", "node_id"]).reset_index(drop=True)

    # Reorder columns to align with docs/data-schema.md
    cols = [
        "node_id",
        "seq",
        "ts",
        "temp_c",
        "ph",
        "tds_ppm",
        "turbidity_ntu",
        "color_r",
        "color_g",
        "color_b",
        "rssi",
        "label",
        "is_anomaly",
    ]
    return combined[cols]


def print_summary(df: pd.DataFrame) -> None:
    """Print statistical breakdown of the dataset."""
    total = len(df)
    anomalies = (df["is_anomaly"] == 1).sum()
    pct_anomaly = (anomalies / total) * 100

    print("=" * 60)
    print(f"SYNTHETIC DATASET SUMMARY")
    print("=" * 60)
    print(f"Total records:      {total:,}")
    print(f"Normal records:     {(df['label'] == 'normal').sum():,} ({(100 - pct_anomaly):.2f}%)")
    print(f"Anomaly records:    {anomalies:,} ({pct_anomaly:.2f}%)")
    print(f"Nodes:              {df['node_id'].unique().tolist()}")
    print(f"Time range:         {df['ts'].min()} to {df['ts'].max()}")
    print("\nClass Breakdown:")
    for cls_name, count in df["label"].value_counts().items():
        print(f"  - {cls_name:<20}: {count:>8,} ({count/total*100:>5.2f}%)")

    print("\nPhysical Parameters Range:")
    for col in ["temp_c", "ph", "tds_ppm", "turbidity_ntu"]:
        print(f"  - {col:<15}: min={df[col].min():>6.2f}, mean={df[col].mean():>6.2f}, max={df[col].max():>6.2f}")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic coastal marine IoT sensor data.")
    parser.add_argument("--days", type=int, default=60, help="Simulation duration in days (default: 60).")
    parser.add_argument("--freq", type=str, default="1min", help="Sampling frequency (default: '1min').")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    parser.add_argument(
        "--output",
        type=str,
        default="ml/data/synthetic/synthetic_marine_data.csv",
        help="Path to save the generated CSV file.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df = generate_dataset(days=args.days, freq=args.freq, seed=args.seed)
    df.to_csv(output_path, index=False)
    print(f"\n[OK] Dataset successfully exported to: {output_path.resolve()}")
    print_summary(df)


if __name__ == "__main__":
    main()
