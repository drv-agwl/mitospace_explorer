"""
MitoSpace Explorer backend: projection and feature APIs.
Uses precomputed UMAP coords and feature values; axis = direct learnt curve.

Axis method (semantic slider): feature value -> UMAP (x, y, z).
At startup we fit feature_umap_model per feature: MLP(feature_values) -> umap_points.
Slider targetValue is passed to the model; response is the 3D position on that curve.

Multi-version support: every endpoint accepts an optional `?version=v1|v3` query
param (or `version` field in POST bodies). Both datasets are loaded once at
startup and held in memory by `dataset_registry`.
"""
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import List, Optional
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Chat system imports - handle both package and direct execution
try:
    # Try relative imports first (for when run as: python -m uvicorn server.main:app)
    from . import groundedness
    from . import query_handler
    from . import llm_client
    from . import dataset_registry
    from .query_handler import load_data, classify_query, compute_statistics
    from .llm_client import (
        build_system_prompt,
        initialize_llm_client,
        get_llm_client,
        is_llm_available,
    )
    from .dataset_registry import Dataset, load_v1, load_v3, register, feature_bounds
except ImportError:
    # Fall back to absolute imports (for when run from server/ directory)
    import groundedness
    import query_handler
    import llm_client
    import dataset_registry
    from query_handler import load_data, classify_query, compute_statistics
    from llm_client import (
        build_system_prompt,
        initialize_llm_client,
        get_llm_client,
        is_llm_available,
    )
    from dataset_registry import Dataset, load_v1, load_v3, register, feature_bounds

# Load environment variables
load_dotenv()


# ─────────────────────────────────────────────────────────────────────────────
# Logging — single root configuration so llm_client / query_handler / this
# module emit consistent structured-ish lines. Anything passed via `extra=`
# is appended as key=value pairs for grep-ability without pulling in structlog.
# ─────────────────────────────────────────────────────────────────────────────


class _KeyValueFormatter(logging.Formatter):
    _RESERVED = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "taskName", "message",
    }

    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record, '%Y-%m-%dT%H:%M:%S')} {record.levelname} {record.name} :: {record.getMessage()}"
        extras = {
            k: v for k, v in record.__dict__.items() if k not in self._RESERVED and not k.startswith("_")
        }
        if extras:
            kv = " ".join(
                f"{k}={json.dumps(v, default=str) if isinstance(v, (dict, list)) else v}"
                for k, v in extras.items()
            )
            base += " | " + kv
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def _configure_logging() -> None:
    root = logging.getLogger("mitospace")
    if root.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(_KeyValueFormatter())
    root.addHandler(handler)
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    root.propagate = False


_configure_logging()
log = logging.getLogger("mitospace.api")

# Paths relative to project root (parent of server/)
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "filtered"
V3_PARQUET = ROOT / "data" / "v3_data" / "features_v3.parquet"

VALID_VERSIONS = ("v1", "v3")


def _resolve_version(version):
    """Return a valid version string, defaulting to v3 for new requests."""
    v = (version or "").lower().strip()
    if v in VALID_VERSIONS:
        return v
    return "v3"


def _get_dataset(version):
    return dataset_registry.get(_resolve_version(version))


def _require_api_dataset(version) -> Dataset:
    """Fail fast when the requested version is missing or empty (better than v1 bait-and-switch)."""
    v = _resolve_version(version)
    if v not in dataset_registry.versions():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Dataset '{v}' is not registered on this server. Loaded versions: "
                f"{dataset_registry.versions()}. Deploy data/v3_data/features_v3.parquet "
                "and ensure `pyarrow` is installed so the parquet can be read."
            ),
        )
    ds = dataset_registry.get(v)
    if not ds.loaded:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Dataset '{v}' did not load (no UMAP / no features). Check startup logs "
                "(parquet missing, unreadable path, or install pyarrow for read_parquet)."
            ),
        )
    return ds


