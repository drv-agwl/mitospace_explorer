"""
Test whether the saved UMAP reducer matches the precomputed umap_points.
Run from project root: python scripts/check_umap_reducer.py

If the reducer was fit on the same embeddings that produced umap_points (in the same order),
then reducer.transform(embeddings) should match umap_points closely.
High MSE or max error => reducer is wrong (different data, different fit, or wrong order).
"""
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "filtered"
REDUCER_PATH = DATA / "umap_reducer.pkl"
EMB_PATH = DATA / "embeddings.npy"
UMAP_PATH = DATA / "umap_points.npy"


def main():
    if not EMB_PATH.exists() or not UMAP_PATH.exists():
        print("Missing embeddings.npy or umap_points.npy in data/filtered/")
        return 1
    embeddings = np.load(EMB_PATH)
    umap_points = np.load(UMAP_PATH)
    n, d = embeddings.shape
    assert umap_points.shape[0] == n, f"Length mismatch: embeddings {n} vs umap_points {umap_points.shape[0]}"
    assert umap_points.shape[1] == 3, "umap_points should be (N, 3)"

    if not REDUCER_PATH.exists():
        print(f"No reducer at {REDUCER_PATH}")
        print("Run scripts/fit_embedding_to_umap.py to create one from embeddings + umap_points.")
        return 1

    import joblib
    print(f"Loading reducer from {REDUCER_PATH} ...")
    reducer = joblib.load(REDUCER_PATH)
    if callable(getattr(reducer, "transform", None)):
        do_transform = lambda X: reducer.transform(X)
        kind = "UMAP/surrogate with .transform()"
    elif callable(getattr(reducer, "predict", None)):
        do_transform = lambda X: reducer.predict(X)
        kind = "sklearn surrogate (.predict)"
    elif isinstance(reducer, (list, tuple)) and len(reducer) == 2:
        scaler, model = reducer[0], reducer[1]
        if callable(getattr(model, "predict", None)):
            do_transform = lambda X: model.predict(scaler.transform(X))
            kind = "sklearn surrogate (scaler + model)"
        else:
            print("Loaded (scaler, model) but model has no .predict().")
            return 1
    else:
        print("Reducer has no .transform(), .predict(), or (scaler, model) form.")
        return 1
    print(f"  Type: {kind}")

    # Sample to keep runtime reasonable (transform can be slow)
    sample_size = min(500, n)
    rng = np.random.default_rng(42)
    idx = rng.choice(n, size=sample_size, replace=False)
    emb_sample = embeddings[idx].astype(np.float64)
    umap_expected = umap_points[idx]

    print(f"Transforming {sample_size} points ...")
    pred = do_transform(emb_sample)
    pred = np.asarray(pred)
    if pred.shape != (sample_size, 3):
        print(f"Reducer output shape {pred.shape}, expected ({sample_size}, 3)")
        return 1

    diff = pred - umap_expected
    mse = float(np.mean(diff ** 2))
    rmse = np.sqrt(mse)
    max_abs_err = float(np.max(np.abs(diff)))
    mean_abs_err = float(np.mean(np.abs(diff)))

    print()
    print("--- Reducer vs umap_points ---")
    print(f"  RMSE:        {rmse:.6f}")
    print(f"  Mean |err|: {mean_abs_err:.6f}")
    print(f"  Max |err|:  {max_abs_err:.6f}")
    print()

    # Heuristic: if umap_points are typically O(1-10) in scale, RMSE < 0.1 is good
    scale = np.std(umap_points)
    if scale < 1e-9:
        scale = 1.0
    relative_rmse = rmse / scale
    print(f"  Relative RMSE (vs std of umap_points): {relative_rmse:.4f}")
    print()

    if relative_rmse < 0.05 and max_abs_err < 0.5 * scale:
        print("Result: Reducer looks GOOD (transforms match umap_points).")
    elif relative_rmse < 0.2:
        print("Result: Reducer is OK but has some drift. Consider refitting with scripts/fit_embedding_to_umap.py")
    else:
        print("Result: Reducer is likely WRONG (different data/fit/order). Replace with scripts/fit_embedding_to_umap.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
