/**
 * Shareable view-state (deep linking).
 *
 * Encodes what's currently applied to the atlas into URL query params so a
 * scientist can send a colleague the exact view — same colouring, filters,
 * focused cell and comparison set. This is a core reproducibility/collaboration
 * affordance for a research tool.
 */

export interface ShareableView {
  /** Feature apiName when colouring by feature (mutually exclusive with mode). */
  feature?: string | null;
  /** 'phenotype' when colouring by phenotype. */
  mode?: 'phenotype' | null;
  /** Active drug-condition filters. */
  drugs?: string[];
  /** Focused cell id. */
  sel?: string | null;
  /** Pinned comparison cell ids. */
  cmp?: string[];
}

export function encodeView(v: ShareableView): string {
  const p = new URLSearchParams();
  if (v.feature) p.set('color', v.feature);
  else if (v.mode === 'phenotype') p.set('mode', 'phenotype');
  (v.drugs ?? []).forEach((d) => p.append('drug', d));
  if (v.sel) p.set('sel', v.sel);
  (v.cmp ?? []).forEach((id) => p.append('cmp', id));
  return p.toString();
}

export function parseView(search: string): ShareableView {
  const p = new URLSearchParams(search);
  return {
    feature: p.get('color'),
    mode: p.get('mode') === 'phenotype' ? 'phenotype' : null,
    drugs: p.getAll('drug'),
    sel: p.get('sel'),
    cmp: p.getAll('cmp'),
  };
}

/** True when the parsed view carries any state worth restoring. */
export function hasViewState(v: ShareableView): boolean {
  return Boolean(
    v.feature ||
      v.mode ||
      (v.drugs && v.drugs.length) ||
      v.sel ||
      (v.cmp && v.cmp.length),
  );
}

export function buildShareUrl(v: ShareableView): string {
  const qs = encodeView(v);
  const { origin, pathname } = window.location;
  return qs ? `${origin}${pathname}?${qs}` : `${origin}${pathname}`;
}
