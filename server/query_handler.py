"""
Query handler for chat system - classify queries and compute statistics
"""
import re
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd


# Global data (loaded at startup)
feature_table: Optional[pd.DataFrame] = None
sample_metadata: Optional[pd.DataFrame] = None

# Feature name mapping (user-friendly → CSV column name)
FEATURE_ALIASES = {
    'fragment length': 'Fragment Length',
    'fragmentation': 'Fragment Length',
    'segment length': 'Segment Length',
    'length': 'Segment Length',
    'motility': 'Optical Flow (fg)',
    'movement': 'Optical Flow (fg)',
    'optical flow': 'Optical Flow (fg)',
    'membrane potential': 'TMRM Intensity',
    'tmrm': 'TMRM Intensity',
    'potential': 'TMRM Intensity',
    'diameter': 'Fragment Diameter',
    'fusion': 'Fusion Rate',
    'fission': 'Fission Rate',
    'clustering': 'Clustering Coefficient',
    'density': 'Graph Density',
    'diffusivity': 'Node Diffusivity',
}

# Drug aliases (Control and DMSO are the same)
DRUG_ALIASES = {
    'control': 'DMSO',
    'ctrl': 'DMSO',
}

# All numeric features
NUMERIC_FEATURES = [
    'Node Count', 'Degree', 'Segment Length', 'Fragment Length', 'Fragment Diameter',
    'Graph Density', 'Graph Efficiency', 'Clustering Coefficient',
    'Node Diffusivity', 'Segment Diffusivity', 'Fragment Diffusivity',
    'Node Diffusivity Std', 'Segment Diffusivity Std', 'Fragment Diffusivity Std',
    'Fusion Rate', 'Fission Rate', 'TMRM Intensity', 'Optical Flow (fg)'
]


def load_data(feature_csv_path: str, metadata_json_path: Optional[str] = None):
    """Load complete dataset into memory"""
    global feature_table, sample_metadata
    
    # Load feature table
    feature_table = pd.read_csv(feature_csv_path)
    print(f"[QueryHandler] Loaded feature table: {len(feature_table)} samples, {len(feature_table.columns)} features")
    
    # If metadata JSON provided, load it (contains drug/phenotype info)
    if metadata_json_path:
        import json
        with open(metadata_json_path, 'r') as f:
            data = json.load(f)
            if 'points' in data:
                # Extract relevant metadata
                metadata_records = []
                for point in data['points']:
                    metadata_records.append({
                        'id': point['id'],
                        'drug': point['treatment']['drug'],
                        'dose': point['treatment']['dose'],
                        'time': point['treatment']['time'],
                        'phenotype': point['phenotype']
                    })
                sample_metadata = pd.DataFrame(metadata_records)
                print(f"[QueryHandler] Loaded sample metadata: {len(sample_metadata)} samples")


def extract_feature_name(text: str) -> Optional[str]:
    """Extract feature name from user query"""
    text_lower = text.lower()
    
    # Check aliases
    for alias, feature in FEATURE_ALIASES.items():
        if alias in text_lower:
            return feature
    
    # Check direct feature names
    for feature in NUMERIC_FEATURES:
        if feature.lower() in text_lower:
            return feature
    
    return None


def extract_drug_names(text: str) -> List[str]:
    """Extract drug names from user query (normalizes Control → DMSO)"""
    if sample_metadata is None:
        return []
    
    drugs = []
    text_lower = text.lower()
    
    # Check for aliases first (e.g., "control" → "DMSO")
    for alias, canonical_name in DRUG_ALIASES.items():
        if alias in text_lower:
            if canonical_name not in drugs:
                drugs.append(canonical_name)
    
    # Get unique drugs from metadata
    unique_drugs = sample_metadata['drug'].unique() if sample_metadata is not None else []
    
    for drug in unique_drugs:
        if drug.lower() in text_lower and drug not in drugs:
            drugs.append(drug)
    
    return drugs


