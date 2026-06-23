"""
Query handler for chat system - classify queries and compute statistics.

Designed for natural conversational flow:
- Rich alias mapping for features and drugs
- Context-aware follow-up handling
- Graceful handling of greetings, thanks, help requests
- Dataset overview for vague questions
- Multi-version: chat can serve v1 or v3 from a single backend, picked per
  request via the `version` argument. Datasets are loaded once at startup
  and kept in `_DATASETS`.
"""
import logging
import math
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd
from scipy import stats as _scipy_stats


logger = logging.getLogger("mitospace.query")


@dataclass
class ChatDataset:
    """Per-version feature table + sample metadata used by chat."""

    version: str
    feature_table: pd.DataFrame
    sample_metadata: Optional[pd.DataFrame] = None


# Module-level registry. Populated by `load_data(... version=...)` at startup.
# Default key is "v3" so any legacy code that just calls `feature_table` keeps
# pointing at the newest dataset.
_DATASETS: Dict[str, ChatDataset] = {}
_DEFAULT_VERSION = "v3"


# Backward-compat globals (kept so existing imports don't break). They mirror
# whichever version was loaded last by `load_data` without an explicit version.
feature_table: Optional[pd.DataFrame] = None
sample_metadata: Optional[pd.DataFrame] = None

# ─── Feature name mapping (user-friendly → CSV column name) ───
# Extensive aliases so users can say things naturally
FEATURE_ALIASES = {
    # Fragment Length
    'fragment length': 'Fragment Length',
    'fragmentation': 'Fragment Length',
    'fragment size': 'Fragment Length',
    'fragmented': 'Fragment Length',
    'fragments': 'Fragment Length',
    'frag length': 'Fragment Length',
    # Segment Length
    'segment length': 'Segment Length',
    'segment size': 'Segment Length',
    'segments': 'Segment Length',
    'seg length': 'Segment Length',
    'morphology': 'Segment Length',
    # Motility (v3): the dataset reports "diffusivity" at three structural scales
    # (fragment / segment / node). The UI now exposes all three as separate axes
    # under the names "Fragment / Segment / Node Motility". Plain "motility"
    # without a scale defaults to Fragment Motility (the canonical scale).
    'motility': 'Fragment Diffusivity',
    'fragment motility': 'Fragment Diffusivity',
    'segment motility': 'Segment Diffusivity',
    'node motility': 'Node Diffusivity',
    'movement': 'Fragment Diffusivity',
    'motion': 'Fragment Diffusivity',
    'dynamics': 'Fragment Diffusivity',
    'dynamic': 'Fragment Diffusivity',
    'optical flow': 'Fragment Diffusivity',
    'optical flow (fg)': 'Fragment Diffusivity',
    'optical flow (bg)': 'Fragment Diffusivity',
    'flow': 'Fragment Diffusivity',
    'moving': 'Fragment Diffusivity',
    'mobility': 'Fragment Diffusivity',
    'speed': 'Fragment Diffusivity',
    'diffusivity': 'Fragment Diffusivity',
    'diffusion': 'Fragment Diffusivity',
    'fragment diffusivity': 'Fragment Diffusivity',
    'segment diffusivity': 'Segment Diffusivity',
    'node diffusivity': 'Node Diffusivity',
    # Tortuosity (new in v3)
    'tortuosity': 'Fragment Tortuosity',
    'fragment tortuosity': 'Fragment Tortuosity',
    'curvature': 'Fragment Tortuosity',
    'curved': 'Fragment Tortuosity',
    'curvy': 'Fragment Tortuosity',
    # Membrane Potential / TMRM
    'membrane potential': 'TMRM Intensity',
    'tmrm': 'TMRM Intensity',
    'tmrm intensity': 'TMRM Intensity',
    'potential': 'TMRM Intensity',
    'membrane': 'TMRM Intensity',
    'polarization': 'TMRM Intensity',
    'polarized': 'TMRM Intensity',
    'depolarization': 'TMRM Intensity',
    'depolarized': 'TMRM Intensity',
    'health': 'TMRM Intensity',
    'healthy': 'TMRM Intensity',
    'function': 'TMRM Intensity',
    # MitoTracker (mitochondrial mass)
    'mitotracker': 'MitoTracker Intensity',
    'mitotracker intensity': 'MitoTracker Intensity',
    'mitochondrial mass': 'MitoTracker Intensity',
    'mass': 'MitoTracker Intensity',
    # Diameter
    'diameter': 'Fragment Diameter',
    'width': 'Fragment Diameter',
    'thickness': 'Fragment Diameter',
    # Fusion / Fission
    'fusion': 'Fusion Rate',
    'fusion rate': 'Fusion Rate',
    'fusing': 'Fusion Rate',
    'fission': 'Fission Rate',
    'fission rate': 'Fission Rate',
    'splitting': 'Fission Rate',
    'dividing': 'Fission Rate',
    'division': 'Fission Rate',
    # Network properties
    'clustering': 'Clustering Coefficient',
    'connectivity': 'Clustering Coefficient',
    'interconnected': 'Clustering Coefficient',
    'network': 'Clustering Coefficient',
    'reticulated': 'Clustering Coefficient',
    'density': 'Graph Density',
    'efficiency': 'Graph Efficiency',
    'graph efficiency': 'Graph Efficiency',
    'graph density': 'Graph Density',
    'node count': 'Node Count',
    'nodes': 'Node Count',
    'complexity': 'Node Count',
}

# Drug aliases (Control and DMSO are the same). Values are canonical slugs in
# metadata after legacy typo cleanup (`lantrunculinb` → `latrunculinb`).
DRUG_ALIASES = {
    'control': 'DMSO',
    'ctrl': 'DMSO',
    'vehicle': 'DMSO',
    'untreated': 'DMSO',
    'baseline': 'DMSO',
    'lantrunculinb': 'latrunculinb',
    'lantrunculin b': 'latrunculinb',
    'lantrunculin-b': 'latrunculinb',
    'latrunculin b': 'latrunculinb',
    'latrunculin-b': 'latrunculinb',
}

# Legacy typo in older exports / parquets → canonical slug in `sample_metadata['drug']`.
_DRUG_SLUG_CORRECTIONS: Dict[str, str] = {
    'lantrunculinb': 'latrunculinb',
}


def normalize_drug_slug(drug: str) -> str:
    """Map user or legacy-corpus spellings to the identifier used in loaded metadata."""
    d = (drug or '').strip()
    if not d:
        return d
    key = d.lower().replace(' ', '').replace('-', '')
    key = _DRUG_SLUG_CORRECTIONS.get(key, key)
    for alias, canonical in DRUG_ALIASES.items():
        ak = alias.lower().replace(' ', '').replace('-', '')
        if ak == key:
            return canonical
    return d