def _resolve_feature_key(ds: Dataset, feature_name: str) -> Optional[str]:
    """Map frontend/API names to ds.feature_values keys (v3 snake_case vs v1 spaced)."""
    if feature_name in ds.feature_values:
        return feature_name
    spaced = feature_name.replace("_", " ")
    if spaced in ds.feature_values:
        return spaced
    snake = feature_name.replace(" ", "_")
    if snake in ds.feature_values:
        return snake
    lower_map = {k.lower(): k for k in ds.feature_values}
    for cand in (feature_name, spaced, snake):
        key = cand.lower()
        if key in lower_map:
            return lower_map[key]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Rate limiting for /api/chat.
#
# Public-facing chat is the only endpoint that costs us money per call
# (OpenRouter). Everything else is cheap CPU + memory. We rate-limit chat by
# remote IP using slowapi (in-memory; good enough for a single-worker uvicorn —
# move to Redis if we ever scale out). Overridable via env.
# ─────────────────────────────────────────────────────────────────────────────

_chat_rate_limit = os.environ.get("CHAT_RATE_LIMIT", "20/minute")
limiter = Limiter(key_func=get_remote_address, default_limits=[])

app = FastAPI(title="MitoSpace Explorer API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/")
def root():
    """Render/other platforms often probe `/` — return OK instead of 404."""
    return {
        "ok": True,
        "service": "mitospace-explorer-api",
        "health": "/api/health",
        "docs": "/docs",
    }


@app.head("/")
def root_head():
    return Response(status_code=200)
_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if os.environ.get("CORS_ORIGINS"):
    _cors_origins.extend(s.strip() for s in os.environ["CORS_ORIGINS"].split(",") if s.strip())
