from datetime import datetime
import logging
import re
from typing import Any, Dict, List, Tuple, Union

from .utilities import (
    choose_variant,
    parse_input_lines,
    raw_as_bool, 
    split_input_lines,
    strip_all_comments,
    strip_quotes,
)


log = logging.getLogger(__name__)


class TextVariableBuilder:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "switch": ("BOOLEAN", {"default": True}),
                "out_val_by_switch": ("BOOLEAN", {"default": False}),
                "var_name": ("STRING", {"default": "variable_name"}),
                "var_value": ("STRING", {"default": ""}),
            },
            "optional": {
                "INPUT_VAR": ("BOOLEAN,INT,FLOAT,STRING,COMBO", {"default": ""})
            }
        }

    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("VAR", "❓help",)
    FUNCTION = "get_variable"
    CATEGORY = "darkilNodes/text"
    OUTPUT_NODE = False
    
    HELP_TEXT = """TextVariableBuilder node helps you create and manipulate text variables.

Inputs:
   - **switch** (BOOLEAN): Enable or disable the output generation.
   - **out_val_by_switch** (BOOLEAN): If enabled, the node returns an empty string when `switch` is False.
   - **var_name** (STRING): Name of the variable to assign. Leave empty to get only the value.
   - **var_value** (STRING): Template text supporting placeholders and shortcuts.
   - **INPUT_VAR** (optional, various types): Define additional variables in the format `name=value` per line.

Placeholders in `var_value`:
   - `{{variable}}` – replace with the value of a defined variable.
   - `{{default}}` or `{{}}` – insert the default single-line value from INPUT_VAR.
   - `{{DATE}}` / `{{TIME}}` – current date (YYYYMMDD) or time (HHMMSS).
   - Conditional: `{{IF:cond:true:false}}` or `{{IFNOT:cond:true:false}}` where *cond* can be a boolean, variable name, or expression.
   - Fallback: `{{var??\"fallback\"}}` – use *var* if defined else the fallback literal.

You can also use random variants in INPUT_VAR values separated by `|`, e.g. `greeting=Hello|Hi|Hey`."""

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")

    def get_variable(
        self,
        switch: bool,
        out_val_by_switch: bool,
        var_name: str,
        var_value: str,
        INPUT_VAR: Union[bool, str, int, float, List[Union[bool, str, int, float]]] = "",
        **kwargs,
    ) -> Tuple[str]:
        
        # Parse incoming variable definitions (same as before)
        input_lines = split_input_lines(INPUT_VAR)
        raw_dict, default_single_line = parse_input_lines(input_lines)

        # Cache for already‑resolved variables (prevents infinite recursion)
        resolved_cache: Dict[str, str] = {}

        placeholder_pattern = re.compile(r"\{\{([^{}]*)\}\}")

        def resolve_variable(name: str, stack: List[str]) -> str:
            """Resolve a variable name recursively, handling random variants."""
            if name in ["default", "def", "_"]:
                return default_single_line
            
            if name in resolved_cache:
                return resolved_cache[name]

            if name in stack:  # cyclic reference
                log.warning(
                    f"[darkilNodes.TextVariableBuilder] Cyclic variable reference detected: {' -> '.join(stack + [name])}"
                )
                return ""

            raw_val = raw_dict.get(name, "")
            if not raw_val:
                return ""  # unknown variable → empty

            chosen = choose_variant(raw_val)          # random variant (|)
            expanded = replace_placeholders(chosen, stack + [name])
            resolved_cache[name] = expanded
            return expanded

        def replace_placeholders(text: str, call_stack: List[str]) -> str:
            """Replace all {{…}} placeholders inside *text*."""

            def repl(match: re.Match) -> str:
                inner = match.group(1).strip()

                # {{}} – default (single‑line) value
                if inner.lower() in ["", "default", "_"]:
                    return default_single_line

                # DATE / TIME shortcuts
                if inner.upper() == "DATE":
                    return str(int(datetime.now().strftime("%Y%m%d")))
                if inner.upper() == "TIME":
                    return str(int(datetime.now().strftime("%H%M%S")))

                # Conditional operators IF:… and IFNOT:…
                upper = inner.upper()
                if upper.startswith("IF:") or upper.startswith("IFNOT:"):
                    is_not = upper.startswith("IFNOT:")
                    parts = inner.split(":")
                    if len(parts) < 3:
                        return ""                     # malformed → empty

                    _, bool_token, true_tok, *rest = parts
                    false_tok = rest[0] if rest else ""

                    condition = raw_as_bool(
                        bool_token,
                        raw_dict,
                        default_single_line=default_single_line,
                    )
                    if is_not:
                        condition = not condition

                    chosen_token = true_tok if condition else false_tok

                    # literal in quotes?
                    literal = strip_quotes(chosen_token)
                    if literal is not None:
                        return literal

                    # otherwise treat as variable name
                    return resolve_variable(chosen_token, call_stack)

                # Fallback operator: {{var??"default"}} or {{var??default}}
                if "??" in inner:
                    var_part, default_part = inner.split("??", 1)
                    resolved = resolve_variable(var_part.strip(), call_stack)
                    if resolved:
                        return resolved

                    literal_fallback = strip_quotes(default_part.strip())
                    return (
                        literal_fallback
                        if literal_fallback is not None
                        else default_part.strip()
                    )

                # Literal string in double quotes (e.g. {{"hello"}})
                literal = strip_quotes(inner)
                if literal is not None:
                    return literal

                # Plain variable reference
                return resolve_variable(inner, call_stack)

            return placeholder_pattern.sub(repl, text)

        # Strip comments from the user‑provided template before processing.
        cleaned_template = strip_all_comments(var_value) if var_value else ""

        final_value = "" if not switch else replace_placeholders(cleaned_template, [])

        # Respect out_val_by_switch flag
        if out_val_by_switch is True and switch is False:
            return ("", self.HELP_TEXT,)

        # Return either “name = value” or just the value
        if var_name.strip():
            return (f"{var_name.strip()} = {final_value}", self.HELP_TEXT,)
        return (final_value, self.HELP_TEXT,)
