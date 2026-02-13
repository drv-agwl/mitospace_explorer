"""
Export linear probe (w, b) for Fragment Length into feature_axes/ for the backend.
Run from project root: python scripts/export_feature_axes.py

Requires: data/filtered/embeddings.npy, data/filtered/mitotnt_features.csv
Fits y = w'E + b in raw embedding space (no scaling) for backend compatibility.
"""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "filtered"
OUT = ROOT / "data" / "feature_axes"


def main():
    embeddings = np.load(DATA / "embeddings.npy")
    df = pd.read_csv(DATA / "mitotnt_features.csv")
    y = df["Fragment Length"].fillna(df["Fragment Length"].mean()).values
    valid = ~np.isnan(y)
    X = embeddings[valid].astype(np.float64)
    Y = y[valid]

    # Fit y = w'X + b (raw space)
    X1 = np.column_stack([np.ones(len(X)), X])  # [1, X]
    beta, _, _, _ = np.linalg.lstsq(X1, Y, rcond=None)
    b = float(beta[0])
    w = beta[1:].astype(np.float64)

    OUT.mkdir(parents=True, exist_ok=True)
    np.save(OUT / "fragment_length_weights.npy", w)
    np.save(OUT / "fragment_length_bias.npy", np.array(b))
    print(f"Saved {OUT}/fragment_length_weights.npy (shape {w.shape}) and fragment_length_bias.npy (b={b:.6f})")


if __name__ == "__main__":
    main()
