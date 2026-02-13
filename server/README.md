# MitoSpace Explorer API

Backend for projection and feature data used by the 4D semantic axis explorer.

## Setup

```bash
cd server
pip install -r requirements.txt
```

## Data requirements

- `data/filtered/embeddings.npy` – (N, D) embedding matrix
- `data/filtered/umap_points.npy` – (N, 3) precomputed UMAP coordinates
- `data/filtered/mitotnt_features.csv` – feature table including e.g. "Fragment Length"
- `data/feature_axes/fragment_length_weights.npy` – linear probe weights
- `data/feature_axes/fragment_length_bias.npy` – linear probe bias (scalar)

Generate the feature axis files from the project root:

```bash
python scripts/export_feature_axes.py
```

**Optional: UMAP reducer (or surrogate)** – Without it, 3D positions are k-NN interpolation (highlight stays among existing points). With a saved reducer, any embedding can be mapped to a continuous 3D point, so the semantic slider can move the highlight across the **whole UMAP space** (including regions with no data). Save the reducer that was fit on the same `embeddings.npy`:

```python
# In your notebook after fitting UMAP on the same embeddings
import joblib
reducer.fit(embeddings)  # same shape as data/filtered/embeddings.npy
joblib.dump(reducer, "data/filtered/umap_reducer.pkl")
```
Restart the API; startup will log when the reducer is loaded and use it for projection.

- **Test if your current reducer is correct:**  
  `python scripts/check_umap_reducer.py`  
  Compares `reducer.transform(embeddings)` to `umap_points`; reports RMSE and whether the reducer looks good.

- **If the reducer is wrong (or missing), fit one from your data:**  
  `python scripts/fit_embedding_to_umap.py`  
  Fits a small MLP from `embeddings.npy` → `umap_points.npy` and saves it as `umap_reducer.pkl`. The server can load it like a UMAP reducer.

**If the reducer fails to load** with "Could not find/load shared object file" or "Numba requires at least version 0.44.0 of llvmlite": run the server with the **same** conda env you used to create the reducer (e.g. `conda activate deeplearning`), and ensure `llvmlite>=0.44.0` (e.g. `pip install 'llvmlite>=0.44.0'`).

## Run

From project root:

```bash
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend expects the API at `http://127.0.0.1:8000` by default. Override with `VITE_API_URL` in `.env`.

## Endpoints

- `GET /api/health` – data load status
- `GET /api/feature-stats?feature=Fragment%20Length` – min/max for a feature
- `GET /api/features/Fragment_Length` – array of feature values (index-aligned)
- `POST /api/project` – body: `{ "pointIndex", "targetValue", "feature", "method?" }` → `{ "x", "y", "z", "predictedValue" }`  
  - **method `"spatial"`** (default): highlight = kernel-weighted centroid in 3D UMAP (slider goes from region with min feature to region with max feature).  
  - **method `"axis"`**: highlight = position along the learned embedding axis, projected to 3D (reducer or k-NN).

**Note:** Returned `(x,y,z)` are in the same UMAP coordinate system as `umap_points.npy`. The frontend expects `points4d.json` to use the same coordinates for the first N points so the slider-driven point moves correctly in the 3D view.
