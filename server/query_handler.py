"""
Query handler for chat system - classify queries and compute statistics.

Designed for natural conversational flow:
- Rich alias mapping for features and drugs
- Context-aware follow-up handling
- Graceful handling of greetings, thanks, help requests
- Dataset overview for vague questions
"""
import re
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd


# Global data (loaded at startup)
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

# Drug aliases (Control and DMSO are the same)
DRUG_ALIASES = {
    'control': 'DMSO',
    'ctrl': 'DMSO',
    'vehicle': 'DMSO',
    'untreated': 'DMSO',
    'baseline': 'DMSO',
}

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


def load_data(feature_path: str, metadata_json_path: Optional[str] = None):
    """
    Load the chat dataset into memory.

    Accepts either:
      - a .csv  (legacy v1 mitotnt_features.csv layout)
      - a .parquet (v3 features_v3.parquet layout, with snake_case columns)

    For v3 we also derive `TMRM Intensity` (last timepoint of `tmrm_intensities`)
    and surface a small set of v1-friendly column aliases so the existing
    NUMERIC_FEATURES / KEY_FEATURES list keeps working without per-column rewrites.
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
    print(f"[QueryHandler] Loaded feature table: {len(feature_table)} samples, {len(feature_table.columns)} features ({path})")

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
                print(f"[QueryHandler] Loaded sample metadata: {len(sample_metadata)} samples")
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
        print(f"[QueryHandler] Derived metadata from parquet labels: {len(sample_metadata)} samples")


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

    print(f"[classify] msg='{msg_lower}' | drugs={current_drugs} | feat={current_feature} | ctx_feat={last_feature} | ctx_type={last_query_type}")

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

    # ── 0b. Dataset overview questions ──
    overview_patterns = [
        'what features', 'which features', 'available features', 'list features',
        'what data', 'about the data', 'about this data', 'dataset overview',
        'tell me about the dataset', 'what drugs', 'which drugs are',
        'how many samples', 'how many drugs', 'how many features',
        'what is available', 'what can i ask', 'what do you know',
        'overview', 'summarize the data', 'summary of the data',
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
    ranking_words_high = ['highest', 'most', 'increase', 'largest', 'maximum', 'top',
                          'which drugs', 'what drugs', 'best', 'strongest', 'greatest']
    ranking_words_low = ['lowest', 'least', 'decrease', 'smallest', 'minimum', 'bottom',
                         'worst', 'weakest', 'reduce', 'lower', 'inhibit', 'diminish']

    is_ranking_high = any(word in msg_lower for word in ranking_words_high)
    is_ranking_low = any(word in msg_lower for word in ranking_words_low)

    if is_ranking_high or is_ranking_low:
        feature = current_feature or last_feature
        if feature:
            direction = 'high' if is_ranking_high else 'low'
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


def compute_drug_comparison(drugs: List[str]) -> Dict[str, Any]:
    """Compare mean feature values between drugs (Control and DMSO are merged)."""
    if feature_table is None or sample_metadata is None:
        return {'error': 'Data not loaded'}

    results = {}

    for drug in drugs:
        display_name = drug
        if drug.upper() in ['DMSO', 'CONTROL']:
            drug_samples = sample_metadata[
                sample_metadata['drug'].str.upper().isin(['DMSO', 'CONTROL'])
            ]
            display_name = 'DMSO (control)'
        else:
            drug_samples = sample_metadata[sample_metadata['drug'] == drug]

        if len(drug_samples) == 0:
            results[display_name] = {'error': 'No samples found'}
            continue

        indices = drug_samples.index.tolist()
        results[display_name] = {'count': len(indices), 'features': {}}

        for feature in KEY_FEATURES:
            if feature in feature_table.columns:
                values = feature_table.loc[indices, feature].dropna()
                if len(values) > 0:
                    results[display_name]['features'][feature] = {
                        'mean': round(float(values.mean()), 4),
                        'std': round(float(values.std()), 4),
                        'median': round(float(values.median()), 4),
                        'n': len(values)
                    }

    return results


def compute_correlation(feature1: str, feature2: str) -> Dict[str, Any]:
    """Compute Pearson correlation between two features."""
    if feature_table is None:
        return {'error': 'Data not loaded'}

    if feature1 not in feature_table.columns or feature2 not in feature_table.columns:
        return {'error': f'Features not found: {feature1}, {feature2}'}

    vals1 = feature_table[feature1]
    vals2 = feature_table[feature2]
    valid_mask = (~vals1.isna()) & (~vals2.isna())
    vals1_clean = vals1[valid_mask]
    vals2_clean = vals2[valid_mask]

    if len(vals1_clean) < 2:
        return {'error': 'Insufficient data for correlation'}

    corr = float(np.corrcoef(vals1_clean, vals2_clean)[0, 1])

    return {
        'feature1': feature1,
        'feature2': feature2,
        'correlation': round(corr, 4),
        'n_samples': len(vals1_clean),
        'interpretation': _interpret_correlation(corr)
    }


def compute_ranking(feature: str, direction: str = 'high', top_n: int = 10) -> Dict[str, Any]:
    """Rank drugs by mean feature value (Control and DMSO are merged)."""
    if feature_table is None or sample_metadata is None:
        return {'error': 'Data not loaded'}

    if feature not in feature_table.columns:
        return {'error': f'Feature not found: {feature}'}

    rankings = []
    processed_drugs = set()

    for drug in sample_metadata['drug'].unique():
        if drug.upper() in processed_drugs:
            continue

        if drug.upper() in ['CONTROL', 'DMSO']:
            if 'DMSO' in processed_drugs or 'CONTROL' in processed_drugs:
                continue
            drug_samples = sample_metadata[
                sample_metadata['drug'].str.upper().isin(['DMSO', 'CONTROL'])
            ]
            display_name = 'DMSO (control)'
            processed_drugs.add('DMSO')
            processed_drugs.add('CONTROL')
        else:
            drug_samples = sample_metadata[sample_metadata['drug'] == drug]
            display_name = drug
            processed_drugs.add(drug.upper())

        indices = drug_samples.index.tolist()
        values = feature_table.loc[indices, feature].dropna()

        if len(values) > 0:
            rankings.append({
                'drug': display_name,
                'mean': round(float(values.mean()), 4),
                'std': round(float(values.std()), 4),
                'count': len(values)
            })

    rankings.sort(key=lambda x: x['mean'], reverse=(direction == 'high'))

    return {
        'feature': feature,
        'direction': direction,
        'rankings': rankings[:top_n]
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


def compute_statistics(query_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Route to appropriate statistics computation."""
    if query_type == 'drug_comparison':
        return compute_drug_comparison(params['drugs'])
    elif query_type == 'correlation':
        return compute_correlation(params['features'][0], params['features'][1])
    elif query_type == 'ranking':
        return compute_ranking(
            params['feature'],
            params.get('direction', 'high'),
            params.get('top_n', 10)
        )
    elif query_type == 'feature_stats':
        return compute_feature_stats(params['feature'], params.get('drug'))
    elif query_type == 'feature_description':
        return get_feature_description(params['feature'])
    elif query_type == 'dataset_overview':
        return compute_dataset_overview()
    else:
        return {'error': 'Unsupported query type'}