# Localhost + Netlify + Render (HTTPS) deploys unless overridden via env
_cors_origin_regex = (
    r"http://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|https://[^.]+\.netlify\.app$"
    r"|https://[^.]+\.onrender\.com$"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _project_spatial(
    ds: Dataset,
    feature_name: str,
    target_value: float,
    bandwidth_ratio: float = 10.0,
) -> tuple[float, float, float, float]:
    """
    Position in 3D UMAP by kernel-weighted centroid: where do points with this feature value sit?
    Weights = Gaussian in feature space; highlight = weighted average of their UMAP coords.
    So min slider -> region of low feature, max slider -> region of high feature.
    Returns (x, y, z, weighted_mean_feature).
    """
    if feature_name not in ds.feature_values or ds.umap_points is None:
        raise ValueError("Feature or UMAP points not loaded")
    f = ds.feature_values[feature_name].astype(np.float64)
    if len(f) != len(ds.umap_points):
        raise ValueError(f"Feature length {len(f)} != UMAP points length {len(ds.umap_points)}")
    valid = ~np.isnan(f)
    if not np.any(valid):
        raise ValueError(f"No valid values for feature {feature_name}")
    f_min, f_max = feature_bounds(f, feature=feature_name)
    sigma = (f_max - f_min) / bandwidth_ratio
    if sigma < 1e-12:
        sigma = 1.0
    w = np.exp(-0.5 * ((f - target_value) / sigma) ** 2)
    w = w * valid.astype(np.float64)
    w_sum = np.sum(w)
    if w_sum < 1e-20:
        idx = np.nanargmin(np.abs(f - target_value))
        return (
            float(ds.umap_points[idx, 0]),
            float(ds.umap_points[idx, 1]),
            float(ds.umap_points[idx, 2]),
            float(f[idx]),
        )
    w /= w_sum
    x = float(np.dot(w, ds.umap_points[:, 0]))
    y = float(np.dot(w, ds.umap_points[:, 1]))
    z = float(np.dot(w, ds.umap_points[:, 2]))
    pred = float(np.dot(w, f))
    return (x, y, z, pred)


@app.on_event("startup")
def startup():
    # ── Load v1 (existing CSV + npy) ──
    try:
        v1 = load_v1(DATA)
        register(v1)
        print(f"[startup] v1 loaded: umap={'yes' if v1.umap_points is not None else 'no'}  features={list(v1.feature_values.keys())}")
    except Exception as e:
        print(f"[startup] v1 load failed: {e}")

    # ── Load v3 (slim parquet) ──
    try:
        v3 = load_v3(V3_PARQUET)
        register(v3)
        print(f"[startup] v3 loaded: umap={'yes' if v3.umap_points is not None else 'no'}  axis_features={list(v3.feature_umap_model.keys())}")
    except Exception as e:
        print(f"[startup] v3 load failed: {e}")

    # ── Chat: load both v1 (legacy CSV) and v3 (parquet) so the chat endpoint
    #    can route per-request to the dataset the user is currently exploring.
    try:
        if V3_PARQUET.exists():
            metadata_json = ROOT / "public" / "data" / "points4d_v3.json"
            load_data(
                str(V3_PARQUET),
                str(metadata_json) if metadata_json.exists() else None,
                version="v3",
            )
    except Exception as e:
        log.warning("startup.chat_v3_failed", extra={"error": str(e)})

    try:
        feature_csv = DATA / "mitotnt_features.csv"
        metadata_json = ROOT / "src" / "data" / "points4d.json"
        if feature_csv.exists():
            load_data(
                str(feature_csv),
                str(metadata_json) if metadata_json.exists() else None,
                version="v1",
            )
    except Exception as e:
        log.warning("startup.chat_v1_failed", extra={"error": str(e)})

    # ── LLM ──
    try:
        api_key = os.getenv("OPENROUTER_API_KEY")
        # Default to Claude Haiku 4.5: stronger at strict grounding and refusal
        # than gpt-4o-mini at similar throughput, ~$1/$5 per Mtok. Override via
        # OPENROUTER_MODEL.
        model = os.getenv("OPENROUTER_MODEL", "anthropic/claude-haiku-4.5")
        if api_key:
            initialize_llm_client(api_key=api_key, model=model)
        else:
            log.warning("startup.llm_disabled", extra={"reason": "OPENROUTER_API_KEY not set"})
    except Exception as e:
        log.error("startup.llm_init_failed", extra={"error": str(e)})


class ProjectRequest(BaseModel):
    pointIndex: int
    targetValue: float
    feature: str = "Fragment Length"
    # "spatial" = kernel-weighted centroid in 3D. "axis" = global UMAP-space traversal aligned with feature.
    method: str = "axis"
    # Dataset version: "v1" (legacy CSV) or "v3" (parquet). Defaults to v3.
    version: Optional[str] = None
    # Optional: frontend sends its scene center and scale so we return coords ready for Three.js
    centerX: Optional[float] = None
    centerY: Optional[float] = None
    centerZ: Optional[float] = None
    scaleFactor: Optional[float] = None


class ProjectResponse(BaseModel):
    x: float
    y: float
    z: float
    predictedValue: float
    confidence: Optional[float] = None  # 1.0 = on manifold, <1 when extrapolating


@app.post("/api/project", response_model=ProjectResponse)
def project(req: ProjectRequest):
    ds = _require_api_dataset(req.version)
    if ds.umap_points is None:
        raise HTTPException(status_code=503, detail=f"UMAP points not loaded for {ds.version}")
    feat = _resolve_feature_key(ds, req.feature)
    if feat is None:
        raise HTTPException(
            status_code=501,
            detail=f"Feature '{req.feature}' not loaded for {ds.version}",
        )
    method = (req.method or "spatial").strip().lower()
    confidence = None
    if method == "spatial":
        n_pts = len(ds.umap_points)
        if req.pointIndex < 0 or req.pointIndex >= n_pts:
            raise HTTPException(
                status_code=400,
                detail=f"pointIndex out of range (0 to {n_pts - 1}) for {ds.version}",
            )
        x, y, z, pred = _project_spatial(ds, feat, req.targetValue)
    else:
        if feat not in ds.feature_umap_model:
            raise HTTPException(
                status_code=501,
                detail=f"Feature axis '{req.feature}' (resolved '{feat}') not available for {ds.version}",
            )
        coords = ds.feature_umap_model[feat].predict([[float(req.targetValue)]])
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
    version: Optional[str] = Query(default=None),
    center_x: Optional[float] = None,
    center_y: Optional[float] = None,
    center_z: Optional[float] = None,
    scale_factor: Optional[float] = None,
):
    """Precomputed trajectory along the learnt curve. When center_x/y/z and scale_factor are
    provided, returns points in scene space (same as /api/project) so the frontend can draw
    the tube without any transform and it aligns with the scatter."""
    ds = _require_api_dataset(version)
    feat = _resolve_feature_key(ds, feature)
    if feat is None or feat not in ds.feature_umap_model:
        raise HTTPException(
            status_code=501,
            detail=f"Feature axis '{feature}' not available for {ds.version}",
        )
    if feat not in ds.feature_values:
        raise HTTPException(
            status_code=501,
            detail=f"Feature '{feature}' not loaded for {ds.version}",
        )
    arr = ds.feature_values[feat]
    valid = arr[~np.isnan(arr)]
    if len(valid) == 0:
        raise HTTPException(status_code=404, detail="No valid feature values")
    f_min, f_max = feature_bounds(arr, feature=feat)
    num_points = max(2, min(200, num_points))
    values = np.linspace(f_min, f_max, num_points, dtype=np.float64).reshape(-1, 1)
    coords = ds.feature_umap_model[feat].predict(values)
    x_min, x_max = float(coords[:, 0].min()), float(coords[:, 0].max())
    y_min, y_max = float(coords[:, 1].min()), float(coords[:, 1].max())
    z_min, z_max = float(coords[:, 2].min()), float(coords[:, 2].max())
    print(f"[axis-trajectory][{ds.version}] {feat} raw UMAP bounds x=[{x_min:.3f}, {x_max:.3f}] y=[{y_min:.3f}, {y_max:.3f}] z=[{z_min:.3f}, {z_max:.3f}]")
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
def feature_stats(
    feature: str = "Fragment Length",
    version: Optional[str] = Query(default=None),
):
    ds = _require_api_dataset(version)
    feat = _resolve_feature_key(ds, feature)
    if feat is None:
        raise HTTPException(
            status_code=404,
            detail=f"Feature '{feature}' not loaded for {ds.version}",
        )
    arr = ds.feature_values[feat]
    valid = arr[~np.isnan(arr)]
    if len(valid) == 0:
        return {"min": 0.0, "max": 1.0}
    f_min, f_max = feature_bounds(arr, feature=feat)
    return {"min": f_min, "max": f_max}


