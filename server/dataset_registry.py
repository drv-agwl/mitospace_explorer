"""
Per-version dataset registry for the MitoSpace backend.

Each Dataset bundles together everything one dataset version needs to serve
the Semantic Axis API:
  - 3D UMAP coords (one row per sample)
  - feature_values: dict[feature_name -> np.ndarray] (one value per sample)
  - feature_umap_model: dict[feature_name -> sklearn MLPRegressor]
    (a learnt curve that maps a scalar feature value to a UMAP (x,y,z) point)

The registry exposes both v1 (the original 2024 LLSM dataset) and v3 (the
expanded 2025 dataset) as independent datasets that the API can switch
between via a `?version=v1|v3` query param.

We deliberately keep the parquet (v3) and CSV (v1) loading paths in this
single module so adding a v4 later is trivial.
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd


# Trim outliers from feature ranges; use percentile bounds instead of raw min/max
FEATURE_PERCENTILE_LOW = 2
FEATURE_PERCENTILE_HIGH = 98


def feature_bounds(arr: np.ndarray) -> Tuple[float, float]:
    """Return (min, max) using percentile bounds to exclude outliers."""
    valid = arr[~np.isnan(arr)]
    if len(valid) < 2:
        if len(valid) == 1:
            v = float(valid[0])
            return (v, v)
        return (0.0, 1.0)
    lo, hi = np.nanpercentile(arr, [FEATURE_PERCENTILE_LOW, FEATURE_PERCENTILE_HIGH])
    return float(lo), float(hi)


@dataclass
class Dataset:
    version: str
    umap_points: Optional[np.ndarray] = None
    feature_values: Dict[str, np.ndarray] = field(default_factory=dict)
    feature_umap_model: Dict[str, Any] = field(default_factory=dict)
    # Per-row drug labels (for chat queries that filter by drug)
    drug_labels: Optional[np.ndarray] = None
    moa_labels: Optional[np.ndarray] = None

    @property
    def loaded(self) -> bool:
        return self.umap_points is not None and len(self.feature_values) > 0


def _fit_axis_models(ds: Dataset, features: Iterable[str]) -> None:
    """Fit one MLPRegressor per feature: scalar feature value -> (x, y, z) UMAP."""
    if ds.umap_points is None:
        return
    try:
        from sklearn.neural_network import MLPRegressor
    except ImportError:
        print("[dataset_registry] sklearn not available; skipping axis fit")
        return

    for fname in features:
        fvals = ds.feature_values.get(fname)
        if fvals is None or len(fvals) != len(ds.umap_points):
            continue
        valid = ~np.isnan(fvals)
        if int(np.sum(valid)) < 10:
            continue
        X = np.asarray(fvals[valid], dtype=np.float64).reshape(-1, 1)
        y = ds.umap_points[valid].astype(np.float64)
        try:
            model = MLPRegressor(
                hidden_layer_sizes=(64,),
                max_iter=200,
                alpha=0.1,
                random_state=42,
            )
            model.fit(X, y)
            ds.feature_umap_model[fname] = model
            print(f"[dataset_registry][{ds.version}] fitted axis model: {fname}")
        except Exception as exc:  # pragma: no cover - sklearn fit edge cases
            print(f"[dataset_registry][{ds.version}] axis fit failed for {fname}: {exc}")


# ─── v1 loader ────────────────────────────────────────────────────────────

def load_v1(filtered_dir: Path) -> Dataset:
    """v1 = original 2024 dataset stored as separate .npy + CSV files."""
    ds = Dataset(version="v1")

    umap_path = filtered_dir / "umap_points.npy"
    if umap_path.exists():
        ds.umap_points = np.load(umap_path)
        print(f"[dataset_registry][v1] loaded {umap_path.name} ({len(ds.umap_points)} pts)")

    csv_path = filtered_dir / "mitotnt_features.csv"
    if csv_path.exists():
        df = pd.read_csv(csv_path)
        # The original surface features that the existing UI exposes
        for col in ("Segment Length", "TMRM Intensity", "Optical Flow (fg)", "Fragment Length"):
            if col in df.columns:
                vals = df[col].fillna(df[col].mean())
                ds.feature_values[col] = vals.values.astype(np.float64)
                print(f"[dataset_registry][v1] loaded feature: {col} ({len(vals)} pts)")

    _fit_axis_models(ds, list(ds.feature_values.keys()))
    return ds


# ─── v3 loader ────────────────────────────────────────────────────────────

# The 8 features the v3 frontend exposes via FEATURE_GROUPS_V3.
# Order is informational only; the order in feature_umap_model dict is
# what `/api/health` reports as `axes`.
V3_AXIS_FEATURES = (
    "fragment_length_mean",
    "segment_length_mean",
    "fragment_diameter_mean",
    "fragment_tortuosity_mean",
    "fragment_diffusivity_mean",
    "fission_rate_mean",
    "fusion_rate_mean",
    "tmrm_last",  # synthetic: last timepoint of `tmrm_intensities`
)


def _array_last(value) -> float:
    """Last element of a list/np.ndarray, or NaN if not available."""
    try:
        if value is None:
            return float("nan")
        arr = np.asarray(value, dtype=np.float64)
        if arr.size == 0:
            return float("nan")
        return float(arr[-1])
    except Exception:
        return float("nan")


def load_v3(parquet_path: Path) -> Dataset:
    """v3 = 2025 expanded dataset stored in a single slim parquet."""
    ds = Dataset(version="v3")
    if not parquet_path.exists():
        print(f"[dataset_registry][v3] parquet not found: {parquet_path}")
        return ds

    print(f"[dataset_registry][v3] loading {parquet_path.name} ({parquet_path.stat().st_size / 1e6:.1f} MB)...")
    df = pd.read_parquet(parquet_path)
    n = len(df)
    print(f"[dataset_registry][v3] rows={n} cols={len(df.columns)}")

    # 3D UMAP (stored as a list-per-row column)
    if "embeddings_umap" in df.columns:
        umap_arr = np.array([np.asarray(v, dtype=np.float64) for v in df["embeddings_umap"]])
        if umap_arr.ndim == 2 and umap_arr.shape[1] == 3:
            ds.umap_points = umap_arr

    # Drug + MOA labels for chat queries
    if "label_names" in df.columns:
        ds.drug_labels = df["label_names"].to_numpy()
    if "labels_moa" in df.columns:
        ds.moa_labels = df["labels_moa"].to_numpy()

    # Carry over every numeric column verbatim — this lets the chat handler use
    # any of the 80+ statistics. The axis API only fits the curated subset.
    for col in df.columns:
        if df[col].dtype.kind in "biufc":  # numeric kinds
            try:
                vals = df[col].astype(np.float64)
                if vals.notna().sum() == 0:
                    continue
                # Backfill NaNs with column mean so MLP fitting won't fail
                vals = vals.fillna(vals.mean())
                ds.feature_values[col] = vals.values
            except Exception:
                continue

    # Synthetic: last-timepoint TMRM intensity (used as Membrane Potential axis)
    if "tmrm_intensities" in df.columns:
        ds.feature_values["tmrm_last"] = np.array(
            [_array_last(v) for v in df["tmrm_intensities"]], dtype=np.float64
        )
    if "morph_intensities" in df.columns:
        ds.feature_values["morph_last"] = np.array(
            [_array_last(v) for v in df["morph_intensities"]], dtype=np.float64
        )

    print(f"[dataset_registry][v3] loaded {len(ds.feature_values)} numeric features")

    _fit_axis_models(ds, V3_AXIS_FEATURES)
    return ds


# ─── Registry ─────────────────────────────────────────────────────────────

_REGISTRY: Dict[str, Dataset] = {}


def register(ds: Dataset) -> None:
    _REGISTRY[ds.version] = ds


def get(version: str) -> Dataset:
    """Return dataset for a version, with a fallback to whatever is loaded."""
    if version in _REGISTRY:
        return _REGISTRY[version]
    # Fall back to any loaded dataset so old clients don't error out
    for ds in _REGISTRY.values():
        if ds.loaded:
            return ds
    return Dataset(version=version)


def versions() -> List[str]:
    return list(_REGISTRY.keys())
