# v3 Dataset Migration

This document captures what changed when the website was upgraded to support the
new v3 (2025) dataset alongside the existing v1 (2024) dataset.

## Summary

- **v1 (2024)**: 13,000 cells, 2 movies per sample (MitoTracker + TMRM),
  4 axis features (Fragment Length, Segment Length, TMRM Intensity, Optical Flow)
- **v3 (2025)**: 36,106 cells, 1 movie per sample (MitoTracker only),
  8 axis features (Fragment Length, Segment Length, Diameter, Tortuosity,
  Diffusivity, Fission Rate, Fusion Rate, Membrane Potential)

A new **dataset toggle** (top-right of Header on the 4D tab) lets users switch
between v1 and v3. Their selection is persisted in `localStorage` under the key
`mitospace.datasetVersion`.

## File map

### Frontend

| File | What changed |
|---|---|
| `public/data/points4d_v3.json` | New: 36K v3 points (lazy-fetched, ~19 MB). Enriched with SMILES/PubChem from v1 by drug name. |
| `src/types/index.ts` | Added `DatasetVersion` type. Made `color_phenotypic` optional (v3 doesn't have it). |
| `src/data/sampleData.ts` | Lazy-loads v3 JSON via fetch + caches; also auto-promotes `images: ['x.mp4']` to `videos`. |
| `src/context/SampleContext.tsx` | New `datasetVersion` / `datasetLoading` / `setDatasetVersion` fields. v3 fetches once on first selection. |
| `src/constants/features.ts` | New `FEATURE_GROUPS_V3` (8 features) + `getFeatureGroups(version)`. Old `FEATURE_GROUPS` defaults to v1 for backward compat. |
| `src/components/DatasetToggle.tsx` | New header pill toggle with loading indicator. |
| `src/components/Header.tsx` | Mounts `DatasetToggle` when on the 4D tab. |
| `src/components/VisualizerControls.tsx` | Removed phenotype coloring mode. Feature dropdown now version-aware. |
| `src/components/SamplePanel.tsx` | Hides SMILES/PubChem when missing; phenotype color card only shows when present; channel labels only when 2+ videos. |
| `src/components/SemanticAxisPreview.tsx` | Receives `datasetVersion` prop; falls back to MitoTracker video when no TMRM video exists. |
| `src/components/Visualizer4D.tsx` | Threads `datasetVersion` through `projectOnAxis` / `getAxisTrajectory`. |
| `src/components/ChatPanel.tsx` | Sends `datasetVersion` along with chat queries. |
| `src/components/ColorLegend.tsx` | Falls back to treatment color when phenotype color missing. |
| `src/api/client.ts` | All endpoints now accept an optional `version` parameter. |

### Backend

| File | What changed |
|---|---|
| `data/v3_data/features_v3.parquet` | New: slim 31.9 MB parquet (built from the 486 MB upstream parquet by dropping the 2048-d embeddings + internal mount paths). |
| `server/dataset_registry.py` | New module: `Dataset` dataclass + `load_v1` / `load_v3` loaders + global registry. |
| `server/main.py` | Calls both loaders at startup; every endpoint accepts `?version=v1|v3` (defaults to v3). Refactored to use the registry. |
| `server/query_handler.py` | `load_data` now accepts CSV or parquet; v3 parquet auto-derives `TMRM Intensity` (last timepoint), `MitoTracker Intensity`, and v1-friendly aliases for the new snake_case columns. Feature aliases extended (motility → Fragment Diffusivity, tortuosity, etc.). |
| `server/llm_client.py` | System prompt updated for v3 features (motility = diffusivity, TMRM = last timepoint, etc.). |

### Scripts

| File | Purpose |
|---|---|
| `scripts/build_v3_backend_data.py` | One-shot: rebuild `features_v3.parquet` from the upstream parquet. |
| `scripts/enrich_v3_points.py` | One-shot: copy SMILES/PubChem from v1 into the v3 JSON by drug name. |

## Decisions captured (from user)

1. **Optical Flow / Motility**: Replaced with **Fragment Diffusivity** (closest physical analogue).
2. **Feature set exposed**: 6-8 key features (chosen for biological relevance).
3. **TMRM video display**: Code path kept; gracefully falls back to MitoTracker when v3 has no TMRM video.
4. **SMILES / PubChem**: Carried over from v1 by drug name (lookup baked into the JSON).
5. **Phenotype coloring**: Dropped entirely; only "Treatment" coloring remains.
6. **Dataset switching**: UI toggle at top of Header on the 4D tab.
7. **Time-series intensities**: Use last timepoint as the scalar feature value.
8. **Backend storage**: Slim parquet committed to the repo (31.9 MB).

## How to switch the active dataset

Click `v1 · 2024 · 13K` or `v3 · 2025 · 36K` in the top header on the 4D tab.
v1 is bundled (instant load); v3 fetches the 19 MB JSON on first selection and
caches it in memory thereafter.

## Backend startup logs

You should see, on a clean start:

```
[dataset_registry][v1] loaded umap_points.npy (13000 pts)
[dataset_registry][v1] loaded feature: ...
[dataset_registry][v1] fitted axis model: ...   (x4)
[dataset_registry][v3] loading features_v3.parquet (31.9 MB)...
[dataset_registry][v3] loaded 87 numeric features
[dataset_registry][v3] fitted axis model: ...   (x8)
[QueryHandler] Loaded feature table: 36106 samples
[QueryHandler] Loaded sample metadata: 36106 samples
[LLM] Initialized with OpenRouter model: openai/gpt-4o-mini
```
