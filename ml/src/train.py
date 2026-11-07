"""Training Script for Coastal Marine Water Quality Anomaly & Cause Models.

Pipeline:
1. Preprocess & extract features (physics ratios, diurnal cycle, rolling dynamics).
2. Train Stage 1: Isolation Forest (unsupervised / semi-supervised anomaly detection).
3. Train Stage 2: Random Forest Classifier (supervised multi-class cause classification).
4. Save trained models, scaler, and metadata into ml/models/marine_model.joblib.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import classification_report, f1_score
from sklearn.preprocessing import StandardScaler

# Support relative and absolute package imports
sys.path.append(str(Path(__file__).resolve().parent))
from features import FEATURE_COLS, extract_features


CLASSES = [
    "normal",
    "domestic_sewage",
    "acidic_industrial",
    "algal_bloom",
    "runoff_sediment",
]


def train_models(
    data_path: str = "ml/data/synthetic/synthetic_marine_data.csv",
    models_dir: str = "ml/models",
    train_ratio: float = 0.75,
    seed: int = 42,
) -> dict:
    """Load data, engineer features, train Isolation Forest & Random Forest, and save artifacts."""
    print(f"Loading data from: {data_path}...")
    df = pd.read_csv(data_path)
    print(f"Total rows: {len(df):,}")

    # Ensure chronological order
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.sort_values(by=["ts", "node_id"]).reset_index(drop=True)

    # Chronological train/test split to prevent temporal leakage
    unique_ts = df["ts"].drop_duplicates().sort_values().reset_index(drop=True)
    split_idx = int(len(unique_ts) * train_ratio)
    split_ts = unique_ts.iloc[split_idx]

    train_mask = df["ts"] < split_ts
    test_mask = df["ts"] >= split_ts

    train_df = df[train_mask].reset_index(drop=True)
    test_df = df[test_mask].reset_index(drop=True)

    print(f"Train split: {len(train_df):,} rows ({train_df['ts'].min()} to {train_df['ts'].max()})")
    print(f"Test split:  {len(test_df):,} rows ({test_df['ts'].min()} to {test_df['ts'].max()})")

    # Save test partition for separate evaluation
    test_split_path = Path("ml/data/synthetic/test_split.csv")
    test_df.to_csv(test_split_path, index=False)
    print(f"Saved evaluation test split to: {test_split_path}")

    # Feature engineering
    print("Extracting features...")
    X_train_df = extract_features(train_df)
    X_test_df = extract_features(test_df)

    y_train_anomaly = train_df["is_anomaly"].to_numpy()
    y_test_anomaly = test_df["is_anomaly"].to_numpy()

    y_train_label = train_df["label"].to_numpy()
    y_test_label = test_df["label"].to_numpy()

    # Fit StandardScaler
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_df)
    X_test_scaled = scaler.transform(X_test_df)

    # -------------------------------------------------------------
    # Stage 1: Isolation Forest (Anomaly Detection)
    # -------------------------------------------------------------
    print("\n[Stage 1] Training Isolation Forest for Anomaly Detection...")
    # Calculate empirical anomaly proportion in train set
    contamination_rate = max(0.01, min(0.30, float(np.mean(y_train_anomaly))))
    print(f"Contamination rate set to: {contamination_rate:.4f}")

    iso_forest = IsolationForest(
        n_estimators=150,
        contamination=contamination_rate,
        max_samples="auto",
        random_state=seed,
        n_jobs=-1,
    )
    iso_forest.fit(X_train_scaled)

    # Predict: IsolationForest returns 1 for inlier (normal), -1 for outlier (anomaly)
    iso_train_pred = np.where(iso_forest.predict(X_train_scaled) == -1, 1, 0)
    iso_test_pred = np.where(iso_forest.predict(X_test_scaled) == -1, 1, 0)

    iso_f1_test = f1_score(y_test_anomaly, iso_test_pred)
    print(f"Isolation Forest Test F1-Score (Anomaly detection): {iso_f1_test:.4f}")

    # -------------------------------------------------------------
    # Stage 2: Random Forest Classifier (Multi-class Cause Classification)
    # -------------------------------------------------------------
    print("\n[Stage 2] Training Random Forest for Cause Classification...")
    rf_clf = RandomForestClassifier(
        n_estimators=120,
        max_depth=14,
        min_samples_split=5,
        class_weight="balanced",
        random_state=seed,
        n_jobs=-1,
    )
    rf_clf.fit(X_train_df, y_train_label)

    rf_test_pred = rf_clf.predict(X_test_df)
    rf_f1_macro = f1_score(y_test_label, rf_test_pred, average="macro")
    rf_f1_weighted = f1_score(y_test_label, rf_test_pred, average="weighted")

    print(f"Random Forest Test Macro F1:    {rf_f1_macro:.4f}")
    print(f"Random Forest Test Weighted F1: {rf_f1_weighted:.4f}")

    print("\nClassification Report (Test Split):")
    print(classification_report(y_test_label, rf_test_pred, digits=4))

    # Feature Importance analysis
    feature_importances = dict(zip(FEATURE_COLS, rf_clf.feature_importances_))
    sorted_importance = sorted(feature_importances.items(), key=lambda x: x[1], reverse=True)
    print("\nTop 8 Most Informative Features:")
    for feat_name, imp in sorted_importance[:8]:
        print(f"  - {feat_name:<20}: {imp*100:>5.2f}%")

    # -------------------------------------------------------------
    # Save Model Artifacts
    # -------------------------------------------------------------
    models_dir_path = Path(models_dir)
    models_dir_path.mkdir(parents=True, exist_ok=True)
    artifact_path = models_dir_path / "marine_model.joblib"

    artifact = {
        "scaler": scaler,
        "anomaly_detector": iso_forest,
        "cause_classifier": rf_clf,
        "classes": rf_clf.classes_.tolist(),
        "feature_cols": FEATURE_COLS,
        "feature_importance": feature_importances,
        "metadata": {
            "trained_at": datetime.utcnow().isoformat() + "Z",
            "train_samples": len(train_df),
            "test_samples": len(test_df),
            "contamination_rate": contamination_rate,
            "iso_forest_f1_test": float(iso_f1_test),
            "rf_macro_f1_test": float(rf_f1_macro),
            "rf_weighted_f1_test": float(rf_f1_weighted),
        },
    }

    joblib.dump(artifact, artifact_path, compress=3)
    print(f"\n[OK] Trained model artifact saved to: {artifact_path.resolve()}")
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ML models for marine pollution monitoring.")
    parser.add_argument(
        "--data",
        type=str,
        default="ml/data/synthetic/synthetic_marine_data.csv",
        help="Path to synthetic dataset CSV.",
    )
    parser.add_argument(
        "--models-dir",
        type=str,
        default="ml/models",
        help="Directory to save trained model artifacts.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    args = parser.parse_args()

    train_models(data_path=args.data, models_dir=args.models_dir, seed=args.seed)


if __name__ == "__main__":
    main()

