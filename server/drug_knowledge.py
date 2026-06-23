"""
Drug knowledge base for MitoSpace Chat.

For each drug in the v3 dataset we provide a concise mechanism, primary target,
and pharmacological class. This is injected into the LLM context whenever the
user's question mentions one of these compounds, so the model can integrate
*biology* with the *statistics* — what scientists actually do when they talk
about an experiment.

Sources / verification notes
----------------------------
- Established mitochondrial pharmacology: Antimycin A (Complex III), Azide
  (Complex IV), Rotenone (Complex I), Oligomycin (ATP synthase), CCCP / DNP
  (uncouplers), Nigericin / Valinomycin (K+ ionophores), Mitomycin C
  (alkylator), Cisplatin (DNA crosslinker), MitoQ (mtTPP-conjugated CoQ
  antioxidant), Paraquat (Complex I redox cycler), TBHP / H2O2 (oxidants),
  Tiron (superoxide scavenger), Nocodazole / Colchicine (microtubules),
  Cytochalasin D / Latrunculin B (actin), Lonidamine (hexokinase II), MDIVI-1
  (Drp1 GTPase inhibitor), Resveratrol (SIRT1 activator).
- Less common (verified at build time, May 2026):
    MFI8     – mitofusin (MFN1/MFN2) inhibitor; promotes fission via fusion block.
    MYLS22   – OPA1 GTPase inhibitor; blocks inner-membrane fusion / cristae remodelling.
    P110     – Drp1-Fis1 interaction peptide inhibitor; blocks pathological fission.
- The dataset label "control" is the DMSO vehicle control.

This file is intentionally a Python dict (not JSON) so we can attach helper
functions and keep the lookup case- and whitespace-insensitive.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional


@dataclass(frozen=True)
class DrugFact:
    """One drug's pharmacology, written for a colleague — not a textbook."""

    display_name: str
    pharm_class: str       # short label, e.g. "Complex I inhibitor"
    target: str            # molecular target
    mechanism: str         # one or two sentences explaining what the drug does
    expected_phenotype: str  # what we'd biologically expect in the data