@app.get("/api/features/{feature_name}")
def get_feature_values(
    feature_name: str,
    version: Optional[str] = Query(default=None),
):
    ds = _require_api_dataset(version)
    key = _resolve_feature_key(ds, feature_name)
    if key is None:
        raise HTTPException(
            status_code=404,
            detail=f"Feature '{feature_name}' not loaded for {ds.version}",
        )
    return {"values": ds.feature_values[key].tolist()}


@app.get("/api/health")
def health(version: Optional[str] = Query(default=None)):
    v = _resolve_version(version)
    registered = v in dataset_registry.versions()
    ds = _get_dataset(version)
    n = len(ds.umap_points) if ds.umap_points is not None else 0
    return {
        "version": ds.version,
        "requested_version": v,
        "version_registered": registered,
        "dataset_loaded": ds.loaded,
        "available_versions": dataset_registry.versions(),
        "umap_points_loaded": ds.umap_points is not None,
        "point_count": n,
        "embedding_count": n,
        "features": list(ds.feature_values.keys()),
        "axes": list(ds.feature_umap_model.keys()),
        "chat_available": is_llm_available() and bool(query_handler.available_versions()),
        "chat_versions": query_handler.available_versions(),
        "llm_model": getattr(get_llm_client(), "model", None) if is_llm_available() else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Chat — production endpoint
#
# Pipeline:
#   1. Validate + sanitize the request (size, length, version).
#   2. Pick the chat dataset version (v1 / v3) for this request.
#   3. Build conversation context from history → classify intent.
#   4. Short-circuit "greeting" / "thanks" / "help" / "unsupported" / no-stats.
#   5. Compute deterministic statistics for the classified query.
#   6. Ask the LLM to narrate them, passing the full prior conversation so
#      multi-turn follow-ups feel native.
#   7. Verify the LLM answer is *grounded* in the stats JSON; if not, fall
#      back to a deterministic textual answer.
#   8. Emit one structured log line per request with telemetry.
# ─────────────────────────────────────────────────────────────────────────────


MAX_CHAT_MESSAGE_CHARS = 2_000
MAX_HISTORY_TURNS = 12  # ~6 exchanges; keeps prompt cheap and focused


class HistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    query_type: Optional[str] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS)
    history: List[HistoryMessage] = Field(default_factory=list)
    # Which dataset version the user is exploring (v1 | v3). Backend picks the
    # matching chat data; defaults to v3 when missing or unknown.
    version: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    data: Optional[dict] = None
    query_type: Optional[str] = None
    request_id: str
    grounded: bool
    source: str  # "llm" | "fallback"