# All numeric features (v1 + v3 friendly names; v3 also adds Tortuosity)
NUMERIC_FEATURES = [
    'Node Count', 'Degree', 'Segment Length', 'Fragment Length', 'Fragment Diameter',
    'Fragment Tortuosity',
    'Graph Density', 'Graph Efficiency', 'Clustering Coefficient',
    'Node Diffusivity', 'Segment Diffusivity', 'Fragment Diffusivity',
    'Fusion Rate', 'Fission Rate', 'TMRM Intensity', 'MitoTracker Intensity',
    # Legacy v1 columns kept for backward-compat:
    'Node Diffusivity Std', 'Segment Diffusivity Std', 'Fragment Diffusivity Std',
    'Optical Flow (fg)',
]

# Key features (the most commonly discussed ones)
KEY_FEATURES = [
    'Fragment Length', 'Segment Length', 'Fragment Diameter', 'Fragment Tortuosity',
    'Fragment Diffusivity', 'Fission Rate', 'Fusion Rate', 'TMRM Intensity',
]


def load_data(
    feature_path: str,
    metadata_json_path: Optional[str] = None,
    *,
    version: str = _DEFAULT_VERSION,
) -> None:
    """
    Load the chat dataset into memory under `version`.

    Accepts either:
      - a .csv  (legacy v1 mitotnt_features.csv layout)
      - a .parquet (v3 features_v3.parquet layout, with snake_case columns)

    For v3 we also derive `TMRM Intensity` (last timepoint of `tmrm_intensities`)
    and surface a small set of v1-friendly column aliases so the existing
    NUMERIC_FEATURES / KEY_FEATURES list keeps working without per-column rewrites.

    The loaded data is registered under `version` (default v3). Module-level
    `feature_table` / `sample_metadata` are also updated to mirror the most
    recent load so backward-compatible callers keep working.
    """
    global feature_table, sample_metadata

    path = str(feature_path)
    if path.endswith('.parquet'):
        df = pd.read_parquet(path)
        # Derive scalar TMRM intensity (last timepoint) and morph intensity (last timepoint)
        if 'tmrm_intensities' in df.columns:
            df['TMRM Intensity'] = df['tmrm_intensities'].apply(
                lambda a: float(np.asarray(a)[-1]) if a is not None and len(np.asarray(a)) > 0 else np.nan
            )
        if 'morph_intensities' in df.columns:
            df['MitoTracker Intensity'] = df['morph_intensities'].apply(
                lambda a: float(np.asarray(a)[-1]) if a is not None and len(np.asarray(a)) > 0 else np.nan
            )
        # v1-friendly aliases for the same features
        v1_aliases = {
            'Fragment Length': 'fragment_length_mean',
            'Segment Length': 'segment_length_mean',
            'Fragment Diameter': 'fragment_diameter_mean',
            'Fragment Tortuosity': 'fragment_tortuosity_mean',
            'Fragment Diffusivity': 'fragment_diffusivity_mean',
            'Segment Diffusivity': 'segment_diffusivity_mean',
            'Node Diffusivity': 'node_diffusivity_mean',
            'Fission Rate': 'fission_rate_mean',
            'Fusion Rate': 'fusion_rate_mean',
            'Graph Density': 'graph_density_mean',
            'Graph Efficiency': 'graph_efficiency_mean',
            'Clustering Coefficient': 'graph_clustering_coefficient_mean',
            'Node Count': 'total_node_count_mean',
        }
        for friendly, src in v1_aliases.items():
            if src in df.columns and friendly not in df.columns:
                df[friendly] = df[src]
        feature_table = df
    else:
        feature_table = pd.read_csv(path)
    if 'label_names' in feature_table.columns:
        feature_table['label_names'] = feature_table['label_names'].astype(str).replace(
            {'lantrunculinb': 'latrunculinb'}
        )
    logger.info(
        "chat.dataset_loaded",
        extra={
            "version": version,
            "samples": len(feature_table),
            "columns": len(feature_table.columns),
            "path": path,
        },
    )

    if metadata_json_path:
        import json
        with open(metadata_json_path, 'r') as f:
            data = json.load(f)
            if 'points' in data:
                metadata_records = []
                for point in data['points']:
                    treatment = point.get('treatment', {}) or {}
                    metadata_records.append({
                        'id': point.get('id'),
                        'drug': treatment.get('drug', 'unknown'),
                        'dose': treatment.get('dose', ''),
                        'time': treatment.get('time', ''),
                        'phenotype': point.get('phenotype', ''),
                    })
                sample_metadata = pd.DataFrame(metadata_records)
                for col in ('drug', 'phenotype'):
                    if col in sample_metadata.columns:
                        sample_metadata[col] = sample_metadata[col].astype(str).replace(
                            {'lantrunculinb': 'latrunculinb'}
                        )
                logger.info(
                    "chat.metadata_loaded",
                    extra={"version": version, "samples": len(sample_metadata)},
                )
    elif 'label_names' in feature_table.columns:
        # v3 parquet has labels embedded — derive metadata from it
        sample_metadata = pd.DataFrame({
            'id': [f'p{i}' for i in range(len(feature_table))],
            'drug': feature_table['label_names'].astype(str).values,
            'dose': '10 nM',
            'time': '1h',
            'phenotype': feature_table['label_names'].astype(str).values,
        })
        if 'labels_moa' in feature_table.columns:
            sample_metadata['moa'] = feature_table['labels_moa'].astype(str).values
        logger.info(
            "chat.metadata_derived",
            extra={"version": version, "samples": len(sample_metadata)},
        )

    # Register under this version. Active globals already reflect this load.
    _DATASETS[version] = ChatDataset(
        version=version,
        feature_table=feature_table,
        sample_metadata=sample_metadata,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Per-request version switching (thread-safe enough for our single-process
# uvicorn worker; if we ever go multi-worker we'd pass version explicitly).
# ─────────────────────────────────────────────────────────────────────────────


def available_versions() -> List[str]:
    return list(_DATASETS.keys())


def has_version(version: str) -> bool:
    return version in _DATASETS


def use_version(version: str) -> str:
    """Swap module-level `feature_table` / `sample_metadata` to the requested
    version for the duration of the current request. Returns the version that
    was actually selected (falls back to the default when missing).
    """
    global feature_table, sample_metadata
    v = version if version in _DATASETS else _DEFAULT_VERSION
    if v not in _DATASETS:
        return v
    ds = _DATASETS[v]
    feature_table = ds.feature_table
    sample_metadata = ds.sample_metadata
    return v


def extract_feature_name(text: str) -> Optional[str]:
    """Extract feature name from user query (checks aliases then direct names)."""
    text_lower = text.lower()

    # Check aliases first (longer aliases first to avoid partial matches)
    sorted_aliases = sorted(FEATURE_ALIASES.keys(), key=len, reverse=True)
    for alias in sorted_aliases:
        if alias in text_lower:
            return FEATURE_ALIASES[alias]

    # Check direct feature names
    for feature in NUMERIC_FEATURES:
        if feature.lower() in text_lower:
            return feature

    return None


def extract_drug_names(text: str) -> List[str]:
    """Extract drug names from user query (case-insensitive, normalizes Control → DMSO)."""
    if sample_metadata is None:
        return []

    drugs = []
    text_lower = text.lower()

    # Check for aliases first
    for alias, canonical_name in DRUG_ALIASES.items():
        if alias in text_lower and canonical_name not in drugs:
            drugs.append(canonical_name)

    # Get unique drugs from metadata
    unique_drugs = sample_metadata['drug'].unique() if sample_metadata is not None else []

    # Substring match (case-insensitive)
    for drug in unique_drugs:
        if drug.lower() in text_lower and drug not in drugs:
            drugs.append(drug)

    # Word-level match (handles "TBHP" vs "tbhp", "H2O2" etc.)
    words = re.findall(r'[A-Za-z0-9]+', text)
    for word in words:
        for drug in unique_drugs:
            if word.lower() == drug.lower() and drug not in drugs:
                drugs.append(drug)

    return drugs


def _extract_features_from_text(text: str) -> List[str]:
    """Extract all features mentioned in text (by name or alias)."""
    features = []
    text_lower = text.lower()

    for feat in NUMERIC_FEATURES:
        if feat.lower() in text_lower and feat not in features:
            features.append(feat)

    sorted_aliases = sorted(FEATURE_ALIASES.keys(), key=len, reverse=True)
    for alias in sorted_aliases:
        feat = FEATURE_ALIASES[alias]
        if alias in text_lower and feat not in features:
            features.append(feat)

    return features


# ═══════════════════════════════════════════════════════════════
#  QUERY CLASSIFIER
# ═══════════════════════════════════════════════════════════════

def classify_query(message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Classify user query into supported types, using conversation context for follow-ups.
    Designed to handle natural, conversational language gracefully.
    """
    msg_lower = message.lower().strip()
    ctx = context or {}
    last_feature = ctx.get('last_feature')
    last_query_type = ctx.get('last_query_type')
    last_drugs = ctx.get('last_drugs', [])
    last_user_message = ctx.get('last_user_message')

    # Extract things from the current message upfront
    current_drugs = extract_drug_names(message)
    current_feature = extract_feature_name(message)

    logger.debug(
        "chat.classify_input",
        extra={
            "msg": msg_lower[:200],
            "drugs": current_drugs,
            "feature": current_feature,
            "ctx_feature": last_feature,
            "ctx_query_type": last_query_type,
        },
    )

    # ── 0. Greetings, thanks, help ──
    greetings = ['hello', 'hi ', 'hi!', 'hey', 'good morning', 'good afternoon', 'good evening']
    thanks = ['thank', 'thanks', 'cheers', 'appreciate', 'great', 'awesome', 'perfect', 'nice', 'cool', 'good job', 'well done']
    help_words = ['help', 'can you help', 'what can you do', 'how do you work', 'how does this work', 'capabilities']

    if any(msg_lower.startswith(g) or msg_lower == g.strip() for g in greetings) and len(msg_lower) < 30:
        return {'type': 'greeting', 'params': {}}

    if any(t in msg_lower for t in thanks) and len(msg_lower) < 50 and not current_feature and not current_drugs:
        return {'type': 'thanks', 'params': {}}

    if any(h in msg_lower for h in help_words):
        return {'type': 'help', 'params': {}}

    # ── 0a-pre. Clarification / meta-questions about the previous answer.
    # Triggers like "are you sure?", "is that right?", "explain", "why" should
    # NOT fall through to "unsupported" — they're conversational and want the
    # LLM to defend or explain the previous answer.
    clarification_patterns = [
        "are you sure", "are you certain", "is that correct", "is that right",
        "is this correct", "is this right", "is that accurate", "is this accurate",
        "double check", "double-check", "doublecheck", "recompute", "recheck",
        "verify that", "verify this", "check that", "check this",
        "how do you know", "where did", "where do these come from",
        "explain that", "explain this", "explain more", "explain why",
        "tell me more", "tell me why", "elaborate", "expand on",
        "go deeper", "more detail", "more details", "in more detail",
        "doesn't look right", "doesn't seem right", "doesn't look correct",
        "doesn't make sense", "makes no sense", "make no sense",
        "looks wrong", "looks off", "seems wrong", "seems off",
        "are these correct", "are these right", "are those correct",
        "what does this mean", "what do you mean", "interpret",
    ]
    # Standalone single-word triggers — only fire when the message is short and
    # we have a previous turn to refer to.
    msg_stripped = msg_lower.strip().rstrip("?.!")
    is_short_meta = msg_stripped in {"why", "really", "sure", "explain", "elaborate"}
    has_prior_turn = bool(
        last_query_type or (context and context.get("last_user_message"))
    )
    if (
        any(p in msg_lower for p in clarification_patterns)
        or (is_short_meta and has_prior_turn)
    ) and has_prior_turn:
        return {
            "type": "clarification",
            "params": {
                "prior_query_type": last_query_type,
                "prior_user_message": context.get("last_user_message") if context else None,
            },
        }

    # ── 0b-pre. Drug-similarity & top-differentiator intents.
    # These must come BEFORE the dataset-overview pattern, because phrases
    # like "what drugs look like rotenone?" otherwise trigger the overview
    # match on "what drugs".
    similarity_words = [
        "similar to", "resemble", "closest to",
        "neighbours of", "neighbors of", "phenotype like", "behave like",
        "phenotypically similar", "act like", "phenocopy", "phenocopies",
    ]
    # Regex for "look(s) (most/much/very) like" — handles adverbs between the verb
    # and "like" that scientists naturally insert ("look most like", "looks a lot like").
    _look_like_re = re.compile(r"\blooks?\s+(?:[a-z]+\s+){0,3}like\b", re.IGNORECASE)
    if (
        any(p in msg_lower for p in similarity_words)
        or _look_like_re.search(message)
    ) and current_drugs:
        return {
            "type": "drug_similarity",
            "params": {"drug": current_drugs[0], "top_n": 5},
        }

    differentiator_phrases = [
        "differs most", "differs the most", "biggest difference",
        "largest difference", "most different", "distinguish",
        "what's different", "what is different", "differ most",
    ]
    if any(p in msg_lower for p in differentiator_phrases):
        if len(current_drugs) >= 2:
            return {
                "type": "top_differentiators",
                "params": {"drug_a": current_drugs[0], "drug_b": current_drugs[1], "top_n": 5},
            }
        elif len(current_drugs) == 1:
            return {
                "type": "top_differentiators",
                "params": {"drug_a": current_drugs[0], "drug_b": "DMSO", "top_n": 5},
            }

    # ── 0b. Dataset overview questions ──
    overview_patterns = [
        'what features', 'which features', 'available features', 'list features',
        'what data', 'about the data', 'about this data', 'dataset overview',
        'tell me about the dataset', 'what drugs', 'which drugs are',
        'how many samples', 'how many drugs', 'how many features',
        'what is available', 'what can i ask', 'what do you know',
        'overview', 'summarize the data', 'summary of the data',
        "what's in", 'what is in', 'in this dataset', 'in the dataset',
        'describe the dataset', 'tell me about the data',
    ]
    if any(p in msg_lower for p in overview_patterns):
        return {'type': 'dataset_overview', 'params': {}}

    # ── 1. Agreement / confirmation patterns ──
    agreement_words = ['yes', 'sure', 'ok', 'okay', 'go ahead', 'do it', 'lets do', "let's do",
                       'please do', 'yep', 'yeah', 'right', 'correct', 'exactly', 'proceed',
                       'sounds good', 'that works']
    is_agreement = any(word in msg_lower for word in agreement_words) and len(msg_lower) < 80

    if is_agreement:
        if current_feature and last_feature and current_feature != last_feature:
            return {'type': 'correlation', 'params': {'features': [last_feature, current_feature]}}

        if 'all' in msg_lower or 'sample' in msg_lower:
            if last_feature:
                return {'type': 'feature_stats', 'params': {'feature': last_feature}}

        if last_query_type == 'ranking' and last_feature:
            return {'type': 'ranking', 'params': {'feature': last_feature, 'direction': 'high', 'top_n': 10}}
        elif last_query_type == 'correlation' and last_feature:
            return {'type': 'feature_stats', 'params': {'feature': last_feature}}
        elif last_query_type == 'feature_stats' and last_feature:
            return {'type': 'feature_stats', 'params': {'feature': last_feature}}
        elif last_query_type == 'drug_comparison' and last_drugs:
            return {'type': 'drug_comparison', 'params': {'drugs': last_drugs[:5]}}

    # ── 2. "What about X?" / "and their Y?" / pronoun follow-ups ──
    followup_patterns = [
        'what about', 'how about', 'and what about', 'what of',
        'and their', 'their correlation', 'its correlation',
        'what is their', 'what are their', 'and for', 'now for',
        'same for', 'same but', 'do the same', 'repeat for',
    ]
    is_followup = any(p in msg_lower for p in followup_patterns)

    if is_followup:
        # Correlation follow-up: "and their correlation with X"
        if 'correlat' in msg_lower or 'relationship' in msg_lower or 'related' in msg_lower:
            features = _extract_features_from_text(message)
            if len(features) == 1 and last_feature and last_feature not in features:
                features = [last_feature, features[0]]
            elif len(features) == 0 and last_feature:
                features = [last_feature]
            if len(features) >= 2:
                return {'type': 'correlation', 'params': {'features': features[:2]}}

        if current_drugs:
            if len(current_drugs) >= 2:
                return {'type': 'drug_comparison', 'params': {'drugs': current_drugs[:5]}}
            elif len(current_drugs) == 1:
                feat = current_feature or last_feature or 'Fragment Length'
                return {'type': 'feature_stats', 'params': {'feature': feat, 'drug': current_drugs[0]}}

        if current_feature:
            if last_query_type == 'ranking':
                return {'type': 'ranking', 'params': {'feature': current_feature, 'direction': 'high', 'top_n': 10}}
            elif last_query_type == 'drug_comparison' and last_drugs:
                return {'type': 'drug_comparison', 'params': {'drugs': last_drugs[:5]}}
            else:
                return {'type': 'feature_stats', 'params': {'feature': current_feature}}

    # ── 3. Drug comparison ──
    comparison_words = ['compare', 'difference', 'versus', ' vs ', 'differ']
    if any(word in msg_lower for word in comparison_words):
        if len(current_drugs) >= 2:
            return {'type': 'drug_comparison', 'params': {'drugs': current_drugs[:5]}}
        elif len(current_drugs) == 1:
            return {'type': 'drug_comparison', 'params': {'drugs': [current_drugs[0], 'DMSO']}}

    # ── 4. Correlation / relationship ──
    correlation_words = ['correlat', 'relationship', 'related to', 'linked to', 'associated with',
                         'connection between', 'depend on', 'depends on', 'covar']
    if any(word in msg_lower for word in correlation_words):
        features = _extract_features_from_text(message)
        if len(features) == 1 and last_feature and last_feature not in features:
            features = [last_feature, features[0]]
        if len(features) >= 2:
            return {'type': 'correlation', 'params': {'features': features[:2]}}

    # ── 5. Ranking queries ──
    # Generic ranking triggers ("which drugs", "what drugs") imply ranking but
    # don't specify direction. We split signals into "directional" (explicitly
    # high or low) and "generic" so an explicit "decrease" never gets shadowed
    # by the generic "which drugs" trigger that also fires on the same query.
    ranking_words_high_explicit = [
        'highest', 'most', 'increase', 'largest', 'maximum', 'top',
        'best', 'strongest', 'greatest',
    ]
    ranking_words_low_explicit = [
        'lowest', 'least', 'decrease', 'smallest', 'minimum', 'bottom',
        'worst', 'weakest', 'reduce', 'lower', 'inhibit', 'diminish',
    ]
    ranking_words_generic = ['which drugs', 'what drugs']

    has_high = any(word in msg_lower for word in ranking_words_high_explicit)
    has_low = any(word in msg_lower for word in ranking_words_low_explicit)
    has_generic = any(word in msg_lower for word in ranking_words_generic)

    if has_high or has_low or has_generic:
        feature = current_feature or last_feature
        if feature:
            if has_low and not has_high:
                direction = 'low'
            else:
                direction = 'high'  # explicit high, or generic with no other signal
            return {'type': 'ranking', 'params': {'feature': feature, 'direction': direction, 'top_n': 10}}

    # ── 6. "Effects of [drug]" / "what does [drug] do" ──
    effects_patterns = ['effect of', 'effects of', 'what does', 'how does', 'impact of',
                        'role of', 'influence of', 'affect', 'cause']
    if any(p in msg_lower for p in effects_patterns):
        if current_drugs:
            if len(current_drugs) >= 2:
                return {'type': 'drug_comparison', 'params': {'drugs': current_drugs[:5]}}
            else:
                return {'type': 'drug_comparison', 'params': {'drugs': [current_drugs[0], 'DMSO']}}
        if current_feature:
            return {'type': 'ranking', 'params': {'feature': current_feature, 'direction': 'high', 'top_n': 10}}

    # ── 7. Summary statistics ──
    stats_words = ['mean', 'average', 'median', 'summary', 'statistics', 'stats',
                   'distribution', 'range', 'variance', 'spread']
    if any(word in msg_lower for word in stats_words):
        feature = current_feature
        drug = current_drugs
        if feature:
            params = {'feature': feature}
            if drug:
                params['drug'] = drug[0]
            return {'type': 'feature_stats', 'params': params}

    # ── 8. Simple feature query ──
    description_words = ['what is', 'tell me about', 'explain', 'describe', 'meaning of',
                         'definition of', 'what does .* measure', 'what does .* mean']
    if any(word in msg_lower for word in description_words):
        feature = current_feature
        if feature:
            return {'type': 'feature_description', 'params': {'feature': feature}}

    # ── 9. Fallback: mentions drugs → context-aware action ──
    if current_drugs:
        if last_query_type == 'ranking' and last_feature:
            if len(current_drugs) >= 2:
                return {'type': 'drug_comparison', 'params': {'drugs': current_drugs[:5]}}
            else:
                return {'type': 'feature_stats', 'params': {'feature': last_feature, 'drug': current_drugs[0]}}
        else:
            if len(current_drugs) >= 2:
                return {'type': 'drug_comparison', 'params': {'drugs': current_drugs[:5]}}
            else:
                return {'type': 'drug_comparison', 'params': {'drugs': [current_drugs[0], 'DMSO']}}

    # ── 10. Fallback: mentions a feature → context-aware action ──
    if current_feature:
        if last_query_type == 'ranking':
            return {'type': 'ranking', 'params': {'feature': current_feature, 'direction': 'high', 'top_n': 10}}
        else:
            return {'type': 'feature_stats', 'params': {'feature': current_feature}}

    # ── 11. Last resort: if there's context, try to be helpful ──
    if last_feature and last_query_type:
        # "more", "others", "anything else", "what else"
        vague_followups = ['more', 'other', 'else', 'another', 'similar', 'again', 'continue']
        if any(w in msg_lower for w in vague_followups):
            if last_query_type == 'ranking':
                return {'type': 'ranking', 'params': {'feature': last_feature, 'direction': 'high', 'top_n': 10}}
            elif last_query_type == 'feature_stats':
                return {'type': 'feature_stats', 'params': {'feature': last_feature}}

    return {'type': 'unsupported', 'params': {}}


# ═══════════════════════════════════════════════════════════════
#  DATASET OVERVIEW
# ═══════════════════════════════════════════════════════════════

def compute_dataset_overview() -> Dict[str, Any]:
    """Generate an overview of the dataset."""
    overview = {
        'total_samples': 0,
        'total_features': 0,
        'key_features': [],
        'drugs': [],
        'drug_counts': {},
    }

    if feature_table is not None:
        overview['total_samples'] = len(feature_table)
        overview['total_features'] = len([c for c in feature_table.columns if c in NUMERIC_FEATURES])
        overview['key_features'] = KEY_FEATURES

    if sample_metadata is not None:
        drug_counts = sample_metadata['drug'].value_counts().to_dict()
        # Merge Control/DMSO
        merged = {}
        for drug, count in drug_counts.items():
            if drug.upper() in ['DMSO', 'CONTROL']:
                merged['DMSO (control)'] = merged.get('DMSO (control)', 0) + count
            else:
                merged[drug] = count
        overview['drugs'] = list(merged.keys())
        overview['drug_counts'] = merged

    return overview


# ═══════════════════════════════════════════════════════════════
#  STATISTICS COMPUTATION
# ═══════════════════════════════════════════════════════════════

def _normalize_drug_name(drug: str) -> str:
    """Normalize drug name - convert DMSO/Control to the canonical name that exists in dataset."""
    if sample_metadata is None:
        return drug
    available_drugs = set(sample_metadata['drug'].unique())
    if drug in ['DMSO', 'Control']:
        if 'DMSO' in available_drugs:
            return 'DMSO'
        elif 'Control' in available_drugs:
            return 'Control'
    return drug


def _summary(values: pd.Series) -> Dict[str, Any]:
    """Per-group descriptive summary plus SEM and 95% CI of the mean.

    SEM = std / sqrt(n); 95% CI = mean ± 1.96 * SEM (large-n approximation,
    which is appropriate since every drug group in v3 has n > 700).
    """
    n = int(len(values))
    if n == 0:
        return {"n": 0}
    mean = float(values.mean())
    std = float(values.std()) if n > 1 else 0.0
    sem = std / math.sqrt(n) if n > 0 else 0.0
    ci_half = 1.96 * sem
    return {
        "n": n,
        "mean": round(mean, 4),
        "std": round(std, 4),
        "median": round(float(values.median()), 4),
        "sem": round(sem, 5),
        "ci95_low": round(mean - ci_half, 4),
        "ci95_high": round(mean + ci_half, 4),
    }


def _welch_compare(a: pd.Series, b: pd.Series) -> Dict[str, Any]:
    """Welch's t-test + Cohen's d for two unequal-variance samples.

    Returns p-value, t-statistic, Cohen's d (pooled-std variant), and a plain
    English verdict in {"clearly different", "likely different",
    "indistinguishable"}. Verdict combines p < 0.01 AND |d| > 0.2 (small
    effect) so that *trivial* differences over huge n don't get flagged as
    interesting.
    """
    a = a.dropna().to_numpy()
    b = b.dropna().to_numpy()
    if len(a) < 2 or len(b) < 2:
        return {"verdict": "insufficient_data"}
    t_stat, p = _scipy_stats.ttest_ind(a, b, equal_var=False)
    pooled_std = math.sqrt(((a.std(ddof=1) ** 2) + (b.std(ddof=1) ** 2)) / 2.0)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0.0
    abs_d = abs(cohens_d)
    if p < 0.01 and abs_d > 0.5:
        verdict = "clearly_different"
    elif p < 0.05 and abs_d > 0.2:
        verdict = "likely_different"
    elif p > 0.05 or abs_d < 0.1:
        verdict = "indistinguishable"
    else:
        verdict = "borderline"
    return {
        "p_value": float(p),
        "t_stat": round(float(t_stat), 3),
        "cohens_d": round(float(cohens_d), 3),
        "effect_size": _effect_label(abs_d),
        "verdict": verdict,
    }


def _effect_label(abs_d: float) -> str:
    """Cohen's conventional thresholds."""
    if abs_d < 0.2:
        return "negligible"
    if abs_d < 0.5:
        return "small"
    if abs_d < 0.8:
        return "medium"
    return "large"


def _drug_indices(drug: str) -> Tuple[str, List[int]]:
    """Return (display_name, dataframe indices) for one drug.

    Always merges Control + DMSO into a single 'DMSO (control)' group.

    The returned display name uses the *dataset's* stored casing (not the
    caller's input casing) so that subsequent dict lookups against names
    iterated from `sample_metadata['drug'].unique()` always match. Without
    this, calling `_drug_indices('Rotenone')` against a dataset that stores
    `'rotenone'` would silently produce a key that mismatches later use.
    """
    if sample_metadata is None:
        return drug, []
    if drug.upper() in ["DMSO", "CONTROL"]:
        sel = sample_metadata[sample_metadata["drug"].str.upper().isin(["DMSO", "CONTROL"])]
        return "DMSO (control)", sel.index.tolist()
    resolved = normalize_drug_slug(drug)
    sel = sample_metadata[sample_metadata["drug"].str.lower() == resolved.lower()]
    indices = sel.index.tolist()
    if indices:
        # Use the dataset's canonical name for this drug (first matching row).
        canonical = sample_metadata.loc[indices[0], "drug"]
        return canonical, indices
    return drug, indices


def compute_drug_comparison(drugs: List[str]) -> Dict[str, Any]:
    """Compare two (or more) drugs across the key features.

    For the *two-drug* case (the common one) we also include statistical
    inference: Welch's t-test p-value, Cohen's d, and a plain-English verdict
    per feature. This lets the LLM say "fragment length is clearly different
    (d=1.6, p<0.001)" instead of just listing two means.
    """
    if feature_table is None or sample_metadata is None:
        return {"error": "Data not loaded"}

    per_drug: Dict[str, Dict[str, Any]] = {}
    for d in drugs:
        name, idx = _drug_indices(d)
        if not idx:
            per_drug[d] = {"error": f"No samples found for '{d}'"}
            continue
        per_drug[name] = {"count": len(idx), "features": {}, "indices": idx}

    valid_names = [n for n, v in per_drug.items() if "indices" in v]

    pairwise: Dict[str, Dict[str, Dict[str, Any]]] = {}
    if len(valid_names) == 2:
        a_name, b_name = valid_names
        pairwise[f"{a_name} vs {b_name}"] = {}

    for feature in KEY_FEATURES:
        if feature not in feature_table.columns:
            continue
        for name in valid_names:
            vals = feature_table.loc[per_drug[name]["indices"], feature].dropna()
            if len(vals) > 0:
                per_drug[name]["features"][feature] = _summary(vals)
        # Pairwise inference for the 2-drug case
        if len(valid_names) == 2:
            a_name, b_name = valid_names
            a_vals = feature_table.loc[per_drug[a_name]["indices"], feature].dropna()
            b_vals = feature_table.loc[per_drug[b_name]["indices"], feature].dropna()
            if len(a_vals) >= 2 and len(b_vals) >= 2:
                pairwise[f"{a_name} vs {b_name}"][feature] = _welch_compare(a_vals, b_vals)

    # Drop internal indices before returning
    for v in per_drug.values():
        v.pop("indices", None)

    result: Dict[str, Any] = dict(per_drug)
    if pairwise:
        result["_inference"] = pairwise
    return result


def compute_correlation(feature1: str, feature2: str) -> Dict[str, Any]:
    """Pearson correlation with a 95% confidence interval via Fisher z-transform.

    We also include Spearman ρ for monotonic but non-linear relationships, and
    a p-value, so the LLM can comment meaningfully on "is this real?".
    """
    if feature_table is None:
        return {"error": "Data not loaded"}

    if feature1 not in feature_table.columns or feature2 not in feature_table.columns:
        return {"error": f"Features not found: {feature1}, {feature2}"}

    vals1 = feature_table[feature1]
    vals2 = feature_table[feature2]
    valid_mask = (~vals1.isna()) & (~vals2.isna())
    v1 = vals1[valid_mask].to_numpy()
    v2 = vals2[valid_mask].to_numpy()
    n = len(v1)

    if n < 3:
        return {"error": "Insufficient data for correlation"}

    pearson_r, pearson_p = _scipy_stats.pearsonr(v1, v2)
    spearman_r, spearman_p = _scipy_stats.spearmanr(v1, v2)

    # Fisher z-transform CI for Pearson r.
    if abs(pearson_r) < 1.0:
        z = 0.5 * math.log((1 + pearson_r) / (1 - pearson_r))
        se = 1.0 / math.sqrt(n - 3)
        z_lo, z_hi = z - 1.96 * se, z + 1.96 * se
        r_lo = (math.exp(2 * z_lo) - 1) / (math.exp(2 * z_lo) + 1)
        r_hi = (math.exp(2 * z_hi) - 1) / (math.exp(2 * z_hi) + 1)
    else:
        r_lo = r_hi = float(pearson_r)

    return {
        "feature1": feature1,
        "feature2": feature2,
        "correlation": round(float(pearson_r), 4),
        "ci95_low": round(float(r_lo), 4),
        "ci95_high": round(float(r_hi), 4),
        "p_value": float(pearson_p),
        "spearman": round(float(spearman_r), 4),
        "spearman_p": float(spearman_p),
        "n_samples": n,
        "interpretation": _interpret_correlation(pearson_r),
    }


def compute_ranking(feature: str, direction: str = "high", top_n: int = 10) -> Dict[str, Any]:
    """Rank drugs by mean feature value, with 95% CIs and Cohen's d vs DMSO.

    Two key additions over the previous version:
      1. Each entry includes the 95% CI of the mean and SEM, so adjacent ranks
         whose CIs overlap can be flagged as statistically indistinguishable.
      2. Each entry includes Cohen's d vs DMSO (control) so the LLM can call
         out *biologically meaningful* effects, not just rank order.
    """
    if feature_table is None or sample_metadata is None:
        return {"error": "Data not loaded"}

    if feature not in feature_table.columns:
        return {"error": f"Feature not found: {feature}"}

    # Pre-fetch DMSO baseline values for effect-size calculation.
    _, ctrl_idx = _drug_indices("DMSO")
    ctrl_vals = (
        feature_table.loc[ctrl_idx, feature].dropna() if ctrl_idx else pd.Series(dtype=float)
    )

    rankings: List[Dict[str, Any]] = []
    seen: set = set()
    for drug in sample_metadata["drug"].unique():
        key = drug.upper()
        if key in seen:
            continue
        name, idx = _drug_indices(drug)
        seen.add(key)
        if name == "DMSO (control)":
            seen.update({"DMSO", "CONTROL"})
        values = feature_table.loc[idx, feature].dropna()
        if len(values) == 0:
            continue
        summary = _summary(values)
        entry = {"drug": name, **summary}
        if len(ctrl_vals) > 1 and name != "DMSO (control)":
            pooled = math.sqrt(((values.std(ddof=1) ** 2) + (ctrl_vals.std(ddof=1) ** 2)) / 2.0)
            d = (values.mean() - ctrl_vals.mean()) / pooled if pooled > 0 else 0.0
            entry["cohens_d_vs_dmso"] = round(float(d), 3)
            entry["effect_vs_dmso"] = _effect_label(abs(d))
        rankings.append(entry)

    rankings.sort(key=lambda x: x["mean"], reverse=(direction == "high"))
    top = rankings[:top_n]

    # Flag adjacent ranks whose 95% CIs overlap (statistically indistinguishable).
    for i, r in enumerate(top):
        if i == 0:
            continue
        prev = top[i - 1]
        # CIs overlap iff one's high >= the other's low (and vice versa).
        if (
            r.get("ci95_high") is not None
            and prev.get("ci95_low") is not None
            and r["ci95_high"] >= prev["ci95_low"]
            and r["ci95_low"] <= prev["ci95_high"]
        ):
            r["indistinguishable_from_prev"] = True

    return {
        "feature": feature,
        "direction": direction,
        "rankings": top,
        "n_drugs_total": len(rankings),
    }


def compute_drug_similarity(target_drug: str, top_n: int = 5) -> Dict[str, Any]:
    """Find drugs whose mean phenotype across KEY_FEATURES is closest to
    `target_drug`. Distance is Euclidean in z-scored feature space, so each
    feature contributes equally regardless of its raw scale.

    Returns a ranked list of (drug, distance, distinctive_features). The
    "distinctive_features" list flags which features drove the similarity (or
    lack of it) — i.e. which axes the two drugs agree / disagree on most.
    """
    if feature_table is None or sample_metadata is None:
        return {"error": "Data not loaded"}
    target_name, target_idx = _drug_indices(target_drug)
    if not target_idx:
        return {"error": f"No samples found for drug '{target_drug}'"}

    feats = [f for f in KEY_FEATURES if f in feature_table.columns]
    if not feats:
        return {"error": "No key features available"}

    # Compute per-drug mean vector over feats, then z-score each feature.
    drug_means: Dict[str, np.ndarray] = {}
    seen: set = set()
    for drug in sample_metadata["drug"].unique():
        if drug.upper() in seen:
            continue
        name, idx = _drug_indices(drug)
        seen.add(drug.upper())
        if name == "DMSO (control)":
            seen.update({"DMSO", "CONTROL"})
        vec = []
        for f in feats:
            vals = feature_table.loc[idx, f].dropna()
            vec.append(float(vals.mean()) if len(vals) else np.nan)
        drug_means[name] = np.asarray(vec, dtype=float)

    if target_name not in drug_means:
        return {"error": f"Could not compute profile for '{target_drug}'"}

    M = np.asarray(list(drug_means.values()))
    names = list(drug_means.keys())
    mu = np.nanmean(M, axis=0)
    sigma = np.nanstd(M, axis=0)
    sigma[sigma == 0] = 1.0
    Z = (M - mu) / sigma
    target_z = Z[names.index(target_name)]

    # Euclidean distance with NaN-safe sum.
    distances = []
    for i, n in enumerate(names):
        if n == target_name:
            continue
        diff = Z[i] - target_z
        mask = ~np.isnan(diff)
        if mask.sum() == 0:
            continue
        d = float(np.linalg.norm(diff[mask]))
        # Rank features by |z-diff| and split into similar / different halves so
        # we never name the same feature in both lists for sparse comparisons.
        feat_diffs = [(f, v) for f, v in zip(feats, np.abs(diff)) if not math.isnan(v)]
        feat_diffs.sort(key=lambda x: x[1])
        # Up to 3 most similar / 3 most different, ensuring no overlap.
        k = min(3, len(feat_diffs))
        most_similar = feat_diffs[:k]
        # "Most different" comes from the *opposite end* of the same sorted list.
        most_different = list(reversed(feat_diffs[-k:]))
        sim_names = {f for f, _ in most_similar}
        most_different = [(f, v) for f, v in most_different if f not in sim_names]
        distances.append(
            {
                "drug": n,
                "distance": round(d, 3),
                "most_similar_on": [f for f, _ in most_similar],
                "most_different_on": [f for f, _ in most_different],
            }
        )

    distances.sort(key=lambda x: x["distance"])
    return {
        "target_drug": target_name,
        "metric": "Euclidean distance in z-scored mean-phenotype space",
        "features_used": feats,
        "neighbors": distances[:top_n],
        "n_drugs_compared": len(distances),
    }


def compute_top_differentiators(drug_a: str, drug_b: str, top_n: int = 5) -> Dict[str, Any]:
    """Rank features by how strongly they differ between two drugs.

    Sorted by |Cohen's d|, so the answer highlights *biologically* large
    differences (not just statistically significant ones, which over n>1000
    are common). Useful for "what's different between X and Y?".
    """
    if feature_table is None or sample_metadata is None:
        return {"error": "Data not loaded"}
    a_name, a_idx = _drug_indices(drug_a)
    b_name, b_idx = _drug_indices(drug_b)
    if not a_idx:
        return {"error": f"No samples for '{drug_a}'"}
    if not b_idx:
        return {"error": f"No samples for '{drug_b}'"}

    feats = [f for f in KEY_FEATURES if f in feature_table.columns]
    rows = []
    for f in feats:
        a_vals = feature_table.loc[a_idx, f].dropna()
        b_vals = feature_table.loc[b_idx, f].dropna()
        if len(a_vals) < 2 or len(b_vals) < 2:
            continue
        cmp = _welch_compare(a_vals, b_vals)
        rows.append(
            {
                "feature": f,
                f"{a_name}_mean": round(float(a_vals.mean()), 4),
                f"{b_name}_mean": round(float(b_vals.mean()), 4),
                "cohens_d": cmp.get("cohens_d"),
                "effect_size": cmp.get("effect_size"),
                "p_value": cmp.get("p_value"),
                "verdict": cmp.get("verdict"),
            }
        )
    rows.sort(key=lambda r: -abs(r.get("cohens_d") or 0))
    return {
        "drug_a": a_name,
        "drug_b": b_name,
        "top_differentiators": rows[:top_n],
        "n_features_compared": len(rows),
    }


def compute_feature_stats(feature: str, drug: Optional[str] = None) -> Dict[str, Any]:
    """Get summary statistics for a feature (Control and DMSO are merged)."""
    if feature_table is None:
        return {'error': 'Data not loaded'}

    if feature not in feature_table.columns:
        return {'error': f'Feature not found: {feature}'}

    if drug and sample_metadata is not None:
        if drug.upper() in ['CONTROL', 'DMSO']:
            drug_samples = sample_metadata[
                sample_metadata['drug'].str.upper().isin(['DMSO', 'CONTROL'])
            ]
            scope = "for DMSO (control)"
        else:
            drug_samples = sample_metadata[sample_metadata['drug'] == drug]
            scope = f"for {drug}"
        indices = drug_samples.index.tolist()
        values = feature_table.loc[indices, feature].dropna()
    else:
        values = feature_table[feature].dropna()
        scope = "across all samples"

    if len(values) == 0:
        return {'error': 'No valid data'}

    return {
        'feature': feature,
        'scope': scope,
        'n': len(values),
        'mean': round(float(values.mean()), 4),
        'std': round(float(values.std()), 4),
        'median': round(float(values.median()), 4),
        'min': round(float(values.min()), 4),
        'max': round(float(values.max()), 4),
        'q25': round(float(values.quantile(0.25)), 4),
        'q75': round(float(values.quantile(0.75)), 4),
    }


def get_feature_description(feature: str) -> Dict[str, Any]:
    """Get description of what a feature measures."""
    descriptions = {
        'Fragment Length': 'Fragment length measures the average length of individual mitochondrial fragments. Higher values indicate more elongated/tubular mitochondria, while lower values indicate fragmentation.',
        'Segment Length': 'Segment length measures the length of continuous mitochondrial segments in the network. Reflects mitochondrial morphology and connectivity.',
        'Optical Flow (fg)': 'Motility (measured as Optical Flow) quantifies mitochondrial movement and dynamics. Higher values indicate more dynamic, mobile mitochondria.',
        'TMRM Intensity': 'Membrane potential (measured as TMRM Intensity) reflects mitochondrial health and function. Higher values indicate healthier, more polarized mitochondria.',
        'Fusion Rate': 'Rate of mitochondrial fusion events. Fusion is important for maintaining mitochondrial health and exchanging contents between mitochondria.',
        'Fission Rate': 'Rate of mitochondrial fission (division) events. Fission is necessary for quality control and distribution of mitochondria.',
        'Node Count': 'Total number of nodes in the mitochondrial network graph. Reflects the overall complexity of the network.',
        'Clustering Coefficient': 'Measures how interconnected the mitochondrial network is. Higher values indicate more reticulated, mesh-like structures.',
        'Fragment Diameter': 'Average diameter/width of mitochondrial fragments. Reflects the thickness of mitochondrial tubules.',
        'Graph Density': 'Density of connections in the mitochondrial network graph. Higher values indicate more densely connected networks.',
        'Node Diffusivity': 'Measures how quickly mitochondrial network nodes move/diffuse. Reflects the dynamic behavior of network junctions.',
    }

    return {
        'feature': feature,
        'description': descriptions.get(feature, f'{feature} is a quantitative measurement of mitochondrial morphology or dynamics.')
    }


def _interpret_correlation(corr: float) -> str:
    """Interpret correlation coefficient strength."""
    abs_corr = abs(corr)
    direction = "positive" if corr > 0 else "negative"
    if abs_corr < 0.1:
        return f"negligible {direction}"
    elif abs_corr < 0.3:
        return f"weak {direction}"
    elif abs_corr < 0.5:
        return f"moderate {direction}"
    elif abs_corr < 0.7:
        return f"moderately strong {direction}"
    else:
        return f"strong {direction}"


def compute_clarification(prior_user_message: Optional[str]) -> Dict[str, Any]:
    """Re-derive the stats envelope from the user's PREVIOUS turn so the LLM
    has something concrete to defend or explain.

    Approach: classify the prior user message, then route to its compute_* path.
    This is deterministic (same prior question → same stats) and means we never
    need the frontend to round-trip the prior answer's `data` back to us.

    If we can't reconstruct the prior question, we return a benign envelope so
    the LLM can still give a generic-but-honest answer ("I compute every value
    deterministically from the loaded dataset — name the specific number…").
    """
    if not prior_user_message:
        return {"prior_recoverable": False}

    info = classify_query(prior_user_message)
    prior_type = info.get("type")
    if not prior_type or prior_type in {
        "greeting", "thanks", "help", "unsupported", "clarification"
    }:
        return {"prior_recoverable": False, "prior_query_type": prior_type}

    prior_stats = compute_statistics(prior_type, info.get("params") or {})
    return {
        "prior_recoverable": True,
        "prior_query_type": prior_type,
        "prior_question": prior_user_message,
        "prior_stats": prior_stats,
    }


def compute_statistics(query_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Route to the appropriate statistics computation."""
    if query_type == "drug_comparison":
        return compute_drug_comparison(params["drugs"])
    if query_type == "correlation":
        return compute_correlation(params["features"][0], params["features"][1])
    if query_type == "ranking":
        return compute_ranking(
            params["feature"], params.get("direction", "high"), params.get("top_n", 10)
        )
    if query_type == "feature_stats":
        return compute_feature_stats(params["feature"], params.get("drug"))
    if query_type == "feature_description":
        return get_feature_description(params["feature"])
    if query_type == "dataset_overview":
        return compute_dataset_overview()
    if query_type == "drug_similarity":
        return compute_drug_similarity(params["drug"], params.get("top_n", 5))
    if query_type == "top_differentiators":
        return compute_top_differentiators(
            params["drug_a"], params["drug_b"], params.get("top_n", 5)
        )
    if query_type == "clarification":
        return compute_clarification(params.get("prior_user_message"))
    return {"error": "Unsupported query type"}
