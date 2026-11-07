"""Real-time ML Inference Service for Anomaly Detection & Cause Classification."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

from app.config import MODEL_PATH

logger = logging.getLogger("marine.ml")

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


class MLService:
    """Manages ML models, per-node rolling telemetry buffers, and real-time inference."""

    def __init__(self, model_path: str = MODEL_PATH) -> None:
        self.model_path = model_path
        self.scaler: Any = None
        self.anomaly_detector: Any = None
        self.cause_classifier: Any = None
        self.classes: List[str] = []
        self.is_loaded: bool = False

        # In-memory history buffer: node_id -> deque of recent measurements (maxlen=30)
        self.node_history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=30))

        self.load_model()

    def load_model(self) -> bool:
        """Load trained models and scaler from joblib artifact."""
        path = Path(self.model_path)
        if not path.exists():
            logger.warning(f"ML model file not found at: {path}. Using fallback heuristic rules.")
            self.is_loaded = False
            return False

        try:
            logger.info(f"Loading ML models from: {path}...")
            artifact = joblib.load(path)
            self.scaler = artifact["scaler"]
            self.anomaly_detector = artifact["anomaly_detector"]
            self.cause_classifier = artifact["cause_classifier"]
            self.classes = artifact["classes"]
            self.is_loaded = True
            logger.info(f"ML models loaded successfully! Classes: {self.classes}")
            return True
        except Exception as e:
            logger.error(f"Failed to load ML model artifact: {e}")
            self.is_loaded = False
            return False

    def _extract_features(self, node_id: str, current: Dict[str, Any]) -> pd.DataFrame:
        """Extract physics-informed features using recent history for differential metrics."""
        history_list = list(self.node_history[node_id])
        full_records = history_list + [current]

        df = pd.DataFrame(full_records)

        # Parse timestamps for diurnal cycles
        if not pd.api.types.is_datetime64_any_dtype(df["ts"]):
            dt_series = pd.to_datetime(df["ts"])
        else:
            dt_series = df["ts"]

        hour = dt_series.dt.hour + dt_series.dt.minute / 60.0
        df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
        df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

        # Optical & chemical ratios
        df["g_to_r_ratio"] = (df["color_g"] + 1.0) / (df["color_r"] + 1.0)
        df["b_to_r_ratio"] = (df["color_b"] + 1.0) / (df["color_r"] + 1.0)
        df["turb_tds_ratio"] = df["turbidity_ntu"] / (df["tds_ppm"] + 1.0)

        # Dynamic differential metrics
        df["ph_diff_5"] = df["ph"].diff(5).fillna(0.0)
        df["tds_diff_5"] = df["tds_ppm"].diff(5).fillna(0.0)
        df["turb_diff_5"] = df["turbidity_ntu"].diff(5).fillna(0.0)
        df["temp_diff_5"] = df["temp_c"].diff(5).fillna(0.0)

        df["ph_roll_std_15"] = df["ph"].rolling(window=15, min_periods=1).std().fillna(0.0)
        df["turb_roll_std_15"] = df["turbidity_ntu"].rolling(window=15, min_periods=1).std().fillna(0.0)

        return df[FEATURE_COLS].iloc[[-1]]

    def predict(self, measurement: Dict[str, Any]) -> Tuple[bool, str, float]:
        """Perform 2-stage inference on an incoming measurement dict.

        Returns:
            (is_anomaly: bool, cause: str, confidence: float)
        """
        node_id = measurement["node_id"]

        # If model is not loaded, use fallback rule-based classification
        if not self.is_loaded:
            is_anomaly, cause, conf = self._fallback_rule_based(measurement)
            self.node_history[node_id].append(measurement)
            return is_anomaly, cause, conf

        try:
            feat_df = self._extract_features(node_id, measurement)
            feat_scaled = self.scaler.transform(feat_df)

            # Stage 1: Isolation Forest (-1 = anomaly, 1 = normal)
            iso_pred = self.anomaly_detector.predict(feat_scaled)[0]
            is_anomaly = bool(iso_pred == -1)

            # Stage 2: Random Forest Cause Classifier
            probs = self.cause_classifier.predict_proba(feat_df)[0]
            best_idx = int(np.argmax(probs))
            cause = self.cause_classifier.classes_[best_idx]
            confidence = float(probs[best_idx] * 100.0)

            # If Stage 1 detected an anomaly but Random Forest classified as "normal",
            # inspect secondary probabilities or flag anomaly
            if is_anomaly and cause == "normal":
                # Find highest non-normal cause
                non_normal_indices = [
                    i for i, c in enumerate(self.cause_classifier.classes_) if c != "normal"
                ]
                if non_normal_indices:
                    sub_idx = max(non_normal_indices, key=lambda i: probs[i])
                    if probs[sub_idx] > 0.15:
                        cause = self.cause_classifier.classes_[sub_idx]
                        confidence = float(probs[sub_idx] * 100.0)

            # If classified as a pollution event with high confidence, treat as anomaly
            if cause != "normal" and confidence >= 60.0:
                is_anomaly = True

            # Append current to history
            self.node_history[node_id].append(measurement)
            return is_anomaly, cause, round(confidence, 1)

        except Exception as e:
            logger.error(f"Error during ML inference: {e}")
            self.node_history[node_id].append(measurement)
            return self._fallback_rule_based(measurement)

    def _fallback_rule_based(self, m: Dict[str, Any]) -> Tuple[bool, str, float]:
        """Graceful fallback heuristic rules when ML model is unavailable."""
        ph = float(m.get("ph", 7.0))
        tds = float(m.get("tds_ppm", 1000.0))
        turb = float(m.get("turbidity_ntu", 5.0))

        if ph < 5.5:
            return True, "acidic_industrial", 95.0
        elif ph > 8.7 and turb > 25.0:
            return True, "algal_bloom", 90.0
        elif turb > 45.0 and tds < 1500.0:
            return True, "runoff_sediment", 88.0
        elif tds > 2900.0 and turb > 25.0:
            return True, "domestic_sewage", 85.0
        elif ph < 6.5 or ph > 8.5 or turb > 30.0:
            return True, "domestic_sewage", 70.0
        return False, "normal", 96.0


ml_service = MLService()
