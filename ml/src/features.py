"""Feature Engineering for Marine Pollution ML Pipeline.

Provides consistent feature extraction for training, evaluation, and
real-time inference in backend services.
"""

from __future__ import annotations

from typing import List, Tuple
import numpy as np
import pandas as pd


FEATURE_COLS = [
    "temp_c",
    "ph",
    "tds_ppm",
    "turbidity_ntu",
    "color_r",
    "color_g",
    "color_b",
    "g_to_r_ratio",
    "b_to_r_ratio",
    "turb_tds_ratio",
    "hour_sin",
    "hour_cos",
    "ph_diff_5",
    "tds_diff_5",
    "turb_diff_5",
    "temp_diff_5",
    "ph_roll_std_15",
    "turb_roll_std_15",
]


def extract_features(df: pd.DataFrame) -> pd.DataFrame:
    """Extract physics-informed features from raw sensor data.

    Expects columns: ts, node_id, temp_c, ph, tds_ppm, turbidity_ntu, color_r, color_g, color_b.
    Returns DataFrame with FEATURE_COLS.
    """
    df = df.copy()

    # Parse timestamps for diurnal cycles
    if not pd.api.types.is_datetime64_any_dtype(df["ts"]):
        dt_series = pd.to_datetime(df["ts"])
    else:
        dt_series = df["ts"]

    hour = dt_series.dt.hour + dt_series.dt.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

    # Optical and chemical ratios
    df["g_to_r_ratio"] = (df["color_g"] + 1.0) / (df["color_r"] + 1.0)
    df["b_to_r_ratio"] = (df["color_b"] + 1.0) / (df["color_r"] + 1.0)
    df["turb_tds_ratio"] = df["turbidity_ntu"] / (df["tds_ppm"] + 1.0)

    # Compute per-node dynamic features (differentials & rolling volatility)
    # Grouping by node_id preserves sequence integrity
    df["ph_diff_5"] = df.groupby("node_id")["ph"].diff(5).fillna(0.0)
    df["tds_diff_5"] = df.groupby("node_id")["tds_ppm"].diff(5).fillna(0.0)
    df["turb_diff_5"] = df.groupby("node_id")["turbidity_ntu"].diff(5).fillna(0.0)
    df["temp_diff_5"] = df.groupby("node_id")["temp_c"].diff(5).fillna(0.0)

    df["ph_roll_std_15"] = (
        df.groupby("node_id")["ph"]
        .rolling(window=15, min_periods=1)
        .std()
        .reset_index(level=0, drop=True)
        .fillna(0.0)
    )
    df["turb_roll_std_15"] = (
        df.groupby("node_id")["turbidity_ntu"]
        .rolling(window=15, min_periods=1)
        .std()
        .reset_index(level=0, drop=True)
        .fillna(0.0)
    )

    return df[FEATURE_COLS]


def extract_features_single(
    current: dict,
    history: List[dict] | None = None,
) -> np.ndarray:
    """Extract feature vector for a single real-time observation using recent history.

    history: List of recent raw measurement dicts for the same node (e.g. last 15-20 readings).
    Returns 1D numpy array of shape (len(FEATURE_COLS),).
    """
    if history is None or len(history) == 0:
        full_records = [current]
    else:
        full_records = history + [current]

    df_recent = pd.DataFrame(full_records)
    feat_df = extract_features(df_recent)
    return feat_df.iloc[-1].to_numpy()

