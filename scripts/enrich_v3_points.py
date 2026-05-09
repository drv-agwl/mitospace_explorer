"""
Enrich src/data/points4d_v3.json by carrying over SMILES + PubChem from
src/data/points4d.json (v1) keyed by treatment.drug.

Why: v3 dropped these fields, but the Sample Panel UI uses them. Drugs map 1:1
between v1 and v3, so we just look up by drug name and inject.

Output: overwrites src/data/points4d_v3.json with enriched records.

Run:
  python scripts/enrich_v3_points.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V1 = ROOT / "src" / "data" / "points4d.json"
V3 = ROOT / "public" / "data" / "points4d_v3.json"


def main() -> None:
    if not V1.exists():
        print(f"ERROR: v1 not found: {V1}", file=sys.stderr)
        sys.exit(1)
    if not V3.exists():
        print(f"ERROR: v3 not found: {V3}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading v1 from {V1.name}...")
    v1 = json.loads(V1.read_text())
    print(f"Loading v3 from {V3.name}...")
    v3 = json.loads(V3.read_text())

    # Build drug -> {smiles, pubchem} lookup from v1 (first occurrence wins)
    drug_to_meta: dict[str, dict[str, str]] = {}
    for p in v1.get("points", []):
        t = p.get("treatment", {}) or {}
        drug = t.get("drug")
        if not drug or drug in drug_to_meta:
            continue
        if t.get("smiles") or t.get("pubchem"):
            drug_to_meta[drug] = {
                "smiles": t.get("smiles", ""),
                "pubchem": t.get("pubchem", ""),
            }

    print(f"Built drug→SMILES/PubChem map for {len(drug_to_meta)} drugs:")
    for d, m in sorted(drug_to_meta.items()):
        print(f"  {d:>16}  smiles={m['smiles']!r:<30} pubchem={m['pubchem']!r}")

    # Enrich each v3 point in-place
    enriched = 0
    missing = set()
    for p in v3.get("points", []):
        t = p.setdefault("treatment", {})
        drug = t.get("drug")
        meta = drug_to_meta.get(drug)
        if meta:
            if meta["smiles"] and not t.get("smiles"):
                t["smiles"] = meta["smiles"]
            if meta["pubchem"] and not t.get("pubchem"):
                t["pubchem"] = meta["pubchem"]
            enriched += 1
        elif drug and drug not in missing:
            missing.add(drug)

    print(f"\nEnriched {enriched}/{len(v3['points'])} points")
    if missing:
        print(f"Drugs without SMILES/PubChem in v1: {sorted(missing)}")

    V3.write_text(json.dumps(v3))
    print(f"Wrote {V3}")


if __name__ == "__main__":
    main()
