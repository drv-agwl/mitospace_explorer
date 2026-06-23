"""
View-action tools for the MitoSpace agent.

The compute tools in `agent_tools.py` answer questions with deterministic
numbers. These *action* tools let the agent additionally DRIVE the 3D explorer:
colour the atlas by a feature, set the semantic axis, filter drug conditions,
open a representative cell, or reset the view.

Design
------
- Each action tool returns a small JSON object of the shape
  ``{"ui_action": {...}, "ok": true, "summary": "..."}``.
- The ``ui_action`` payload is forwarded verbatim to the frontend in the
  ``actions`` field of the /api/chat response, where an ``AgentProvider``
  dispatches it into ``SampleContext``.
- Actions never assert numbers, so they don't affect the groundedness check.
  They only manipulate view state — which is inherently safe (deterministic UI
  state changes, no biology claims).

Feature naming
--------------
The compute layer speaks canonical names ("Fragment Diffusivity", "TMRM
Intensity"). The frontend speaks ``apiName`` (e.g. ``fragment_diffusivity_mean``,
``tmrm_last``). This module is the single place that translates between them, so
an action like "colour by motility" lands on the right axis in the UI.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

try:
    from . import query_handler
except ImportError:  # absolute import when run from server/
    import query_handler  # type: ignore


logger = logging.getLogger("mitospace.agent_actions")


# Canonical compute-layer feature name -> (frontend apiName, display label).
# Only the features actually exposed by the v3 explorer UI are mappable; an
# action targeting an unsupported feature returns an error the agent can recover
# from (e.g. fall back to narrating the numbers).
_FEATURE_TO_UI: Dict[str, Dict[str, str]] = {
    "Fragment Diffusivity": {"apiName": "fragment_diffusivity_mean", "label": "Fragment Motility"},
    "Segment Diffusivity": {"apiName": "segment_diffusivity_mean", "label": "Segment Motility"},
    "Node Diffusivity": {"apiName": "node_diffusivity_mean", "label": "Node Motility"},
    "Fission Rate": {"apiName": "fission_rate_mean", "label": "Fission Rate"},
    "Fusion Rate": {"apiName": "fusion_rate_mean", "label": "Fusion Rate"},
    "Fragment Length": {"apiName": "fragment_length_mean", "label": "Fragment Length"},
    "Segment Length": {"apiName": "segment_length_mean", "label": "Segment Length"},
    "Fragment Diameter": {"apiName": "fragment_diameter_mean", "label": "Fragment Diameter"},
    "Fragment Tortuosity": {"apiName": "fragment_tortuosity_mean", "label": "Tortuosity"},
    "TMRM Intensity": {"apiName": "tmrm_last", "label": "Membrane Potential"},
}


def resolve_feature_ui(name: str) -> Optional[Dict[str, str]]:
    """Map a human/canonical feature name to its frontend {apiName, label}."""
    if not name:
        return None
    canonical = query_handler.extract_feature_name(name) or name
    if canonical in _FEATURE_TO_UI:
        return _FEATURE_TO_UI[canonical]
    # Try a loose match against canonical keys.
    low = canonical.strip().lower()
    for k, v in _FEATURE_TO_UI.items():
        if k.lower() == low:
            return v
    return None


def _resolve_condition_slugs(drugs: List[str]) -> List[str]:
    """Map requested drug names to the dataset slugs the frontend filters on.

    The v3 points JSON stores ``treatment.drug`` as lowercase slugs (e.g.
    ``rotenone``, ``control``). We resolve via the loaded sample metadata so the
    returned slugs always match what the UI can select.
    """
    meta = query_handler.sample_metadata
    available = (
        {str(d).lower(): str(d) for d in meta["drug"].unique()}
        if meta is not None
        else {}
    )
    out: List[str] = []
    for d in drugs or []:
        if not d:
            continue
        slug = query_handler.normalize_drug_slug(d)
        # DMSO/control normalisation: dataset uses "control".
        candidates = [slug.lower(), d.strip().lower()]
        if slug.upper() in ("DMSO", "CONTROL"):
            candidates = ["control", "dmso"] + candidates
        matched = next((available[c] for c in candidates if c in available), None)
        if matched and matched not in out:
            out.append(matched)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Tool schemas (OpenAI / OpenRouter function-calling format)
# ─────────────────────────────────────────────────────────────────────────────

ACTION_TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "color_atlas_by_feature",
            "description": (
                "Colour the 3D atlas by a mitochondrial feature (turns on the "
                "semantic-axis colouring so every cell is shaded by its value, "
                "low→high on a plasma scale). USE WHEN the user says 'colour/show "
                "the map by motility', 'visualise membrane potential on the "
                "atlas', or when a feature you just discussed is best shown "
                "spatially. Supported features: motility (fragment/segment/node), "
                "membrane potential, fragment length, segment length, fragment "
                "diameter, tortuosity, fission rate, fusion rate."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "feature": {
                        "type": "string",
                        "description": "Feature to colour by (human names accepted).",
                    }
                },
                "required": ["feature"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "filter_conditions",
            "description": (
                "Restrict the atlas to one or more drug conditions, hiding all "
                "other cells. USE WHEN the user says 'show only Rotenone and "
                "CCCP', 'isolate the uncouplers', 'just the controls'. Pass the "
                "drug names; 'DMSO'/'control' are the vehicle control."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "description": "Drug condition names to keep visible.",
                    }
                },
                "required": ["drugs"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_cell",
            "description": (
                "Open a single-cell movie for a drug condition in the detail "
                "panel. You can open a TYPICAL cell or a specific OUTLIER. USE "
                "WHEN the user says 'show me a Rotenone cell', 'open the "
                "lowest-motility Colchicine cell', 'show the most depolarised "
                "CCCP cell', 'what does an extreme X look like'. For an outlier, "
                "set selection=lowest|highest AND pass the feature."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drug": {"type": "string", "description": "Drug condition name."},
                    "selection": {
                        "type": "string",
                        "enum": ["representative", "lowest", "highest"],
                        "description": (
                            "Which cell of this condition to open: a representative "
                            "(typical) one, or the lowest/highest for a feature."
                        ),
                    },
                    "feature": {
                        "type": "string",
                        "description": (
                            "Feature to rank by when selection is lowest/highest "
                            "(e.g. motility, membrane potential). Required for outliers."
                        ),
                    },
                },
                "required": ["drug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_point_size",
            "description": (
                "Change how large the cell points are drawn in the 3D atlas. USE "
                "WHEN the user says 'make the points bigger/smaller', 'increase "
                "point size', 'the dots are too small'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "size": {
                        "type": "string",
                        "enum": ["small", "medium", "large", "huge"],
                        "description": "Relative point size.",
                    }
                },
                "required": ["size"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_atlas_coloring",
            "description": (
                "Switch how cells are coloured in the atlas. mode='drug' shows "
                "each cell in its drug-condition colour (this TURNS OFF any "
                "feature/semantic colouring). mode='phenotype' colours by "
                "morphological phenotype. USE WHEN the user says 'colour by drug', "
                "'show drug colours', 'turn off the feature colouring', 'go back "
                "to normal colours', 'colour by phenotype'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["drug", "phenotype"],
                        "description": "Colour scheme to switch to.",
                    }
                },
                "required": ["mode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "toggle_grid",
            "description": (
                "Show or hide the reference grid in the 3D atlas. USE WHEN the "
                "user says 'show the grid', 'hide the grid lines', 'turn on the "
                "floor grid'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "show": {"type": "boolean", "description": "True to show the grid, false to hide it."}
                },
                "required": ["show"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reset_atlas_view",
            "description": (
                "Clear all condition filters, turn off feature colouring, and "
                "return the atlas to its default state. USE WHEN the user says "
                "'reset', 'clear the filters', 'show everything again', 'start "
                "over'."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────────────────


def is_action_tool(name: str) -> bool:
    return name in _ACTION_NAMES


def run_action(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a view-action tool. Returns a dict with a ``ui_action`` payload."""
    if name == "color_atlas_by_feature":
        ui = resolve_feature_ui(args.get("feature", ""))
        if not ui:
            return {
                "ok": False,
                "error": (
                    f"Feature '{args.get('feature')}' can't be shown on the atlas. "
                    "Supported: motility, membrane potential, fragment length, "
                    "segment length, fragment diameter, tortuosity, fission rate, "
                    "fusion rate."
                ),
            }
        return {
            "ok": True,
            "summary": f"Coloured the atlas by {ui['label']}.",
            "ui_action": {
                "type": "color_by_feature",
                "feature": ui["apiName"],
                "label": ui["label"],
            },
        }

    if name == "filter_conditions":
        slugs = _resolve_condition_slugs(args.get("drugs") or [])
        if not slugs:
            return {
                "ok": False,
                "error": (
                    "None of those conditions were found in the dataset. "
                    "Call list_drugs() to see valid names."
                ),
            }
        return {
            "ok": True,
            "summary": f"Filtered the atlas to: {', '.join(slugs)}.",
            "ui_action": {"type": "filter_conditions", "drugs": slugs},
        }

    if name == "open_cell":
        slugs = _resolve_condition_slugs([args.get("drug", "")])
        if not slugs:
            return {
                "ok": False,
                "error": f"Condition '{args.get('drug')}' not found. Call list_drugs().",
            }
        selection = str(args.get("selection") or "representative").lower()
        if selection not in ("representative", "lowest", "highest"):
            selection = "representative"
        ui: Dict[str, Any] = {"type": "open_cell", "drug": slugs[0], "selection": selection}
        if selection in ("lowest", "highest"):
            feat = resolve_feature_ui(args.get("feature", ""))
            if not feat:
                return {
                    "ok": False,
                    "error": (
                        f"To open the {selection} cell I need a supported feature "
                        f"(motility, membrane potential, fragment length, segment "
                        f"length, fragment diameter, tortuosity, fission/fusion "
                        f"rate). '{args.get('feature')}' isn't one."
                    ),
                }
            ui["feature"] = feat["apiName"]
            ui["featureLabel"] = feat["label"]
            summary = (
                f"Opened the {selection}-{feat['label']} {slugs[0]} cell."
            )
        else:
            summary = f"Opened a representative {slugs[0]} cell."
        return {"ok": True, "summary": summary, "ui_action": ui}

    if name == "set_point_size":
        size = str(args.get("size") or "medium").lower()
        size_map = {"small": 0.6, "medium": 1.2, "large": 2.2, "huge": 3.5}
        if size not in size_map:
            size = "medium"
        return {
            "ok": True,
            "summary": f"Set the atlas point size to {size}.",
            "ui_action": {"type": "set_point_size", "size": size_map[size], "label": size},
        }

    if name == "set_atlas_coloring":
        mode = str(args.get("mode") or "drug").lower()
        if mode not in ("drug", "phenotype"):
            mode = "drug"
        # Frontend coloringMode: 'treatment' is the per-drug palette.
        fe_mode = "treatment" if mode == "drug" else "phenotype"
        label = "drug condition" if mode == "drug" else "phenotype"
        return {
            "ok": True,
            "summary": f"Coloured the atlas by {label} (feature colouring off).",
            "ui_action": {"type": "set_coloring_mode", "mode": fe_mode, "label": label},
        }

    if name == "toggle_grid":
        show = bool(args.get("show", True))
        return {
            "ok": True,
            "summary": ("Showed the reference grid." if show else "Hid the reference grid."),
            "ui_action": {"type": "set_grid", "show": show},
        }

    if name == "reset_atlas_view":
        return {
            "ok": True,
            "summary": "Reset the atlas to its default view.",
            "ui_action": {"type": "reset_view"},
        }

    return {"ok": False, "error": f"Unknown action: {name}"}


_ACTION_NAMES = {t["function"]["name"] for t in ACTION_TOOL_SCHEMAS}


def action_names() -> List[str]:
    return list(_ACTION_NAMES)
