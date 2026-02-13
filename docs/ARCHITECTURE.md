# MitoSpace Explorer – Architecture Summary

## Current Architecture (Pre-Refactor)

- **App**: Password → Router → SampleProvider → Routes. Main route = Explorer: header, tab bar (4D / 2D), main area (visualizer), SamplePanel (right), footer.
- **Data**: samples4D / samples2D from `sampleData.ts` importing `points4d.json` / `points2d.json`. Each sample has id, x,y,z (precomputed UMAP 3D), phenotype, color, color_phenotypic, treatment, metadata, videos/images. No embedding vectors in frontend.
- **State**: SampleContext holds selectedSample, searchQuery, visualizerOptions (coloringMode, pointSize, etc.), and filteredSamples4D / filteredSamples2D.
- **4D Visualizer**: Single component: Three.js scene, camera, OrbitControls, points from filteredSamples4D (positions scaled/centered), colors from coloringMode (drug vs phenotype), raycaster click → set selected sample + wireframe highlight. No projection logic; all positions are precomputed.

## Required Data Flow

- **Base viz**: Continue loading points from JSON; keep drug vs phenotype coloring.
- **Semantic mode**: Per-point embedding (high-dim), feature value (e.g. Fragment Length), and linear probe (w, b) with y = wᵀE + b. Movement: from selected E₀ and target y_target, E_new = E₀ + t·w_norm, t = (y_target − y₀)/‖w‖; then project E_new to 3D with the same UMAP transform. Embeddings/UMAP live in Python (embeddings.npy, umap_points.npy); feature from mitotnt_features.csv; probe in feature_axes (weights/bias .npy).
- **Index alignment**: Point index i = embedding index i = feature row i for the subset with embeddings (e.g. first 13k).

## Projection

- **Current**: No projection; scatter uses precomputed (x,y,z).
- **Required**: Do not refit UMAP. For new embedding E_new use the same trained UMAP: either saved reducer.transform(E_new) or nearest-neighbor in embedding space → return that point’s precomputed 3D coords.
- **Implementation**: Python backend holds embeddings, umap_points, optional UMAP reducer, and probe; exposes project endpoint (pointIndex, targetValue) → (x, y, z). Frontend only calls API and animates the selected point.