def _sanitize_history(
    history: List[HistoryMessage],
    max_turns: int = MAX_HISTORY_TURNS,
) -> List[HistoryMessage]:
    """Trim history to the last `max_turns` turns and drop oversize/blank ones."""
    cleaned: List[HistoryMessage] = []
    for m in history[-max_turns:]:
        if not m.content or not m.content.strip():
            continue
        if len(m.content) > MAX_CHAT_MESSAGE_CHARS:
            # Truncate long turns rather than reject the request.
            cleaned.append(
                HistoryMessage(
                    role=m.role,
                    content=m.content[:MAX_CHAT_MESSAGE_CHARS] + "...[truncated]",
                    query_type=m.query_type,
                )
            )
            continue
        cleaned.append(m)
    return cleaned


def _extract_context_from_history(history: List[HistoryMessage]) -> dict:
    """Walk history backwards to find the last feature / drugs / query type
    mentioned. Used by the classifier to interpret follow-ups like "and CCCP?".
    """
    context = {
        "last_query_type": None,
        "last_feature": None,
        "last_drugs": [],
        "last_user_message": None,
    }
    for msg in reversed(history):
        if context["last_feature"] is None:
            feat = query_handler.extract_feature_name(msg.content)
            if feat:
                context["last_feature"] = feat
        if msg.role == "user":
            if context["last_user_message"] is None:
                context["last_user_message"] = msg.content
            drugs = query_handler.extract_drug_names(msg.content)
            if drugs and not context["last_drugs"]:
                context["last_drugs"] = drugs
        if msg.query_type and context["last_query_type"] is None:
            context["last_query_type"] = msg.query_type
        if (
            context["last_feature"]
            and context["last_query_type"]
            and context["last_user_message"]
        ):
            break
    return context


def _round_for_display(x):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return x
    if not np.isfinite(f):
        return None
    if abs(f) >= 100:
        return round(f, 1)
    if abs(f) >= 1:
        return round(f, 2)
    if abs(f) >= 0.01:
        return round(f, 3)
    return round(f, 6)


