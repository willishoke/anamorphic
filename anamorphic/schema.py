"""
Structured schema for leaf nodes.

LeafPlan is the canonical representation of what a leaf node contains.
It serializes to/from YAML (stored on Node.schema as a dict) and is the
source of truth for both markdown rendering and code implementation.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import yaml


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class FieldDef:
    name: str
    type: str
    description: str = ""


@dataclass
class DataStructureDef:
    name: str
    fields: list[FieldDef] = field(default_factory=list)


@dataclass
class FunctionDef:
    name: str
    signature: str
    purpose: str


@dataclass
class LeafPlan:
    summary: str
    estimated_lines: int
    data_structures: list[DataStructureDef] = field(default_factory=list)
    functions: list[FunctionDef] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    edge_cases: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "estimated_lines": self.estimated_lines,
            "data_structures": [
                {
                    "name": ds.name,
                    "fields": [
                        {
                            "name": f.name,
                            "type": f.type,
                            **({"description": f.description} if f.description else {}),
                        }
                        for f in ds.fields
                    ],
                }
                for ds in self.data_structures
            ],
            "functions": [
                {"name": fn.name, "signature": fn.signature, "purpose": fn.purpose}
                for fn in self.functions
            ],
            "steps": self.steps,
            "edge_cases": self.edge_cases,
        }

    def to_yaml(self) -> str:
        return yaml.dump(self.to_dict(), default_flow_style=False, sort_keys=False, allow_unicode=True)

    @classmethod
    def from_dict(cls, data: dict) -> "LeafPlan":
        ds_list = [
            DataStructureDef(
                name=ds["name"],
                fields=[
                    FieldDef(
                        name=f["name"],
                        type=f.get("type", "Any"),
                        description=f.get("description", ""),
                    )
                    for f in ds.get("fields", [])
                ],
            )
            for ds in data.get("data_structures") or []
        ]
        fn_list = [
            FunctionDef(
                name=fn["name"],
                signature=fn.get("signature", fn["name"]),
                purpose=fn.get("purpose", ""),
            )
            for fn in data.get("functions") or []
        ]
        return cls(
            summary=str(data.get("summary", "")),
            estimated_lines=int(data.get("estimated_lines", 0)),
            data_structures=ds_list,
            functions=fn_list,
            steps=[str(s) for s in (data.get("steps") or [])],
            edge_cases=[str(e) for e in (data.get("edge_cases") or [])],
        )

    @classmethod
    def from_yaml(cls, text: str) -> "LeafPlan":
        return cls.from_dict(extract_yaml(text))


# ---------------------------------------------------------------------------
# YAML extraction helper (shared with llm.py)
# ---------------------------------------------------------------------------

def extract_yaml(text: str) -> dict:
    """Parse a YAML mapping from text, stripping markdown fences if present."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        end = len(lines) - 1
        for i in range(1, len(lines)):
            if lines[i].strip().startswith("```"):
                end = i
                break
        text = "\n".join(lines[1:end])
    result = yaml.safe_load(text)
    if not isinstance(result, dict):
        raise ValueError(f"Expected YAML mapping, got {type(result).__name__}")
    return result


# ---------------------------------------------------------------------------
# Schema template (used in LLM prompt)
# ---------------------------------------------------------------------------

LEAF_PLAN_PROMPT_TEMPLATE = """\
summary: <one-sentence description of what this module does>
estimated_lines: <integer estimate of implementation lines, excluding blanks/comments>
data_structures:
  - name: <ClassName>
    fields:
      - name: <field_name>
        type: <Python type annotation>
        description: <brief description>
functions:
  - name: <function_name>
    signature: <full Python signature with type hints>
    purpose: <one-line purpose>
steps:
  - <first implementation step>
  - <second step>
edge_cases:
  - <edge case or error condition to handle>\
"""
