"""
Generate `public/data/points4d_v3.json` from the v3 parquet.

The frontend lazy-fetches this JSON on first use of the v3 dataset and renders
one marker per row. We materialize the JSON (instead of streaming the parquet)
so the explorer stays a static-asset deploy and the format matches v1.

Source parquet is picked from a ranked list so swapping to a reoriented /
re-fit UMAP does not require editing this script.

Schema (per point — kept stable for backward compatibility):
{
  "id":        "p{i}",
  "x", "y", "z": floats from `embeddings_umap`,
  "phenotype": label name (drug),
  "color":     {r, g, b} from `cmap_label` (0..1),
  "treatment": {"drug": label_name, "dose": "10 nM", "time": "1h"},
  "images":    ["https://mitospace4d.s3.us-east-2.amazonaws.com/v3/mtg_{i:06d}.mp4"],
  "metadata":  {"cellLine": "Cal27", "experimentDate": "2025-03-15",
                "sampleId": "MS{i}", "quality": 100,
                "labelMoa": "Antioxidant" (optional)}
}

`scripts/enrich_v3_points.py` then injects `treatment.smiles` and
`treatment.pubchem` by drug name from the v1 JSON.

Run:
  python scripts/build_v3_points_json.py
  python scripts/enrich_v3_points.py    # add SMILES / PubChem
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
V3_DIR = ROOT / "data" / "v3_data"

SRC_CANDIDATES = (
    V3_DIR / "embeddings+metadata_vis_joined_reoriented.parquet",
    V3_DIR / "embeddings+metadata.parquet",
)
OUT = ROOT / "public" / "data" / "points4d_v3.json"

# Defaults injected when the parquet does not carry these fields.
DEFAULT_DOSE = "10 nM"
DEFAULT_TIME = "1h"
DEFAULT_CELL_LINE = "Cal27"
DEFAULT_EXPERIMENT_DATE = "2025-03-15"
DEFAULT_QUALITY = 100
S3_MOVIE_BASE = "https://mitospace4d.s3.us-east-2.amazonaws.com/v3"


def resolve_source() -> Path:
    for p in SRC_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError(
        "No v3 source parquet found. Looked for:\n  - "
        + "\n  - ".join(str(p) for p in SRC_CANDIDATES)
    )


def _rgb(arr) -> Optional[dict]:
    if arr is None:
        return None
    try:
        v = np.asarray(arr, dtype=np.float64).reshape(-1)
    except Exception:
        return None
    if v.size < 3:
        return None
    return {"r": float(v[0]), "g": float(v[1]), "b": float(v[2])}


def main() -> None:
    try:
        src = resolve_source()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {src.name} ({src.stat().st_size / 1e6:.1f} MB)...")
    cols_wanted = [
        "embeddings_umap",
        "label_names",
        "cmap_label",
        "labels_moa",
    ]
    df = pd.read_parquet(src, columns=cols_wanted)
    n = len(df)
    print(f"  rows={n} cols={list(df.columns)}")

    # Stack UMAP coords (one (3,) array per row) into an (N, 3) matrix.
    umap = np.stack(
        [np.asarray(v, dtype=np.float64).reshape(-1) for v in df["embeddings_umap"]]
    )
    if umap.shape != (n, 3):
        print(
            f"ERROR: embeddings_umap has shape {umap.shape}, expected ({n}, 3)",
            file=sys.stderr,
        )
        sys.exit(1)

    label_names = (
        df["label_names"].astype(str).replace({"lantrunculinb": "latrunculinb"}).to_numpy()
    )
    moa_names = (
        df["labels_moa"].astype(str).to_numpy() if "labels_moa" in df.columns else None
    )
    cmap_label = df["cmap_label"].to_numpy()

    points = []
    for i in range(n):
        drug = label_names[i]
        color = _rgb(cmap_label[i])
        pt = {
            "id": f"p{i}",
            "x": float(umap[i, 0]),
            "y": float(umap[i, 1]),
            "z": float(umap[i, 2]),
            "phenotype": drug,
            "treatment": {
                "drug": drug,
                "dose": DEFAULT_DOSE,
                "time": DEFAULT_TIME,
            },
            "images": [f"{S3_MOVIE_BASE}/mtg_{i:06d}.mp4"],
            "metadata": {
                "cellLine": DEFAULT_CELL_LINE,
                "experimentDate": DEFAULT_EXPERIMENT_DATE,
                "sampleId": f"MS{i}",
                "quality": DEFAULT_QUALITY,
            },
        }
        if color is not None:
            pt["color"] = color
        if moa_names is not None:
            moa = moa_names[i]
            if moa and moa.lower() != "nan":
                pt["metadata"]["labelMoa"] = moa
        points.append(pt)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"points": points}))
    print(f"Wrote {OUT}  ({OUT.stat().st_size / 1e6:.2f} MB, {len(points)} points)")
    print(
        "Next: run `python scripts/enrich_v3_points.py` to add SMILES / PubChem "
        "from v1 by drug name."
    )


if __name__ == "__main__":
    main()