def classify_query(message: str) -> Dict[str, Any]:
    """
    Classify user query into supported types
    
    Returns:
        {
            'type': str,  # drug_comparison, correlation, ranking, feature_stats, unsupported
            'params': dict  # Extracted parameters
        }
    """
    msg_lower = message.lower()
    
    # Drug comparison
    if any(word in msg_lower for word in ['compare', 'difference', 'versus', 'vs']):
        drugs = extract_drug_names(message)
        if len(drugs) >= 2:
            return {'type': 'drug_comparison', 'params': {'drugs': drugs[:5]}}  # Max 5 drugs
        elif len(drugs) == 1:
            # Compare to control (DMSO)
            return {'type': 'drug_comparison', 'params': {'drugs': [drugs[0], 'DMSO']}}
    
    # Feature correlation
    if 'correlat' in msg_lower:
        # Try to extract two features
        features = []
        for feat in NUMERIC_FEATURES:
            if feat.lower() in msg_lower:
                features.append(feat)
        # Also check aliases
        for alias, feat in FEATURE_ALIASES.items():
            if alias in msg_lower and feat not in features:
                features.append(feat)
        
        if len(features) >= 2:
            return {'type': 'correlation', 'params': {'features': features[:2]}}
    
    # Ranking queries
    ranking_words_high = ['highest', 'most', 'increase', 'largest', 'maximum', 'top']
    ranking_words_low = ['lowest', 'least', 'decrease', 'smallest', 'minimum', 'bottom']
    
    is_ranking_high = any(word in msg_lower for word in ranking_words_high)
    is_ranking_low = any(word in msg_lower for word in ranking_words_low)
    
    if is_ranking_high or is_ranking_low:
        feature = extract_feature_name(message)
        if feature:
            direction = 'high' if is_ranking_high else 'low'
            return {'type': 'ranking', 'params': {'feature': feature, 'direction': direction}}
    
    # Summary statistics
    if any(word in msg_lower for word in ['mean', 'average', 'median', 'summary', 'statistics', 'stats']):
        feature = extract_feature_name(message)
        drug = extract_drug_names(message)
        if feature:
            params = {'feature': feature}
            if drug:
                params['drug'] = drug[0]
            return {'type': 'feature_stats', 'params': params}
    
    # Simple feature query (e.g., "what is fragment length?")
    if any(word in msg_lower for word in ['what is', 'tell me about', 'explain']):
        feature = extract_feature_name(message)
        if feature:
            return {'type': 'feature_description', 'params': {'feature': feature}}
    
    return {'type': 'unsupported', 'params': {}}


def _normalize_drug_name(drug: str) -> str:
    """Normalize drug name - convert DMSO/Control to the canonical name that exists in dataset"""
    if sample_metadata is None:
        return drug
    
    available_drugs = set(sample_metadata['drug'].unique())
    
    # If asking for DMSO or Control, find which one (or both) exists
    if drug in ['DMSO', 'Control']:
        has_dmso = 'DMSO' in available_drugs
        has_control = 'Control' in available_drugs
        
        # Return whichever exists, preferring DMSO for display
        if has_dmso:
            return 'DMSO'
        elif has_control:
            return 'Control'  # Will be displayed as "DMSO (control)" in results
        else:
            return drug  # Neither exists, will error later
    
    return drug


def compute_drug_comparison(drugs: List[str]) -> Dict[str, Any]:
    """Compare mean feature values between drugs (Control and DMSO are merged)"""
    if feature_table is None or sample_metadata is None:
        return {'error': 'Data not loaded'}
    
    results = {}
    available_drugs = list(sample_metadata['drug'].unique())
    
    # Debug: print available drugs
    print(f"[DEBUG] Available drugs in dataset: {available_drugs}")
    print(f"[DEBUG] Requested drugs: {drugs}")
    
    for drug in drugs:
        # Normalize drug name (DMSO/Control handled together)
        display_name = drug
        
        # Find samples for this drug (merge Control and DMSO)
        # Case-insensitive check for DMSO/Control
        if drug.upper() in ['DMSO', 'CONTROL']:
            # Include both DMSO and Control samples (whichever exist, case-insensitive)
            drug_samples = sample_metadata[
                sample_metadata['drug'].str.upper().isin(['DMSO', 'CONTROL'])
            ]
            display_name = 'DMSO (control)'  # Clear display name
            print(f"[DEBUG] Looking for DMSO/Control, found {len(drug_samples)} samples")
        else:
            drug_samples = sample_metadata[sample_metadata['drug'] == drug]
            print(f"[DEBUG] Looking for {drug}, found {len(drug_samples)} samples")
        
        if len(drug_samples) == 0:
            results[display_name] = {'error': 'No samples found'}
            continue
        
        # Get indices (assuming feature_table rows align with metadata)
        indices = drug_samples.index.tolist()
        
        results[display_name] = {
            'count': len(indices),
            'features': {}
        }
        
        # Compute stats for key features
        key_features = ['Fragment Length', 'Segment Length', 'TMRM Intensity', 'Optical Flow (fg)']
        for feature in key_features:
            if feature in feature_table.columns:
                values = feature_table.loc[indices, feature].dropna()
                if len(values) > 0:
                    results[display_name]['features'][feature] = {
                        'mean': float(values.mean()),
                        'std': float(values.std()),
                        'median': float(values.median()),
                        'n': len(values)
                    }
    
    return results


