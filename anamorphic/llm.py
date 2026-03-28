from __future__ import annotations
import json
import os
import subprocess
import time

try:
    import anthropic as _anthropic
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False

MODEL = "claude-sonnet-4-6"
MAX_RETRIES = 3
RETRY_DELAY = 2.0


def _backend() -> str:
    """Resolve which backend to use: 'sdk' or 'cli'."""
    if os.environ.get("ANTHROPIC_API_KEY") and _SDK_AVAILABLE:
        return "sdk"
    return "cli"


class LLMClient:
    def __init__(self, model: str = MODEL):
        self.model = model
        self._mode = _backend()
        if self._mode == "sdk":
            self._client = _anthropic.Anthropic()
        else:
            self._client = None

    # ------------------------------------------------------------------
    # Public operations
    # ------------------------------------------------------------------

    def decompose(self, problem: str, parent_problem: str = "") -> list[str]:
        """Break a problem into 2–5 concrete, independent subproblems."""
        context_line = f"\nParent problem for context: {parent_problem}" if parent_problem else ""
        prompt = f"""You are decomposing a software engineering problem into concrete subproblems.

Problem:{context_line}
{problem}

Break this into 2–5 concrete, non-overlapping subproblems that together fully solve it.
Each subproblem must be specific, actionable, and independently implementable.

Respond with ONLY a valid JSON array of strings — no other text, no markdown fences.
Example: ["subproblem one", "subproblem two", "subproblem three"]"""
        text = self._call(prompt, max_tokens=1024)
        return _parse_json_array(text)

    def assess(self, problem: str) -> bool:
        """Return True if this problem can be implemented in ≤500 lines of Python."""
        prompt = f"""You are evaluating whether a software problem can be fully implemented in 500 or fewer lines of Python by a skilled developer.

Problem:
{problem}

Rules:
- 500 lines is roughly one focused module or script
- Count only implementation lines (not blank lines or comments)
- Standard library and common third-party packages (requests, anthropic, etc.) are available
- The problem must be specific enough to implement directly — vague or architectural problems do not qualify

Answer with ONLY the single word "yes" or "no"."""
        text = self._call(prompt, max_tokens=8).strip().lower()
        return text.startswith("yes")

    def structured_plan(self, problem: str) -> dict:
        """Generate a structured LeafPlan for a leaf node. Returns a dict."""
        from .schema import LEAF_PLAN_PROMPT_TEMPLATE, extract_yaml
        prompt = f"""You are creating a structured implementation plan for a software problem (≤500 lines of Python).

Problem:
{problem}

Respond with ONLY valid YAML — no markdown fences, no explanation, no extra text.
Use exactly this structure:

{LEAF_PLAN_PROMPT_TEMPLATE}"""
        text = self._call(prompt, max_tokens=2000)
        return extract_yaml(text)

    def analyze_root(self, problem: str) -> str:
        """Produce a structured markdown analysis of the root problem."""
        prompt = f"""You are analyzing a software problem before breaking it down.

Problem:
{problem}

Write a concise structured markdown analysis with these sections:
## Problem Statement
(restate clearly in 1-2 sentences)

## Key Components
(bullet list of the major pieces involved)

## Scope Assessment
(1-2 sentences on size/complexity and why decomposition is needed)

Be specific and technical. This is shown to the user for approval before decomposition begins."""
        return self._call(prompt, max_tokens=800)

    def refine_plan(self, problem: str, schema: dict, feedback: str) -> dict:
        """Revise a structured plan based on user feedback."""
        import yaml as _yaml
        from .schema import LEAF_PLAN_PROMPT_TEMPLATE, extract_yaml
        current = _yaml.dump(schema, default_flow_style=False, sort_keys=False)
        prompt = f"""You are revising an implementation plan based on user feedback.

Problem:
{problem}

Current plan (YAML):
{current}

User feedback:
{feedback}

Produce a revised plan addressing the feedback. Respond with ONLY valid YAML, same structure:

{LEAF_PLAN_PROMPT_TEMPLATE}"""
        return extract_yaml(self._call(prompt, max_tokens=2000))

    def refine_decompose(self, problem: str, subproblems: list[str], feedback: str) -> list[str]:
        """Revise a decomposition based on user feedback."""
        current = "\n".join(f"{i+1}. {s}" for i, s in enumerate(subproblems))
        prompt = f"""You are revising a problem decomposition based on user feedback.

Problem:
{problem}

Current decomposition:
{current}

User feedback:
{feedback}

Produce a revised list of 2-5 subproblems addressing the feedback.
Respond with ONLY a valid JSON array of strings — no other text.
Example: ["subproblem one", "subproblem two"]"""
        return _parse_json_array(self._call(prompt, max_tokens=1024))

    def identify_dependencies(self, problems: list[str]) -> dict[int, list[int]]:
        """
        Given a list of sibling subproblems (by index), return which indices
        depend on which others. Returns {dependent_index: [dependency_indices]}.
        """
        if len(problems) < 2:
            return {}
        numbered = "\n".join(f"{i}. {p}" for i, p in enumerate(problems))
        prompt = f"""You are analyzing dependencies between software subproblems that will be implemented in parallel.

Subproblems:
{numbered}

Identify which subproblems must be completed before others can begin.
A depends on B means: A cannot start until B is finished (e.g. A uses code or data produced by B).

Respond with ONLY a valid JSON object mapping each dependent index (as a string) to an array of indices it depends on.
Only include entries where there is at least one dependency. Omit independent subproblems.
Example: {{"2": [0, 1], "1": [0]}}"""
        text = self._call(prompt, max_tokens=256)
        return _parse_dep_map(text)

    def implement(self, problem: str, schema: dict | None = None) -> str:
        """Generate a complete Python implementation for a leaf node."""
        if schema:
            import yaml as _yaml
            plan_section = "\nImplementation plan (YAML):\n" + _yaml.dump(
                schema, default_flow_style=False, sort_keys=False
            )
        else:
            plan_section = ""
        prompt = f"""You are implementing a focused Python module.

Problem:
{problem}
{plan_section}
Write complete, working Python code. Requirements:
- A single Python module (one .py file)
- Include all necessary imports
- Follow the plan exactly
- No placeholder comments like "TODO" or "pass" — implement everything
- No markdown fences or explanation — output raw Python code only"""
        return self._call(prompt, max_tokens=4096)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _call(self, prompt: str, max_tokens: int) -> str:
        if self._mode == "sdk":
            return self._call_sdk(prompt, max_tokens)
        return self._call_cli(prompt)

    def _call_sdk(self, prompt: str, max_tokens: int) -> str:
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                response = self._client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                )
                return response.content[0].text
            except _anthropic.RateLimitError as e:
                last_err = e
                time.sleep(RETRY_DELAY * (attempt + 1))
            except _anthropic.APIError as e:
                last_err = e
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
        raise RuntimeError(f"LLM call failed after {MAX_RETRIES} attempts") from last_err

    def _call_cli(self, prompt: str) -> str:
        last_err: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                result = subprocess.run(
                    ["claude", "-p", prompt],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                return result.stdout
            except subprocess.CalledProcessError as e:
                last_err = e
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
            except FileNotFoundError:
                raise RuntimeError(
                    "claude CLI not found. Install Claude Code or set ANTHROPIC_API_KEY."
                )
        raise RuntimeError(f"CLI call failed after {MAX_RETRIES} attempts") from last_err


def _parse_dep_map(text: str) -> dict[int, list[int]]:
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        return {}
    try:
        raw = json.loads(text[start:end])
    except json.JSONDecodeError:
        return {}
    result: dict[int, list[int]] = {}
    for k, v in raw.items():
        try:
            result[int(k)] = [int(i) for i in v]
        except (ValueError, TypeError):
            pass
    return result


def _parse_json_array(text: str) -> list[str]:
    text = text.strip()
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON array found in LLM response:\n{text}")
    arr = json.loads(text[start:end])
    if not isinstance(arr, list) or not arr:
        raise ValueError(f"Expected non-empty list, got: {arr}")
    return [str(item) for item in arr]
