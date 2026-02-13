"""
MitoSpace Explorer backend: projection and feature APIs.
Uses precomputed UMAP coords and feature values; axis = direct learnt curve.

Axis method (semantic slider): feature value -> UMAP (x, y, z).
At startup we fit feature_umap_model per feature: MLP(feature_values) -> umap_points.
Slider targetValue is passed to the model; response is the 3D position on that curve.
"""
from pathlib import Path
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Paths relative to project root (parent of server/)
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "filtered"

app = FastAPI(title="MitoSpace Explorer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Loaded at startup: UMAP coords, feature values, and learnt curve (feature value -> UMAP x,y,z)
umap_points: np.ndarray | None = None
feature_values: dict[str, np.ndarray] = {}
feature_umap_model: dict = {}


def _project_spatial(feature_name: str, target_value: float, bandwidth_ratio: float = 10.0) -> tuple[float, float, float, float]:
    """
    Position in 3D UMAP by kernel-weighted centroid: where do points with this feature value sit?
    Weights = Gaussian in feature space; highlight = weighted average of their UMAP coords.
    So min slider -> region of low feature, max slider -> region of high feature.
    Returns (x, y, z, weighted_mean_feature).
    """
    if feature_name not in feature_values or umap_points is None:
        raise ValueError("Feature or UMAP points not loaded")
    f = feature_values[feature_name].astype(np.float64)
    if len(f) != len(umap_points):
        raise ValueError(f"Feature length {len(f)} != UMAP points length {len(umap_points)}")
    valid = ~np.isnan(f)
    if not np.any(valid):
        raise ValueError(f"No valid values for feature {feature_name}")
    f_min, f_max = float(np.min(f[valid])), float(np.max(f[valid]))
    sigma = (f_max - f_min) / bandwidth_ratio
    if sigma < 1e-12:
        sigma = 1.0
    # Gaussian kernel: weight_i = exp(-0.5 * ((f_i - target) / sigma)^2)
    w = np.exp(-0.5 * ((f - target_value) / sigma) ** 2)
    w = w * valid.astype(np.float64)
    w_sum = np.sum(w)
    if w_sum < 1e-20:
        # Fallback: nearest point by feature value
        idx = np.nanargmin(np.abs(f - target_value))
        out = (float(umap_points[idx, 0]), float(umap_points[idx, 1]), float(umap_points[idx, 2]), float(f[idx]))
        return out
    w /= w_sum
    x = float(np.dot(w, umap_points[:, 0]))
    y = float(np.dot(w, umap_points[:, 1]))
    z = float(np.dot(w, umap_points[:, 2]))
    pred = float(np.dot(w, f))
    return (x, y, z, pred)


@app.on_event("startup")
def startup():
    global umap_points, feature_values, feature_umap_model

    umap_path = DATA / "umap_points.npy"
    if umap_path.exists():
        umap_points = np.load(umap_path)
        print(f"[startup] Loaded UMAP points: {len(umap_points)}")

    csv_path = DATA / "mitotnt_features.csv"
    if csv_path.exists():
        df = pd.read_csv(csv_path)
        for col in ("Fragment Length", "Segment Length"):
            if col in df.columns:
                vals = df[col].fillna(df[col].mean())
                feature_values[col] = vals.values.astype(np.float64)
                print(f"[startup] Loaded feature values: {col} ({len(vals)} points)")

    # Axis: learnt curve feature value -> UMAP (x,y,z)
    if umap_points is not None:
        try:
            from sklearn.neural_network import MLPRegressor
            for fname, fvals in feature_values.items():
                if len(fvals) != len(umap_points):
                    continue
                valid = ~np.isnan(fvals)
                if np.sum(valid) < 10:
                    continue
                X = np.asarray(fvals[valid], dtype=np.float64).reshape(-1, 1)
                y = umap_points[valid].astype(np.float64)
                model = MLPRegressor(
                    hidden_layer_sizes=(64,),
                    max_iter=200,
                    alpha=0.1,
                    random_state=42,
                )
                model.fit(X, y)
                feature_umap_model[fname] = model
                print(f"[startup] Fitted axis model: {fname} -> UMAP (x,y,z)")
        except Exception as e:
            print(f"[startup] Axis model fit failed: {e}")


class ProjectRequest(BaseModel):
    pointIndex: int
    targetValue: float
    feature: str = "Fragment Length"
    # "spatial" = kernel-weighted centroid in 3D. "axis" = global UMAP-space traversal aligned with feature.
    method: str = "axis"
    # Optional: frontend sends its scene center and scale so we return coords ready for Three.js
    centerX: float | None = None
    centerY: float | None = None
    centerZ: float | None = None
    scaleFactor: float | None = None


class ProjectResponse(BaseModel):
    x: float
    y: float
    z: float
    predictedValue: float
    confidence: float | None = None  # 1.0 = on manifold, <1 when extrapolating (for UI indicator)


@app.post("/api/project", response_model=ProjectResponse)
def project(req: ProjectRequest):
    if umap_points is None:
        raise HTTPException(status_code=503, detail="UMAP points not loaded")
    if req.feature not in feature_values:
        raise HTTPException(status_code=501, detail=f"Feature '{req.feature}' not loaded")
    method = (req.method or "spatial").strip().lower()
    confidence = None
    if method == "spatial":
        n_pts = len(umap_points)
        if req.pointIndex < 0 or req.pointIndex >= n_pts:
            raise HTTPException(status_code=400, detail=f"pointIndex out of range (0 to {n_pts - 1})")
        x, y, z, pred = _project_spatial(req.feature, req.targetValue)
    else:
        # Axis: direct learnt curve (feature value -> UMAP x,y,z). No embedding or reducer.
        if req.feature not in feature_umap_model:
            raise HTTPException(status_code=501, detail=f"Feature axis '{req.feature}' not available")
        coords = feature_umap_model[req.feature].predict([[float(req.targetValue)]])
        x = float(coords[0, 0])
        y = float(coords[0, 1])
        z = float(coords[0, 2])
        pred = req.targetValue
        confidence = None

    if (
        req.centerX is not None
        and req.centerY is not None
        and req.centerZ is not None
        and req.scaleFactor is not None
    ):
        sx = (float(x) - req.centerX) * req.scaleFactor
        sy = (float(y) - req.centerY) * req.scaleFactor
        sz = (float(z) - req.centerZ) * req.scaleFactor
        return ProjectResponse(x=sx, y=sy, z=sz, predictedValue=pred, confidence=confidence)
    return ProjectResponse(x=x, y=y, z=z, predictedValue=pred, confidence=confidence)


@app.get("/api/axis-trajectory")
def axis_trajectory(
    feature: str = "Fragment Length",
    num_points: int = 80,
    center_x: float | None = None,
    center_y: float | None = None,
    center_z: float | None = None,
    scale_factor: float | None = None,
):
    """Precomputed trajectory along the learnt curve. When center_x/y/z and scale_factor are
    provided, returns points in scene space (same as /api/project) so the frontend can draw
    the tube without any transform and it aligns with the scatter."""
    if feature not in feature_umap_model:
        raise HTTPException(status_code=501, detail=f"Feature axis '{feature}' not available")
    if feature not in feature_values:
        raise HTTPException(status_code=501, detail=f"Feature '{feature}' not loaded")
    arr = feature_values[feature]
    valid = arr[~np.isnan(arr)]
    if len(valid) == 0:
        raise HTTPException(status_code=404, detail="No valid feature values")
    f_min, f_max = float(np.min(valid)), float(np.max(valid))
    num_points = max(2, min(200, num_points))
    values = np.linspace(f_min, f_max, num_points, dtype=np.float64).reshape(-1, 1)
    coords = feature_umap_model[feature].predict(values)
    # Log raw UMAP bounds for debugging (trajectory visibility)
    x_min, x_max = float(coords[:, 0].min()), float(coords[:, 0].max())
    y_min, y_max = float(coords[:, 1].min()), float(coords[:, 1].max())
    z_min, z_max = float(coords[:, 2].min()), float(coords[:, 2].max())
    print(f"[axis-trajectory] {feature} raw UMAP bounds x=[{x_min:.3f}, {x_max:.3f}] y=[{y_min:.3f}, {y_max:.3f}] z=[{z_min:.3f}, {z_max:.3f}]")
    to_scene = (
        center_x is not None
        and center_y is not None
        and center_z is not None
        and scale_factor is not None
    )
    if to_scene:
        cx, cy, cz = float(center_x), float(center_y), float(center_z)
        sf = float(scale_factor)
        points = [
            {
                "x": (float(coords[i, 0]) - cx) * sf,
                "y": (float(coords[i, 1]) - cy) * sf,
                "z": (float(coords[i, 2]) - cz) * sf,
            }
            for i in range(len(coords))
        ]
    else:
        points = [
            {"x": float(coords[i, 0]), "y": float(coords[i, 1]), "z": float(coords[i, 2])}
            for i in range(len(coords))
        ]
    return {"points": points, "featureMin": f_min, "featureMax": f_max}


@app.get("/api/feature-stats")
def feature_stats(feature: str = "Fragment Length"):
    if feature not in feature_values:
        raise HTTPException(status_code=404, detail=f"Feature '{feature}' not loaded")
    arr = feature_values[feature]
    valid = arr[~np.isnan(arr)]
    if len(valid) == 0:
        return {"min": 0.0, "max": 1.0}
    return {"min": float(np.min(valid)), "max": float(np.max(valid))}


@app.get("/api/features/{feature_name}")
def get_feature_values(feature_name: str):
    # Map URL-safe name to internal key, e.g. "Fragment_Length" or "FragmentLength" -> "Fragment Length"
    key = feature_name.replace("_", " ")
    if key not in feature_values:
        key = feature_name
    if key not in feature_values:
        raise HTTPException(status_code=404, detail=f"Feature '{feature_name}' not loaded")
    return {"values": feature_values[key].tolist()}


@app.get("/api/health")
def health():
    n = len(umap_points) if umap_points is not None else 0
    return {
        "umap_points_loaded": umap_points is not None,
        "point_count": n,
        "embedding_count": n,  # frontend uses this for "in range" check; axis works for all points
        "features": list(feature_values.keys()),
        "axes": list(feature_umap_model.keys()),
    }
