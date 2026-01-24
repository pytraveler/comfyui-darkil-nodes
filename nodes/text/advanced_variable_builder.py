from datetime import datetime
import logging
import re
from typing import Any, Dict, List, Tuple, Union

from .utilities import (
    choose_variant,
    parse_other_vals,
    raw_as_bool,
    split_input_lines,
    strip_all_comments,
    strip_quotes,
)


log = logging.getLogger(__name__)


class AdvancedVariableBuilder:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "switch": ("BOOLEAN", {"default": True}),
                "out_val_by_switch": ("BOOLEAN", {"default": True}),
                "var_name": ("STRING", {"default": "variable_name"}),
                "var_text": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
            },
            "optional": {
                "INPUT_VAR": ("BOOLEAN,INT,FLOAT,STRING,COMBO", {"default": ""}),
            },
            "hidden": {
                "OTHER_INPUT": ("STRING", {"default": "[]"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("VAR", "❓help",)
    FUNCTION = "get_variable"
    CATEGORY = "darkilNodes/text"
    OUTPUT_NODE = False
    
    HELP_TEXT = """Node Help – Advanced Variable Builder

This node creates a variable whose value is assembled from dynamic placeholders,
conditional expressions, optional defaults and supports random variants.
All placeholder syntax uses double curly braces `{{…}}`.

Placeholder types:
    {{var}}                – Insert the resolved value of another variable defined in INPUT_VAR or DYNAMIC_* inputs.
    {{"text"}}             – Insert a literal string (quotes are optional).
    {{DATE}}               – Current date in **YYYYMMDD** format.
    {{TIME}}               – Current time in **HHMMSS** format.
    {{IF:cond:true:false}}   – If *cond* evaluates to true, use *true*, otherwise *false*.
    {{IFNOT:cond:true:false}}– Same as IF but negates the condition.
    {{var??default}}       – Use *var* if it resolves to a non-empty value; otherwise fall back to *default*.

Special variable names:
    default, def, _        – Resolve to the “default single-line” value supplied via the optional INPUT_VAR (the last line without an `=` in the input).

Features:
    • Multiple values for a variable can be separated by `|` and one will be chosen at random.
    • Logical expressions support `&&` (AND) and `||` (OR) with boolean literals or other variables.
    • Cyclic references are detected; they produce an empty string and emit a warning.
    • The node strips comments (`# …`) from the variable template before processing.

Options:
   - **switch**: Enable/disable generation. When off, the node returns an empty variable (or only help text if `out_val_by_switch` is True).
   - **out_val_by_switch**: If enabled and `switch` is off, only the help text is output.
   - **var_name**: Name of the variable to prepend to the result (`<name> = <value>`). Leave empty for raw value.
   - **var_text**: Multiline template containing placeholders.

Example:
    var_text = "Hello {{user}}! Today is {{DATE}}."
    INPUT_VAR = "user = Alice"

Result (with default settings):
    variable_name = Hello Alice! Today is 20231130

Use the dynamic inputs (`DYNAMIC_1`, `DYNAMIC_2`, …) to add additional variables at runtime."""

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("NaN")

    def get_variable(
        self,
        switch: bool,
        out_val_by_switch: bool,
        var_name: str,
        var_text: str,
        INPUT_VAR: Union[bool, str, int, float,
                        List[Union[bool, str, int, float]]] = "",
        OTHER_INPUT: str = "[]",
        **kwargs,
    ) -> Tuple[str]:
        input_lines = split_input_lines(INPUT_VAR)

        _other_other_input = [v for k in kwargs.keys() if (
            k.strip().startswith("DYNAMIC_") and (v := kwargs.get(k, "")))]
        raw_dict, default_single_line = parse_other_vals(_other_other_input, input_lines)

        resolved_cache: Dict[str, str] = {}

        placeholder_pattern = re.compile(r"\{\{([^{}]*)\}\}")

        def resolve_variable(name: str, stack: List[str]) -> str:
            if name in ["default", "def", "_"]:
                return default_single_line
            
            if name in resolved_cache:
                return resolved_cache[name]

            if name in stack:                     
                log.warning(
                    f"[darkilNodes.AdvancedVariableBuilder] Cyclic variable reference detected: {' -> '.join(stack + [name])}"
                )
                return ""

            raw_val = raw_dict.get(name, "")
            if not raw_val:
                return ""                        

            chosen = choose_variant(raw_val)
            expanded = replace_placeholders(chosen, stack + [name])
            resolved_cache[name] = expanded
            return expanded

        def replace_placeholders(text: str, call_stack: List[str]) -> str:

            def repl(match: re.Match) -> str:
                inner = match.group(1).strip()

                # {{}} – default value
                if inner.lower() in ["", "default", "_"]:
                    return default_single_line

                # DATE / TIME
                if inner.upper() == "DATE":
                    return str(int(datetime.now().strftime("%Y%m%d")))
                if inner.upper() == "TIME":
                    return str(int(datetime.now().strftime("%H%M%S")))

                # IF / IFNOT
                upper = inner.upper()
                if upper.startswith("IF:") or upper.startswith("IFNOT:"):
                    is_not = upper.startswith("IFNOT:")
                    parts = inner.split(":")
                    if len(parts) < 3:
                        return ""                     # malformed

                    _, bool_token, true_tok, *rest = parts
                    false_tok = rest[0] if rest else ""

                    condition = raw_as_bool(bool_token,
                                            raw_dict,
                                            default_single_line=default_single_line)
                    if is_not:
                        condition = not condition

                    chosen_token = true_tok if condition else false_tok

                    # literal in quotes?
                    literal = strip_quotes(chosen_token)
                    if literal is not None:
                        return literal

                    # otherwise treat as variable name
                    return resolve_variable(chosen_token, call_stack)

                # {{var??default}}
                if "??" in inner:
                    var_part, default_part = inner.split("??", 1)
                    var_name_clean = var_part.strip()
                    resolved = resolve_variable(var_name_clean, call_stack)

                    if resolved:                     
                        return resolved

                    literal_fallback = strip_quotes(default_part.strip())
                    return literal_fallback if literal_fallback is not None else default_part.strip()

                # simple {{var}} 
                literal = strip_quotes(inner)
                if literal is not None:
                    return literal

                return resolve_variable(inner, call_stack)

            return placeholder_pattern.sub(repl, text)

        cleaned_text = strip_all_comments(var_text) if var_text else ""

        final_value = "" if not switch else replace_placeholders(cleaned_text, [])

        if var_name.strip():
            escaped_value = final_value.replace("\n", " ")
        else:
            escaped_value = final_value

        if out_val_by_switch is True and switch is False:
            return ("", self.HELP_TEXT,)
        
        if var_name.strip():
            return (f"{var_name.strip()} = {escaped_value}", self.HELP_TEXT,)

        return (escaped_value, self.HELP_TEXT,)