# Canonical entries. Key is the lowercase dataset label as it appears in
# `feature_table['label_names']` (so direct dict lookup works).
DRUG_KB: Dict[str, DrugFact] = {
    "control": DrugFact(
        display_name="DMSO (vehicle control)",
        pharm_class="Vehicle control",
        target="—",
        mechanism="DMSO solvent, no pharmacological action. Reference condition for all comparisons.",
        expected_phenotype="Baseline morphology and dynamics.",
    ),
    "rotenone": DrugFact(
        display_name="Rotenone",
        pharm_class="ETC Complex I inhibitor",
        target="NADH:ubiquinone oxidoreductase (Complex I)",
        mechanism="Blocks electron transfer at Complex I, halting NADH-driven respiration and generating superoxide upstream of the block.",
        expected_phenotype="Reduced motility, often preserved Δψm short-term (other complexes still active), elevated ROS over time.",
    ),
    "antimycina": DrugFact(
        display_name="Antimycin A",
        pharm_class="ETC Complex III inhibitor",
        target="Cytochrome bc1 (Complex III, Qi site)",
        mechanism="Binds the Qi site of cytochrome bc1, stalling the Q cycle and producing superoxide from the Qo semiquinone.",
        expected_phenotype="Strong Δψm loss, fragmentation, high mitochondrial ROS.",
    ),
    "azide": DrugFact(
        display_name="Sodium azide",
        pharm_class="ETC Complex IV inhibitor",
        target="Cytochrome c oxidase (Complex IV)",
        mechanism="Binds the heme a3 site of Complex IV, blocking O2 reduction and collapsing the proton-motive force.",
        expected_phenotype="Rapid Δψm collapse and metabolic crisis.",
    ),
    "oligomycin": DrugFact(
        display_name="Oligomycin",
        pharm_class="ATP synthase (Complex V) inhibitor",
        target="F0 subunit of ATP synthase",
        mechanism="Blocks proton flux through F0, preventing ATP synthesis. Δψm typically *rises* because the ETC keeps pumping protons but they can't return.",
        expected_phenotype="Hyperpolarised Δψm, accumulating proton gradient, ATP depletion.",
    ),
    "cccp": DrugFact(
        display_name="CCCP",
        pharm_class="Protonophore / uncoupler",
        target="Inner mitochondrial membrane (proton carrier)",
        mechanism="Dissipates the proton gradient by shuttling H+ across the inner membrane, uncoupling respiration from ATP synthesis.",
        expected_phenotype="Near-complete Δψm collapse, fragmentation, increased fission.",
    ),
    "dnp": DrugFact(
        display_name="2,4-DNP",
        pharm_class="Protonophore / uncoupler",
        target="Inner mitochondrial membrane (proton carrier)",
        mechanism="Weak-acid protonophore that uncouples respiration from ATP synthesis, lowering Δψm.",
        expected_phenotype="Partial Δψm loss, increased basal respiration, often more graded than CCCP.",
    ),
    "nigericin": DrugFact(
        display_name="Nigericin",
        pharm_class="K+/H+ antiporter ionophore",
        target="Lipid bilayers",
        mechanism="Exchanges K+ for H+ across membranes. Collapses ΔpH and converts the proton-motive force almost entirely into Δψm — paradoxically *hyperpolarising* mitochondria as TMRM reports.",
        expected_phenotype="Very high TMRM signal, K+ efflux, often accompanied by swelling.",
    ),
    "valinomycin": DrugFact(
        display_name="Valinomycin",
        pharm_class="K+ ionophore",
        target="Inner mitochondrial membrane (K+ carrier)",
        mechanism="Electrogenic K+ uptake collapses Δψm by short-circuiting the membrane potential, while ΔpH is largely preserved.",
        expected_phenotype="Δψm collapse, mitochondrial swelling from K+/water uptake.",
    ),
    "mitoq": DrugFact(
        display_name="MitoQ",
        pharm_class="Mitochondria-targeted antioxidant",
        target="Mitochondrial matrix (lipophilic cation accumulates via Δψm)",
        mechanism="Triphenylphosphonium-conjugated ubiquinone that concentrates in the matrix and scavenges ROS at the inner membrane.",
        expected_phenotype="Lower ROS-driven damage; minimal direct effect on Δψm in healthy cells.",
    ),
    "paraquat": DrugFact(
        display_name="Paraquat",
        pharm_class="Redox cycler / ROS generator",
        target="Complex I / cytosolic flavoproteins",
        mechanism="Accepts electrons (largely from Complex I) and donates them to O2, producing superoxide. Classic mitochondrial oxidative-stress agent.",
        expected_phenotype="Elevated ROS, eventual Δψm loss, fragmentation.",
    ),
    "h2o2": DrugFact(
        display_name="Hydrogen peroxide",
        pharm_class="Exogenous oxidant",
        target="Thiol-containing proteins, lipids",
        mechanism="Membrane-permeable peroxide that oxidises cysteines and lipids; high doses overwhelm catalase / GPx defences.",
        expected_phenotype="Dose-dependent Δψm loss, fragmentation, lipid peroxidation.",
    ),
    "tbhp": DrugFact(
        display_name="tert-Butyl hydroperoxide",
        pharm_class="Organic peroxide / oxidant",
        target="Glutathione / thioredoxin systems",
        mechanism="Depletes reduced glutathione and oxidises thiol-redox enzymes, producing sustained oxidative stress more lipid-soluble than H2O2.",
        expected_phenotype="Δψm loss, fragmentation, oxidative damage to lipids and proteins.",
    ),
    "tiron": DrugFact(
        display_name="Tiron",
        pharm_class="Superoxide scavenger",
        target="Superoxide anion (O2•-)",
        mechanism="Cell-permeable catechol that scavenges superoxide, dampening mitochondrial ROS without altering ETC flux directly.",
        expected_phenotype="Mitigates ROS-driven changes; minimal effect on Δψm baseline.",
    ),
    "resveratrol": DrugFact(
        display_name="Resveratrol",
        pharm_class="SIRT1 activator (putative)",
        target="SIRT1, AMPK pathway (indirect)",
        mechanism="Polyphenol that activates SIRT1 deacetylase and indirectly stimulates mitochondrial biogenesis via PGC-1α.",
        expected_phenotype="Subtle increases in mitochondrial mass and metabolic flexibility; effects are mild on short timescales.",
    ),
    "lonidamine": DrugFact(
        display_name="Lonidamine",
        pharm_class="Hexokinase II inhibitor",
        target="Mitochondria-bound hexokinase II; also pyruvate transport (MPC)",
        mechanism="Disrupts the HK2-VDAC interaction and inhibits the mitochondrial pyruvate carrier, restricting glycolytic and oxidative substrate flux.",
        expected_phenotype="Reduced ATP production, partial Δψm loss in tumour-like cells.",
    ),
    "cisplatin": DrugFact(
        display_name="Cisplatin",
        pharm_class="DNA crosslinker (alkylating agent)",
        target="Nuclear and mitochondrial DNA",
        mechanism="Forms intrastrand DNA crosslinks that block replication and transcription, also directly damaging mtDNA and triggering apoptosis.",
        expected_phenotype="Delayed mitochondrial damage, fragmentation, eventual Δψm loss as apoptosis proceeds.",
    ),
    "mitomycinc": DrugFact(
        display_name="Mitomycin C",
        pharm_class="DNA crosslinker (alkylating agent)",
        target="DNA (interstrand crosslinks)",
        mechanism="Bioreductively activated to a DNA alkylator forming interstrand crosslinks; classic genotoxic agent that often appears 'dead' in late-timepoint imaging.",
        expected_phenotype="Cell-cycle arrest and progressive mitochondrial damage; cells frequently look dim in late frames.",
    ),
    "mdivi1": DrugFact(
        display_name="Mdivi-1",
        pharm_class="Drp1 inhibitor (mitochondrial fission)",
        target="Drp1 GTPase",
        mechanism="Originally described as a Drp1 GTPase inhibitor; later work also implicates Complex I inhibition at higher doses.",
        expected_phenotype="More elongated/tubular mitochondria, reduced fission rate; possible Δψm changes from off-target ETC effect.",
    ),
    "p110": DrugFact(
        display_name="P110",
        pharm_class="Drp1-Fis1 peptide inhibitor",
        target="Drp1-Fis1 protein-protein interaction",
        mechanism="Selective peptide that blocks pathological Drp1 recruitment to Fis1 while sparing physiological Drp1-Mff fission.",
        expected_phenotype="Reduced *pathological* fragmentation with relatively preserved basal dynamics.",
    ),
    "mfi8": DrugFact(
        display_name="MFI8",
        pharm_class="Mitofusin (MFN1/MFN2) inhibitor",
        target="MFN1 / MFN2 GTPases",
        mechanism="Small molecule that inhibits mitofusin-driven outer-membrane fusion, lowering mitochondrial aspect ratio and promoting fission.",
        expected_phenotype="Smaller, more fragmented mitochondria; reduced fusion rate.",
    ),
    "myls22": DrugFact(
        display_name="MYLS22",
        pharm_class="OPA1 GTPase inhibitor",
        target="OPA1 (inner-membrane fusion / cristae)",
        mechanism="Reversible, noncompetitive inhibitor of OPA1 GTPase that disrupts inner-membrane fusion and cristae remodelling.",
        expected_phenotype="Fragmentation driven by inner-membrane fusion block; cristae disorganisation; can sensitise to apoptosis.",
    ),
    "nocodazole": DrugFact(
        display_name="Nocodazole",
        pharm_class="Microtubule depolymeriser",
        target="β-tubulin",
        mechanism="Binds β-tubulin and prevents microtubule polymerisation. Mitochondria lose long-range microtubule-based transport.",
        expected_phenotype="Reduced large-scale motility / re-localisation; clustering near nuclei.",
    ),
    "colchicine": DrugFact(
        display_name="Colchicine",
        pharm_class="Microtubule depolymeriser",
        target="α/β-tubulin heterodimer",
        mechanism="Caps microtubule plus-ends and depolymerises microtubules, disrupting kinesin/dynein-based mitochondrial transport.",
        expected_phenotype="Reduced motility, perinuclear clustering, slower long-range trafficking.",
    ),
    "cytochalasind": DrugFact(
        display_name="Cytochalasin D",
        pharm_class="F-actin cap / depolymeriser",
        target="Actin filament barbed (+) ends",
        mechanism="Caps actin (+) ends and prevents addition of new monomers, leading to net depolymerisation of the actin cortex.",
        expected_phenotype="Altered short-range fission/fusion dynamics that depend on actin (e.g. INF2-driven fission constriction).",
    ),
    "latrunculinb": DrugFact(
        display_name="Latrunculin B",
        pharm_class="G-actin sequesterer",
        target="Monomeric G-actin",
        mechanism="Binds free G-actin 1:1 and prevents its polymerisation, rapidly depleting F-actin pools without capping existing filaments.",
        expected_phenotype="Acute loss of actin cytoskeleton; impaired actin-driven mitochondrial constriction.",
    ),
}


