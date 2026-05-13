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
import os
import sys
from pathlib import Path
from typing import List, Optional
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv

# Chat system imports - handle both package and direct execution
try:
    # Try relative imports first (for when run as: python -m uvicorn server.main:app)
    from . import query_handler
    from . import llm_client
    from . import dataset_registry
    from .query_handler import load_data, classify_query, compute_statistics
    from .llm_client import initialize_llm_client, get_llm_client, is_llm_available
    from .dataset_registry import Dataset, load_v1, load_v3, register, feature_bounds
except ImportError:
    # Fall back to absolute imports (for when run from server/ directory)
    import query_handler
    import llm_client
    import dataset_registry
    from query_handler import load_data, classify_query, compute_statistics
    from llm_client import initialize_llm_client, get_llm_client, is_llm_available
    from dataset_registry import Dataset, load_v1, load_v3, register, feature_bounds

# Load environment variables
load_dotenv()

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


app = FastAPI(title="MitoSpace Explorer API")


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

    # ── Chat: load v3 dataset for now (chat operates on whichever is currently active) ──
    try:
        # Default chat backend: v3 data (newer). Falls back to v1 if v3 missing.
        if V3_PARQUET.exists():
            metadata_json = ROOT / "public" / "data" / "points4d_v3.json"
            load_data(str(V3_PARQUET), str(metadata_json) if metadata_json.exists() else None)
        else:
            feature_csv = DATA / "mitotnt_features.csv"
            metadata_json = ROOT / "src" / "data" / "points4d.json"
            if feature_csv.exists():
                load_data(str(feature_csv), str(metadata_json) if metadata_json.exists() else None)
    except Exception as e:
        print(f"[startup] Chat data loading failed: {e}")

    # ── LLM ──
    try:
        api_key = os.getenv("OPENROUTER_API_KEY")
        model = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
        if api_key:
            initialize_llm_client(api_key=api_key, model=model)
        else:
            print("[startup] Warning: OPENROUTER_API_KEY not set, chat will be disabled")
    except Exception as e:
        print(f"[startup] LLM initialization failed: {e}")


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
        "chat_available": is_llm_available() and query_handler.feature_table is not None,
    }


# Chat endpoint
class HistoryMessage(BaseModel):
    role: str
    content: str
    query_type: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    history: List[HistoryMessage] = []
    # Frontend dataset version (informational; chat always uses the latest data
    # the backend has loaded). Kept on the request so analytics + system prompt
    # can mention which version we're answering from.
    version: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    data: Optional[dict] = None
    query_type: Optional[str] = None


