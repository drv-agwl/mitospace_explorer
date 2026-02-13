# Semantic axis math (slider → UMAP highlight)

## What we have

- **Embedding space**: each cell has a vector \( E \in \mathbb{R}^d \) (e.g. \( d = 2048 \)).
- **Linear probe**: for a feature (e.g. Fragment Length) we fit \( y = w^\top E + b \). So \( w \) is the “direction” in embedding space along which the feature value changes.
- **UMAP**: we have a fixed 3D embedding \( \text{UMAP}(E) \) for the training set. New \( E \) are either transformed with a saved UMAP reducer (if present) or **k-NN**: find the 5 nearest training embeddings to \( E \) and return the weighted average of their UMAP coordinates.

## Model-correct motion

We want: “If I move the slider to `targetValue`, where would a cell with that feature value lie?”

- **Constraint**: the new embedding \( E_{\text{new}} \) should satisfy \( w^\top E_{\text{new}} + b = \text{targetValue} \).
- **Minimal step** from \( E_0 \) in the direction \( w \):
  \[
  E_{\text{new}} = E_0 + \frac{\text{targetValue} - y_0}{\|w\|^2} \, w, \qquad y_0 = w^\top E_0 + b.
  \]
  So the step length is \( |\text{targetValue} - y_0| / \|w\| \). With \( \|w\| \sim 10^8 \), this is tiny (e.g. \( \sim 10^{-8} \) per unit of feature), so in practice the point would never leave the same k-NN neighborhood and the highlight would barely move.

## What we actually do (display scale)

- **Direction**: we still move along \( w \) (unit vector \( \hat{w} = w/\|w\| \)), so the motion is along the true semantic axis.
- **Step size**: we rescale so that sliding the slider across the **full feature range** (min to max in the data) moves the embedding by about **one “neighborhood”** — the median distance from a point to its 5th nearest neighbor in embedding space.

  \[
  E_{\text{display}} = E_0 + (\text{targetValue} - y_0) \cdot \text{display\_scale} \cdot \hat{w},
  \]
  with
  \[
  \text{display\_scale} = \frac{\text{median 5-NN distance}}{\text{feature range}}.
  \]

So when you move the slider from the current value to the max (or min), the highlight moves by roughly one median 5-NN distance along the Fragment Length axis. That makes motion visible and comparable across the cloud, while keeping the **direction** exactly the learned \( w \).

## Why the highlight can still feel “local”

- **k-NN projection**: without a UMAP reducer, the 3D position is always a **weighted average of 5 existing UMAP points**. So the highlight always lies “among” the point cloud; it can’t jump to a far empty region. As \( E_{\text{display}} \) moves, the set of 5 nearest neighbors changes, so the highlight can move to different parts of the cloud, but it’s still an interpolation of existing points.
- **With a UMAP reducer**: if you save `umap_reducer.pkl` in `data/filtered/` (the same reducer fit on `embeddings.npy`), the backend uses `reducer.transform(E_display)` so the highlight can sit outside the cloud; the trajectory is still one curve (see below).

## Why the slider does not span the "whole" UMAP space

- In **embedding space** we only move along **one direction** (the Fragment Length axis \( \hat{w} \)). So we trace a **line**: \( E = E_{\text{ref}} + t \, \hat{w} \) as the slider goes from min to max.
- **UMAP** is nonlinear. It maps that line to a **curve** in 3D, not to the full 3D volume. So the highlight always stays on that curve.
- The **whole UMAP space** (the 3D cloud) is filled by all points varying in **all** embedding dimensions. The slider explores only **one** dimension (\( w \)). So by design the trajectory is **one curve** through the cloud; Fragment Length may only correlate with part of the structure, so that curve can be short.
- To make min→max span a **larger 3D distance**, the backend can scale the step so the trajectory length equals the cloud diameter (see `SPAN_UMAP_DIAMETER` in `server/main.py`).

## Summary

| Item | Formula / meaning |
|------|--------------------|
| Probe | \( y = w^\top E + b \) |
| Model-correct step | \( E_0 + \frac{\Delta y}{\|w\|^2} w \), step length \( \Delta y / \|w\| \) |
| Display step | \( E_0 + (\Delta y \cdot \text{display\_scale}) \hat{w} \), with display_scale = median_5nn / feature_range |
| 3D position | UMAP reducer if available, else k-NN weighted average of 5 neighbors’ UMAP coords |

The **math** is the minimal step along \( w \) to reach the target value; the **display** rescales that step so the slider motion is visible and in “neighborhood” units.
