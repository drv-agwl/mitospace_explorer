"""
Fit a surrogate model: embedding -> 3D UMAP, using your existing embeddings and umap_points.
Saves (scaler, model) or model; the server wraps with .transform() when loading.

Run from project root: python scripts/fit_embedding_to_umap.py

Requires: data/filtered/embeddings.npy, data/filtered/umap_points.npy
Produces: data/filtered/umap_reducer.pkl (overwrites existing; back up first if needed)

Tips for better fit (lower RMSE in check_umap_reducer.py):
- Increase hidden_layer_sizes or add a second layer (e.g. (512, 256)).
- Increase max_iter so early_stopping can converge (e.g. 800).
- Use_scale=True (default) standardizes embeddings; usually helps.
"""
from pathlib import Path
import numpy as np
import joblib

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "filtered"
EMB_PATH = DATA / "embeddings.npy"
UMAP_PATH = DATA / "umap_points.npy"
OUT_PATH = DATA / "umap_reducer.pkl"

# --- Tune these for better fit (then run and check with scripts/check_umap_reducer.py) ---
USE_SCALE = True  # standardize embeddings before fitting (recommended)
HIDDEN_LAYERS = (512, 256)  # deeper/wider: try (512, 256) or (768, 384) for lower RMSE
MAX_ITER = 800  # more epochs; early_stopping will stop when validation stops improving
LEARNING_RATE = 0.0001  # smaller can help stability
BATCH_SIZE = 128  # smaller = more updates per epoch (default is min(200, n))


def main():
    if not EMB_PATH.exists():
        print(f"Missing {EMB_PATH}")
        return 1
    if not UMAP_PATH.exists():
        print(f"Missing {UMAP_PATH}")
        return 1

    embeddings = np.load(EMB_PATH).astype(np.float64)
    umap_points = np.load(UMAP_PATH).astype(np.float64)
    n, d = embeddings.shape
    assert umap_points.shape[0] == n, f"Length mismatch: embeddings {n} vs umap_points {umap_points.shape[0]}"
    assert umap_points.shape[1] == 3, "umap_points should be (N, 3)"

    try:
        from sklearn.neural_network import MLPRegressor
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        print("Need sklearn: pip install scikit-learn")
        return 1

    if USE_SCALE:
        scaler = StandardScaler()
        X = scaler.fit_transform(embeddings)
        print(f"Fitting surrogate: embedding (n={n}, d={d}) -> 3D UMAP (standardized), hidden={HIDDEN_LAYERS}, max_iter={MAX_ITER} ...")
    else:
        scaler = None
        X = embeddings
        print(f"Fitting surrogate: embedding (n={n}, d={d}) -> 3D UMAP, hidden={HIDDEN_LAYERS}, max_iter={MAX_ITER} ...")

    model = MLPRegressor(
        hidden_layer_sizes=HIDDEN_LAYERS,
        activation="relu",
        solver="adam",
        max_iter=MAX_ITER,
        learning_rate_init=LEARNING_RATE,
        batch_size=BATCH_SIZE,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.1,
    )
    model.fit(X, umap_points)

    # Quick check (use same scaling at predict time if we scaled at fit time)
    if scaler is not None:
        pred = model.predict(scaler.transform(embeddings[:100]))
    else:
        pred = model.predict(embeddings[:100])
    err = np.mean((pred - umap_points[:100]) ** 2) ** 0.5
    print(f"  Train RMSE (first 100): {err:.6f}")

    DATA.mkdir(parents=True, exist_ok=True)
    # Save (scaler, model) so server can apply same scaling when predicting
    to_save = (scaler, model) if scaler is not None else model
    joblib.dump(to_save, OUT_PATH)
    print(f"Saved {OUT_PATH}")
    print("Restart the API to use this reducer. Run scripts/check_umap_reducer.py to verify fit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
