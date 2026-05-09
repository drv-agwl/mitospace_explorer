"""
Build a slim parquet for the backend from the full v3 parquet.

The full parquet (data/v3_data/embeddings+metadata.parquet) is ~486MB because
it contains a 2048-d `embeddings` column. We don't need the raw 2048-d embedding
in the backend (it's only useful for downstream training). We DO need:
  - 3D UMAP coords (`embeddings_umap`)
  - All numeric morphology / network / dynamics / function features
  - Drug + MOA labels
  - Time-series intensities (small: 20 floats per sample)

Output:
  data/v3_data/features_v3.parquet  (slim, ~30-50 MB expected)

Run:
  python scripts/build_v3_backend_data.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "v3_data" / "embeddings+metadata.parquet"
OUT = ROOT / "data" / "v3_data" / "features_v3.parquet"


def main() -> None:
    if not SRC.exists():
        print(f"ERROR: source parquet not found: {SRC}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {SRC.name} ({SRC.stat().st_size / 1e6:.1f} MB)...")
    df = pd.read_parquet(SRC)
    print(f"  rows={len(df)} cols={len(df.columns)}")

    # Columns to drop: the heavy 2048-d embeddings + internal mount paths
    drop_cols = {
        "embeddings",      # 2048-d, ~75% of file size
        "image_paths",     # internal /mnt/aquila/... path
        "tmrm_path",       # internal /mnt/aquila/... path
        "filepath",        # internal /mnt/aquila/... path
    }

    keep = [c for c in df.columns if c not in drop_cols]
    out = df[keep].copy()

    # Convert intensities arrays to lists so parquet round-trips cleanly
    for col in ("morph_intensities", "tmrm_intensities", "embeddings_umap", "cmap_label", "cmap_moa"):
        if col in out.columns:
            out[col] = out[col].apply(lambda a: a.tolist() if isinstance(a, np.ndarray) else a)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(OUT, compression="snappy", index=False)
    print(f"Wrote {OUT}  ({OUT.stat().st_size / 1e6:.1f} MB)  cols={len(out.columns)}")
    print()
    print("Kept columns:")
    for c in out.columns:
        print(f"  - {c}")


if __name__ == "__main__":
    main()