def _fallback_answer(qtype: str, stats: dict) -> str:
    """Deterministic textual answer used whenever the LLM is unavailable or
    the LLM's answer fails the groundedness check. Designed to be useful on
    its own — not a placeholder.
    """
    try:
        if qtype == "ranking":
            feature = stats.get("feature", "the requested feature")
            direction = stats.get("direction", "high")
            rankings = stats.get("rankings") or []
            if not rankings:
                return f"I ranked drugs by {feature}, but no valid values were available."
            verb = "higher" if direction == "high" else "lower"
            lines = [f"Top drugs by {verb} {feature}:"]
            for i, r in enumerate(rankings[:10], start=1):
                lines.append(
                    f"{i}. {r.get('drug', '?')}: mean={_round_for_display(r.get('mean'))} "
                    f"(std={_round_for_display(r.get('std'))}, n={r.get('count')})"
                )
            return "\n".join(lines)

        if qtype == "drug_comparison":
            # Two layouts: nested by-drug (current `compute_drug_comparison`) or
            # the legacy `comparison` dict. Handle both safely.
            if any(isinstance(v, dict) and "features" in v for v in stats.values()):
                names = list(stats.keys())
                if not names:
                    return "I couldn't compute a comparison for those drugs."
                lines = [f"Comparison across {', '.join(names)}:"]
                feature_set: List[str] = []
                for entry in stats.values():
                    if isinstance(entry, dict):
                        for k in (entry.get("features") or {}).keys():
                            if k not in feature_set:
                                feature_set.append(k)
                for f in feature_set:
                    parts = []
                    for d in names:
                        info = (stats.get(d, {}).get("features") or {}).get(f, {})
                        if "mean" in info:
                            parts.append(f"{d}={_round_for_display(info['mean'])}")
                    if parts:
                        lines.append(f"- {f}: " + ", ".join(parts))
                return "\n".join(lines)
            return "I couldn't format the comparison."

        if qtype == "correlation":
            f1 = stats.get("feature1", "feature1")
            f2 = stats.get("feature2", "feature2")
            corr = stats.get("correlation")
            n = stats.get("n_samples")
            interp = stats.get("interpretation", "")
            return (
                f"{f1} and {f2} have a Pearson correlation of "
                f"r={_round_for_display(corr)} (n={n}) — {interp}."
            )

        if qtype == "feature_stats":
            feature = stats.get("feature", "feature")
            scope = stats.get("scope", "")
            return (
                f"{feature} {scope}: mean={_round_for_display(stats.get('mean'))}, "
                f"std={_round_for_display(stats.get('std'))}, "
                f"median={_round_for_display(stats.get('median'))}, "
                f"range {_round_for_display(stats.get('min'))} to "
                f"{_round_for_display(stats.get('max'))} (n={stats.get('n')})."
            )

        if qtype == "feature_description":
            return str(stats.get("description") or "No description available.")

        if qtype == "dataset_overview":
            drugs = stats.get("drugs") or []
            return (
                f"Dataset: {stats.get('total_samples')} samples, "
                f"{stats.get('total_features')} numeric features, "
                f"{len(drugs)} drug conditions. "
                f"Key features: {', '.join(stats.get('key_features') or [])}."
            )
    except Exception as exc:
        log.warning("chat.fallback_format_failed", extra={"qtype": qtype, "error": str(exc)})

    return (
        "I computed the statistics, but couldn't format a natural-language answer. "
        "The raw numbers are attached in `data`."
    )