def compute_correlation(feature1: str, feature2: str) -> Dict[str, Any]:
    """Compute Pearson correlation between two features"""
    if feature_table is None:
        return {'error': 'Data not loaded'}
    
    if feature1 not in feature_table.columns or feature2 not in feature_table.columns:
        return {'error': f'Features not found: {feature1}, {feature2}'}
    
    # Get values and find common valid indices
    vals1 = feature_table[feature1]
    vals2 = feature_table[feature2]
    
    # Remove NaNs
    valid_mask = (~vals1.isna()) & (~vals2.isna())
    vals1_clean = vals1[valid_mask]
    vals2_clean = vals2[valid_mask]
    
    if len(vals1_clean) < 2:
        return {'error': 'Insufficient data for correlation'}
    
    # Compute correlation
    corr = float(np.corrcoef(vals1_clean, vals2_clean)[0, 1])
    
    return {
        'feature1': feature1,
        'feature2': feature2,
        'correlation': corr,
        'n_samples': len(vals1_clean),
        'interpretation': _interpret_correlation(corr)
    }


def compute_ranking(feature: str, direction: str = 'high', top_n: int = 10) -> Dict[str, Any]:
    """Rank drugs by mean feature value (Control and DMSO are merged)"""
    if feature_table is None or sample_metadata is None:
        return {'error': 'Data not loaded'}
    
    if feature not in feature_table.columns:
        return {'error': f'Feature not found: {feature}'}
    
    rankings = []
    processed_drugs = set()
    
    for drug in sample_metadata['drug'].unique():
        # Skip if we've already processed this drug
        if drug.upper() in processed_drugs:
            continue
        
        # Merge Control and DMSO (case-insensitive)
        if drug.upper() in ['CONTROL', 'DMSO']:
            if 'DMSO' in processed_drugs or 'CONTROL' in processed_drugs:
                continue  # Already processed the merged group
            
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
                'mean': float(values.mean()),
                'std': float(values.std()),
                'count': len(values)
            })
    
    # Sort
    rankings.sort(key=lambda x: x['mean'], reverse=(direction == 'high'))
    
    return {
        'feature': feature,
        'direction': direction,
        'rankings': rankings[:top_n]
    }


def compute_feature_stats(feature: str, drug: Optional[str] = None) -> Dict[str, Any]:
    """Get summary statistics for a feature (Control and DMSO are merged)"""
    if feature_table is None:
        return {'error': 'Data not loaded'}
    
    if feature not in feature_table.columns:
        return {'error': f'Feature not found: {feature}'}
    
    # Filter by drug if specified
    if drug and sample_metadata is not None:
        # Merge Control and DMSO (case-insensitive)
        if drug.upper() in ['CONTROL', 'DMSO']:
            drug_samples = sample_metadata[
                sample_metadata['drug'].str.upper().isin(['DMSO', 'CONTROL'])
            ]
            scope = f"for DMSO (control)"
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
        'mean': float(values.mean()),
        'std': float(values.std()),
        'median': float(values.median()),
        'min': float(values.min()),
        'max': float(values.max()),
        'q25': float(values.quantile(0.25)),
        'q75': float(values.quantile(0.75))
    }


def get_feature_description(feature: str) -> Dict[str, Any]:
    """Get description of what a feature measures"""
    descriptions = {
        'Fragment Length': 'Measures the average length of individual mitochondrial fragments. Higher values indicate more elongated/tubular mitochondria, while lower values indicate fragmentation.',
        'Segment Length': 'Measures the length of continuous mitochondrial segments in the network. Reflects mitochondrial morphology and connectivity.',
        'Optical Flow (fg)': 'Quantifies mitochondrial movement and motility. Higher values indicate more dynamic, mobile mitochondria.',
        'TMRM Intensity': 'Measures mitochondrial membrane potential. Higher values indicate healthier, more polarized mitochondria with better function.',
        'Fusion Rate': 'Rate of mitochondrial fusion events. Fusion is important for maintaining mitochondrial health and exchanging contents.',
        'Fission Rate': 'Rate of mitochondrial fission (division) events. Fission is necessary for quality control and distribution.',
        'Node Count': 'Total number of nodes in the mitochondrial network graph. Reflects network complexity.',
        'Clustering Coefficient': 'Measures how interconnected the mitochondrial network is. Higher values indicate more reticulated structures.',
    }
    
    return {
        'feature': feature,
        'description': descriptions.get(feature, f'{feature} is a mitochondrial morphology or dynamics measurement.')
    }


def _interpret_correlation(corr: float) -> str:
    """Interpret correlation coefficient strength"""
    abs_corr = abs(corr)
    if abs_corr < 0.3:
        return "weak"
    elif abs_corr < 0.7:
        return "moderate"
    else:
        return "strong"


def compute_statistics(query_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Route to appropriate statistics computation"""
    if query_type == 'drug_comparison':
        return compute_drug_comparison(params['drugs'])
    elif query_type == 'correlation':
        return compute_correlation(params['features'][0], params['features'][1])
    elif query_type == 'ranking':
        return compute_ranking(params['feature'], params.get('direction', 'high'))
    elif query_type == 'feature_stats':
        return compute_feature_stats(params['feature'], params.get('drug'))
    elif query_type == 'feature_description':
        return get_feature_description(params['feature'])
    else:
        return {'error': 'Unsupported query type'}
