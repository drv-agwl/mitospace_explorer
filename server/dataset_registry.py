"""
Per-version dataset registry for the MitoSpace backend.

Each Dataset bundles together everything one dataset version needs to serve
the Semantic Axis API:
  - 3D UMAP coords (one row per sample)
  - feature_values: dict[feature_name -> np.ndarray] (one value per sample)
  - feature_umap_model: dict[feature_name -> sklearn Pipeline]
    (a learnt curve that maps a scalar feature value to a UMAP (x,y,z) point;
    the pipeline is StandardScaler -> MLPRegressor)

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


class BinnedPrincipalCurve:
    """A smooth 1D->3D curve through the UMAP embedding fitted by binning the
    samples along a scalar feature axis and taking the per-bin median UMAP
    position.

    Why this instead of a 1D->3D MLP regressor? For features whose
    relationship with UMAP is non-monotonic (e.g. fission/fusion rate, which
    peaks in the middle of one cluster and again in another), the MLP's
    decision boundary will weave/loop unnaturally. A binned principal curve:
      - is grounded in real data (each knot is a median over thousands of
        samples), so we never extrapolate.
      - is naturally smooth after a small rolling-mean filter on the knots.
      - works for any distribution shape (heavy-tailed, bimodal, etc.).

    Exposes the same `.predict(X) -> (N, 3)` API as a sklearn regressor so
    it slots into the existing endpoint code without changes.
    """

    def __init__(self, n_bins: int = 30, smooth_window: int = 3, min_per_bin: int = 5):
        self.n_bins = n_bins
        self.smooth_window = smooth_window
        self.min_per_bin = min_per_bin
        self.knot_values: Optional[np.ndarray] = None
        self.knot_coords: Optional[np.ndarray] = None  # (K, 3)

    def fit(self, X: np.ndarray, y: np.ndarray) -> "BinnedPrincipalCurve":
        x = np.asarray(X, dtype=np.float64).ravel()
        ymat = np.asarray(y, dtype=np.float64).reshape(-1, 3)
        if len(x) == 0:
            return self

        order = np.argsort(x)
        xs = x[order]
        ys = ymat[order]

        # Quantile-balanced bins -> equal sample count per bin (regardless of
        # whether the feature is heavy-tailed).
        n_bins = max(2, min(self.n_bins, len(xs) // max(self.min_per_bin, 1)))
        edges = np.quantile(xs, np.linspace(0.0, 1.0, n_bins + 1))
        edges = np.unique(edges)  # collapse duplicate edges (ties)
        n_eff = max(1, len(edges) - 1)
        if n_eff < 2:
            self.knot_values = np.array([float(np.median(xs))], dtype=np.float64)
            self.knot_coords = np.median(ys, axis=0, keepdims=True)
            return self

        knot_x: List[float] = []
        knot_y: List[np.ndarray] = []
        for i in range(n_eff):
            lo = edges[i]
            hi = edges[i + 1]
            if i == n_eff - 1:
                mask = (xs >= lo) & (xs <= hi)
            else:
                mask = (xs >= lo) & (xs < hi)
            if int(mask.sum()) < self.min_per_bin:
                continue
            knot_x.append(float(np.median(xs[mask])))
            knot_y.append(np.median(ys[mask], axis=0))

        if len(knot_x) < 2:
            # Fall back to overall median if we somehow lost too many bins.
            self.knot_values = np.array([float(np.median(xs))], dtype=np.float64)
            self.knot_coords = np.median(ys, axis=0, keepdims=True)
            return self

        kx = np.asarray(knot_x, dtype=np.float64)
        ky = np.asarray(knot_y, dtype=np.float64)
        order2 = np.argsort(kx)
        kx = kx[order2]
        ky = ky[order2]

        if self.smooth_window > 1 and len(ky) >= self.smooth_window:
            ky = self._rolling_mean(ky, self.smooth_window)

        # Surgical pass: locally suppress sharp reversals (>120° kinks) by
        # pulling the offending knot toward the midpoint of its neighbors.
        # This removes the worst zig-zags without flattening the overall
        # trajectory (unlike a wider rolling-mean window).
        for _ in range(3):
            ky = self._suppress_reversals(ky, cos_threshold=-0.5, blend=0.45)

        self.knot_values = kx
        self.knot_coords = ky
        return self

    @staticmethod
    def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
        n = arr.shape[0]
        half = window // 2
        out = np.empty_like(arr)
        for i in range(n):
            lo = max(0, i - half)
            hi = min(n, i + half + 1)
            out[i] = arr[lo:hi].mean(axis=0)
        return out

    @staticmethod
    def _suppress_reversals(
        arr: np.ndarray,
        cos_threshold: float = -0.5,
        blend: float = 0.45,
    ) -> np.ndarray:
        """If consecutive segments around knot i form an angle whose cosine is
        below `cos_threshold` (i.e. > ~120°), pull knot i toward the midpoint
        of its neighbors. Repeated passes converge to a kink-free curve."""
        if len(arr) < 3:
            return arr
        out = arr.copy()
        for i in range(1, len(arr) - 1):
            d1 = arr[i] - arr[i - 1]
            d2 = arr[i + 1] - arr[i]
            n1 = float(np.linalg.norm(d1))
            n2 = float(np.linalg.norm(d2))
            if n1 < 1e-9 or n2 < 1e-9:
                continue
            cos = float(np.dot(d1, d2) / (n1 * n2))
            if cos < cos_threshold:
                midpoint = 0.5 * (arr[i - 1] + arr[i + 1])
                out[i] = (1.0 - blend) * arr[i] + blend * midpoint
        return out

    def predict(self, X) -> np.ndarray:
        x = np.asarray(X, dtype=np.float64).ravel()
        if self.knot_values is None or self.knot_coords is None or len(self.knot_values) == 0:
            return np.zeros((len(x), 3), dtype=np.float64)
        kx = self.knot_values
        ky = self.knot_coords
        if len(kx) == 1:
            return np.tile(ky[0], (len(x), 1))
        out = np.empty((len(x), 3), dtype=np.float64)
        for d in range(3):
            out[:, d] = np.interp(x, kx, ky[:, d])
        return out


def _fit_axis_models(ds: Dataset, features: Iterable[str]) -> None:
    """Fit one BinnedPrincipalCurve per feature: scalar value -> (x, y, z)."""
    if ds.umap_points is None:
        return

    for fname in features:
        fvals = ds.feature_values.get(fname)
        if fvals is None or len(fvals) != len(ds.umap_points):
            continue
        valid = ~np.isnan(fvals)
        if int(np.sum(valid)) < 50:  # need enough samples to bin meaningfully
            continue
        X = np.asarray(fvals[valid], dtype=np.float64)
        y = ds.umap_points[valid].astype(np.float64)
        if float(np.std(X)) == 0.0:
            print(f"[dataset_registry][{ds.version}] skipping {fname}: zero variance")
            continue
        try:
            model = BinnedPrincipalCurve(n_bins=28, smooth_window=3, min_per_bin=10)
            model.fit(X, y)
            ds.feature_umap_model[fname] = model

            # Sanity checks: trajectory length, smoothness.
            lo, hi = float(np.percentile(X, 2)), float(np.percentile(X, 98))
            span_x = np.linspace(lo, hi, 64, dtype=np.float64)
            span_y = model.predict(span_x)
            extent = float(np.linalg.norm(np.ptp(span_y, axis=0)))
            steps = np.diff(span_y, axis=0)
            path_len = float(np.linalg.norm(steps, axis=1).sum())
            # Detect sharp reversals (>120°) — these usually indicate the
            # feature has multimodal structure that a single curve can't follow.
            if len(steps) >= 2:
                u = steps[:-1] / (np.linalg.norm(steps[:-1], axis=1, keepdims=True) + 1e-9)
                v = steps[1:] / (np.linalg.norm(steps[1:], axis=1, keepdims=True) + 1e-9)
                cos = np.clip(np.sum(u * v, axis=1), -1.0, 1.0)
                ang = np.degrees(np.arccos(cos))
                sharp = int((ang > 120.0).sum())
            else:
                sharp = 0
            print(
                f"[dataset_registry][{ds.version}] fitted axis model: {fname} "
                f"(input=[{lo:.4g}, {hi:.4g}], extent={extent:.2f}, path={path_len:.2f}, sharp={sharp})"
            )
            if extent < 1e-3:
                print(
                    f"[dataset_registry][{ds.version}] WARNING: {fname} trajectory is "
                    "degenerate; axis will look collapsed in the UI"
                )
        except Exception as exc:  # pragma: no cover - edge cases
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
    # Motility axes (diffusivity at fragment, segment, and node scales)
    "fragment_diffusivity_mean",
    "segment_diffusivity_mean",
    "node_diffusivity_mean",
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
    """Return the registered dataset for `version`, or an empty placeholder.

    Important: there is intentionally **no cross-version fallback**. Returning v1
    data for `?version=v3` produced 404/501 bugs on hosts where v3 failed to load
    (e.g. missing pyarrow or missing parquet): the client kept asking v3/snake_case
    feature names against v1-only columns.
    """
    if version in _REGISTRY:
        return _REGISTRY[version]
    return Dataset(version=version)


def versions() -> List[str]:
    return list(_REGISTRY.keys())