def get(drug_name: Optional[str]) -> Optional[DrugFact]:
    """Case-/whitespace-insensitive lookup. Returns None if the drug isn't known."""
    if not drug_name:
        return None
    key = drug_name.strip().lower().replace(" ", "")
    # Try direct, then common aliases.
    if key in DRUG_KB:
        return DRUG_KB[key]
    aliases = {
        "dmso": "control",
        "vehicle": "control",
        "ctrl": "control",
        "untreated": "control",
        "baseline": "control",
        "h2o2": "h2o2",
        "hydrogenperoxide": "h2o2",
        "tertbutylhydroperoxide": "tbhp",
        "tert-butylhydroperoxide": "tbhp",
        "2,4-dinitrophenol": "dnp",
        "carbonylcyanide-m-chlorophenylhydrazone": "cccp",
        "antimycin": "antimycina",
        "antimycin-a": "antimycina",
        "cytochalasin-d": "cytochalasind",
        "lantrunculinb": "latrunculinb",
        "lantrunculin-b": "latrunculinb",
        "latrunculin-b": "latrunculinb",
        "lonidamine": "lonidamine",
        "mdivi": "mdivi1",
        "mdivi-1": "mdivi1",
    }
    if key in aliases:
        return DRUG_KB[aliases[key]]
    return None


def context_block(drugs: Iterable[str]) -> Optional[str]:
    """Build a Markdown block of relevant pharmacology for the given drugs.

    Used to enrich the LLM's context when a question mentions known compounds.
    Returns None if no drug is recognised (so we don't bloat the prompt with
    an empty header).
    """
    seen: List[DrugFact] = []
    seen_names: set[str] = set()
    for d in drugs:
        fact = get(d)
        if fact and fact.display_name not in seen_names:
            seen.append(fact)
            seen_names.add(fact.display_name)
    if not seen:
        return None

    lines = ["KNOWN PHARMACOLOGY (use these mechanisms when relevant to interpret the numbers):"]
    for f in seen:
        lines.append(
            f"- {f.display_name} — {f.pharm_class}. Target: {f.target}. "
            f"Mechanism: {f.mechanism} Expected: {f.expected_phenotype}"
        )
    return "\n".join(lines)


def known_drug_names() -> List[str]:
    """Return display names of all drugs in the KB (sorted, for the overview)."""
    return sorted(f.display_name for f in DRUG_KB.values())