def _extract_context_from_history(history: List[HistoryMessage]) -> dict:
    """
    Extract conversation context from history to help classify follow-up questions.
    Returns dict with last_query_type, last_feature, last_drugs, last_message (user).
    """
    context = {
        'last_query_type': None,
        'last_feature': None,
        'last_drugs': [],
        'last_user_message': None,
    }
    
    # Walk backwards through history to find the last meaningful exchange
    for msg in reversed(history):
        # Extract features from both user AND assistant messages
        if context['last_feature'] is None:
            feat = query_handler.extract_feature_name(msg.content)
            if feat:
                context['last_feature'] = feat
        
        if msg.role == 'user':
            # Track the last user message for re-run on confirmation
            if context['last_user_message'] is None:
                context['last_user_message'] = msg.content
            
            drugs = query_handler.extract_drug_names(msg.content)
            if drugs and not context['last_drugs']:
                context['last_drugs'] = drugs
        
        if msg.query_type and context['last_query_type'] is None:
            context['last_query_type'] = msg.query_type
        
        # Stop once we have enough context
        if context['last_feature'] and context['last_query_type'] and context['last_user_message']:
            break
    
    return context


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Conversational Q&A endpoint for dataset queries
    
    Flow:
    1. Classify query type (with conversation context for follow-ups)
    2. Compute relevant statistics from dataset
    3. Send stats to LLM with strict prompt
    4. Return formatted natural language answer
    """
    # Check if chat is available
    if not is_llm_available():
        raise HTTPException(
            status_code=503,
            detail="Chat system is not available. LLM client not initialized."
        )
    
    if query_handler.feature_table is None:
        raise HTTPException(
            status_code=503,
            detail="Chat system is not available. Dataset not loaded."
        )
    
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Extract context from conversation history
    context = _extract_context_from_history(req.history)
    print(f"[chat] Message: '{message}' | Context: {context}")
    
    # Step 1: Classify query (with context awareness)
    query_info = classify_query(message, context=context)
    query_type = query_info['type']
    
    # Step 2: Handle special conversational types (no stats needed)
    if query_type == 'greeting':
        return ChatResponse(
            answer="Hi! I'm MitoSpace Chat — I can help you explore the mitochondrial dataset. "
                   "Try asking things like:\n\n"
                   "• \"Which drugs increase motility?\"\n"
                   "• \"Compare Rotenone and CCCP\"\n"
                   "• \"Is motility correlated with segment length?\"\n"
                   "• \"What are the effects of TBHP?\"\n\n"
                   "What would you like to know?",
            data=None,
            query_type="greeting"
        )
    
    if query_type == 'thanks':
        return ChatResponse(
            answer="You're welcome! Feel free to ask more questions about the dataset anytime.",
            data=None,
            query_type="thanks"
        )
    
    if query_type == 'help':
        return ChatResponse(
            answer="I can analyze this mitochondrial dataset for you. Here's what I can do:\n\n"
                   "**Drug Rankings** — \"Which drugs increase motility the most?\"\n"
                   "**Drug Comparisons** — \"Compare Rotenone and CCCP\" or \"What are the effects of TBHP?\"\n"
                   "**Feature Correlations** — \"Is motility correlated with segment length?\"\n"
                   "**Summary Statistics** — \"What is the mean fragment length for Rotenone?\"\n"
                   "**Feature Info** — \"What is membrane potential?\"\n"
                   "**Dataset Overview** — \"What features are available?\"\n\n"
                   "You can also ask follow-up questions naturally — I'll remember the context!",
            data=None,
            query_type="help"
        )
    
    if query_type == 'unsupported':
        return ChatResponse(
            answer="I'm not sure I understood that. Here are some things I can help with:\n\n"
                   "• \"Which drugs increase motility?\" — rank drugs by a feature\n"
                   "• \"Compare Rotenone and CCCP\" — compare drug effects\n"
                   "• \"Is motility correlated with segment length?\" — feature correlations\n"
                   "• \"What are the effects of TBHP?\" — drug effects\n"
                   "• \"What features are available?\" — dataset overview\n\n"
                   "Try rephrasing, or just mention a drug or feature name!",
            data=None,
            query_type="unsupported"
        )
    
    # Step 3: Compute statistics
    try:
        computed_stats = compute_statistics(query_type, query_info['params'])
    except Exception as e:
        print(f"[chat] Statistics computation error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error computing statistics: {str(e)}"
        )
    
    # Check for errors in computation
    if 'error' in computed_stats:
        return ChatResponse(
            answer=f"Sorry, I couldn't process that: {computed_stats['error']}. "
                   f"Try mentioning a specific drug name or feature (like motility, fragment length, or membrane potential).",
            data=computed_stats,
            query_type=query_type
        )
    
    def _fallback_answer(qtype: str, stats: dict) -> str:
        """
        Deterministic fallback for when the LLM is unavailable or errors.
        This keeps chat usable (returns a useful answer) even if OpenRouter
        credentials are missing / rate-limited / failing.
        """
        try:
            if qtype == "ranking":
                feature = stats.get("feature", "feature")
                direction = stats.get("direction", "high")
                rankings = stats.get("rankings") or []
                if not rankings:
                    return f"I computed the ranking for {feature}, but there were no valid drug values to rank."
                lines = [f"Top drugs by {'higher' if direction == 'high' else 'lower'} {feature}:"]
                for i, r in enumerate(rankings[:10], start=1):
                    drug = r.get("drug", "unknown")
                    mean = r.get("mean", None)
                    std = r.get("std", None)
                    n = r.get("count", None)
                    lines.append(f"{i}. {drug}: mean={mean} (std={std}, n={n})")
                return "\n".join(lines)

            if qtype == "drug_comparison":
                drugs = stats.get("drugs") or []
                feats = stats.get("features") or []
                lines = []
                if drugs and feats:
                    lines.append(f"Comparison for {', '.join(map(str, drugs))}:")
                for f in feats:
                    a = stats.get("comparison", {}).get(f, {})
                    if not a:
                        continue
                    lines.append(
                        f"- {f}: {drugs[0] if len(drugs)>0 else 'A'} mean={a.get('drug1_mean')} vs "
                        f"{drugs[1] if len(drugs)>1 else 'B'} mean={a.get('drug2_mean')} "
                        f"(Δ={a.get('difference')}, effect={a.get('effect')})"
                    )
                return "\n".join(lines) if lines else "I computed the comparison statistics, but couldn't format them."

            if qtype == "correlation":
                f1 = stats.get("feature1", "feature1")
                f2 = stats.get("feature2", "feature2")
                corr = stats.get("correlation", None)
                n = stats.get("n_samples", None)
                interp = stats.get("interpretation", "")
                return f"Correlation between {f1} and {f2}: r={corr} (n={n}). Interpretation: {interp}."

            if qtype == "feature_stats":
                feature = stats.get("feature", "feature")
                scope = stats.get("scope", "")
                return (
                    f"{feature} {scope}: mean={stats.get('mean')}, std={stats.get('std')}, "
                    f"median={stats.get('median')}, min={stats.get('min')}, max={stats.get('max')} (n={stats.get('n')})."
                )

            if qtype == "feature_description":
                return str(stats.get("description") or "No description available.")

            if qtype == "dataset_overview":
                return (
                    f"Dataset overview: {stats.get('n_samples')} samples, {stats.get('n_features')} features. "
                    f"Key features: {', '.join(stats.get('key_features') or [])}."
                )
        except Exception:
            pass
        return "I computed the statistics, but the language model response failed. The raw results are included in the response data."

    # Step 4: Generate LLM response (with deterministic fallback)
    answer = None
    try:
        llm = get_llm_client()
        answer = llm.generate_response(
            user_question=message,
            computed_stats=computed_stats,
            query_type=query_type
        )
        # Some LLM error paths return a generic apology string; treat that as a failure
        # and fall back to a deterministic answer.
        if isinstance(answer, str) and answer.strip().lower().startswith("sorry, there was an error processing your question"):
            answer = None
    except Exception as e:
        print(f"[chat] LLM generation error (falling back): {e}")

    if not answer:
        answer = _fallback_answer(query_type, computed_stats)
    
    return ChatResponse(
        answer=answer,
        data=computed_stats,
        query_type=query_type
    )