@app.post("/api/chat", response_model=ChatResponse)
@limiter.limit(_chat_rate_limit)
async def chat(request: Request, req: ChatRequest):
    """
    Conversational Q&A grounded in deterministic statistics.

    The endpoint is rate-limited (see `CHAT_RATE_LIMIT` env). Returns a
    deterministic fallback if the LLM is unavailable so the chat is always
    usable.
    """
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]

    if query_handler.available_versions() == []:
        raise HTTPException(status_code=503, detail="Chat dataset not loaded.")

    selected_version = query_handler.use_version((req.version or "v3").lower())

    message = req.message.strip()
    history = _sanitize_history(req.history)

    # ── classify ───────────────────────────────────────────────────────────
    context = _extract_context_from_history(history)
    query_info = classify_query(message, context=context)
    query_type = query_info["type"]

    log.info(
        "chat.request",
        extra={
            "request_id": request_id,
            "version": selected_version,
            "history_turns": len(history),
            "query_type": query_type,
            "message_preview": message[:120],
        },
    )

    # ── conversational short-circuits ──────────────────────────────────────
    conversational = {
        "greeting": (
            "Hi! I'm MitoSpace Chat — I can help you explore the mitochondrial dataset. "
            "Try asking things like:\n\n"
            "- \"Which drugs increase motility?\"\n"
            "- \"Compare Rotenone and CCCP\"\n"
            "- \"Is motility correlated with segment length?\"\n"
            "- \"What are the effects of TBHP?\"\n\n"
            "What would you like to know?"
        ),
        "thanks": "You're welcome — ask anything else about the dataset whenever you like.",
        "help": (
            "I can analyse this mitochondrial dataset for you:\n\n"
            "**Rankings** — \"Which drugs increase motility?\"\n"
            "**Comparisons** — \"Compare Rotenone and CCCP\"\n"
            "**Correlations** — \"Is motility correlated with segment length?\"\n"
            "**Stats** — \"What is the mean fragment length for Rotenone?\"\n"
            "**Feature info** — \"What is membrane potential?\"\n"
            "**Overview** — \"What features are available?\"\n\n"
            "Follow-ups work naturally — I remember the context of the last few turns."
        ),
        "unsupported": (
            "I couldn't tell what you wanted. Try one of:\n\n"
            "- \"Which drugs increase motility?\"\n"
            "- \"Compare Rotenone and CCCP\"\n"
            "- \"Is motility correlated with segment length?\"\n"
            "- \"What are the effects of TBHP?\"\n"
            "- \"What features are available?\""
        ),
    }
    if query_type in conversational:
        return ChatResponse(
            answer=conversational[query_type],
            data=None,
            query_type=query_type,
            request_id=request_id,
            grounded=True,
            source="fallback",
        )

    # ── compute stats ──────────────────────────────────────────────────────
    try:
        computed_stats = compute_statistics(query_type, query_info["params"])
    except Exception as exc:
        log.exception(
            "chat.stats_error",
            extra={"request_id": request_id, "query_type": query_type, "error": str(exc)},
        )
        raise HTTPException(status_code=500, detail="Error computing statistics.")

    if isinstance(computed_stats, dict) and "error" in computed_stats:
        return ChatResponse(
            answer=(
                f"I couldn't compute that: {computed_stats['error']}. "
                "Try mentioning a specific drug name (e.g. Rotenone) or a feature "
                "(motility, fragment length, membrane potential)."
            ),
            data=computed_stats,
            query_type=query_type,
            request_id=request_id,
            grounded=True,
            source="fallback",
        )

    # ── LLM narration ──────────────────────────────────────────────────────
    answer: Optional[str] = None
    grounded = True
    source = "fallback"
    if is_llm_available():
        llm = get_llm_client()
        # Build a dataset-aware system prompt
        ds = query_handler._DATASETS.get(selected_version)
        n_samples = len(ds.feature_table) if ds and ds.feature_table is not None else 0
        n_drugs = (
            int(ds.sample_metadata["drug"].nunique())
            if ds and ds.sample_metadata is not None
            else 0
        )
        system_prompt = build_system_prompt(
            dataset_version=selected_version,
            n_samples=n_samples,
            n_drugs=n_drugs,
        )

        # Pass the LLM the full prior conversation so multi-turn works.
        llm_history = [{"role": m.role, "content": m.content} for m in history]

        candidate, telemetry = llm.generate(
            system_prompt=system_prompt,
            history=llm_history,
            user_question=message,
            stats_envelope=json.dumps(computed_stats, indent=2, default=str),
            query_type=query_type,
            request_id=request_id,
        )

        if candidate:
            grounded = groundedness.check_and_log(
                candidate,
                computed_stats,
                request_id=request_id,
                query_type=query_type,
            )
            if grounded:
                answer = candidate
                source = "llm"
            else:
                log.warning(
                    "chat.ungrounded_response_dropped",
                    extra={
                        "request_id": request_id,
                        "query_type": query_type,
                        "model": telemetry.model,
                    },
                )

    if answer is None:
        answer = _fallback_answer(query_type, computed_stats)
        grounded = True  # deterministic by construction

    log.info(
        "chat.response",
        extra={
            "request_id": request_id,
            "version": selected_version,
            "query_type": query_type,
            "source": source,
            "grounded": grounded,
            "answer_len": len(answer),
        },
    )

    return ChatResponse(
        answer=answer,
        data=computed_stats,
        query_type=query_type,
        request_id=request_id,
        grounded=grounded,
        source=source,
    )
