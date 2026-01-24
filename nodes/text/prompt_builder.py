import json
import logging
import re
from typing import Callable, Dict, Tuple

import directives
from utilities import (
    strip_all_comments,
)


log = logging.getLogger(__name__)


class SimplePromptBuilder:
    CATEGORY = "darkilNodes/text"
    FUNCTION = "build_prompt"
    
    HELP_TEXT = """Prompt Writing Help:
- Use placeholders {{NAME:TYPE:VALUE:DEFAULT:USE_INPUT}} to define dynamic values.
   * TYPE can be STRING, INT, FLOAT, COMBO, SLIDER, KNOB.
   * VALUE is the current value, or MIN value (INT, FLOAT), or a list of values separated by ';' (optional).
   * DEFAULT is the fallback value, or MAX value (INT, FLOAT) (optional).
   * USE_INPUT flag (true/false) determines whether an input socket is created for this placeholder.

- Toggle sections with [[TAG]]...[[/TAG]] to enable or disable blocks of text.
   The tag creates a toggle widget; when disabled, the wrapped block is removed.
   Syntax [[TAG:GROUP]]...[[/TAG]] creates a toggle belonging to GROUP. Enabling one toggle in the same group disables all others.

- Add comments that are ignored during processing:
    // line comment
    # another line comment
    /* multi-line
       comment */

- Include an optional extra block using [%extra%]...[%extra%].
   When this block is present, a toggle widget labeled “Extra text active” appears.
   If the toggle is enabled, the content inside the extra block is processed in the same way as the main prompt:
   it can contain placeholders {{…}} and toggle tags [[TAG]]...[[/TAG]], which will generate their own dynamic widgets.

- Spaceless blocks: `{%spaceless%}...{%spaceless stop%}` removes all excess whitespace
   (spaces, newlines, tabs) inside the block, collapsing them into a single space and stripping leading/trailing spaces.
   This processing is applied after placeholders and toggle tags have been resolved. `{%sl%}...{%sl stop%}`- short version.

- Additional formatting directives:
   * lower (lw) – converts text to lowercase.
   * upper (up) – converts text to uppercase.
   * title (tl) – makes each word Title-Case.
   * sentence (snt) – capitalises the first character of each sentence.
   * trim (tr) – removes leading/trailing whitespace from the block.
   * dedent (dd) – removes common indentation (like Python’s textwrap.dedent).
   * collapse_newlines (cnl) – squeezes multiple consecutive newlines into a single newline.
   * strip_punct (sp) – deletes all punctuation characters.
   * unescape_html (uneh) – decodes HTML entities (&amp;, &lt;, …).
   * list (cl) – converts the block into a clean list by removing empty lines and stripping leading spaces from each remaining line.
   * list_rtrim (clr) – converts the block into a clean list by removing empty lines and removing spaces to the left and right of each remaining line.
   * list_and (la) – converts a block to a comma-separated string of values and changes the last comma to `and`.

- Outputs:
   * compiled_prompt – the main prompt after processing placeholders, toggles, comments,
      spaceless blocks, additional formatting directives, and (if enabled) the extra block.
   * ❓help – this help text.
   * extra_compiled – the compiled result of only the [%extra%]…[%extra%] block. If the block is absent
      or the “Extra text active” toggle is off, an empty string is returned.

All other text remains unchanged in the compiled prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True}),
            },
            "hidden": {
                "cachedValues": ("STRING", {"default": "{}"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING",)
    RETURN_NAMES = ("compiled_prompt", "extra_compiled", "❓help",)
    OUTPUT_NODE = False


    # -------------------------------------------------------------------------
    # Utility static methods
    # -------------------------------------------------------------------------

    @staticmethod
    def _to_bool(value) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "+")

    # Mapping of tag aliases to the name of the static method that implements them
    _DIRECTIVE_FUNCS: Dict[str, Callable] = {
        "spaceless": directives.directive_spaceless,
        "sl": directives.directive_spaceless,
        "lower": directives.directive_lower,
        "lw": directives.directive_lower,
        "upper": directives.directive_upper,
        "up": directives.directive_upper,
        "title": directives.directive_title,
        "tl": directives.directive_title,
        "sentence": directives.directive_sentence,
        "snt": directives.directive_sentence,
        "trim": directives.directive_trim,
        "tr": directives.directive_trim,
        "dedent": directives.directive_dedent,
        "dd": directives.directive_dedent,
        "collapse_newlines": directives.directive_collapse_newlines,
        "cnl": directives.directive_collapse_newlines,
        "strip_punct": directives.directive_strip_punct,
        "sp": directives.directive_strip_punct,
        "unescape_html": directives.directive_unescape_html,
        "uneh": directives.directive_unescape_html,
        "list": directives.directive_list,
        "cl": directives.directive_list,
        "list_rtrim": directives.directive_list_right,
        "clr": directives.directive_list_right,
        "list_and": directives.directive_list_and,
        "la": directives.directive_list_and
    }

    @classmethod
    def _process_directives(cls, text: str) -> str:
        """
        Recursively process nested formatting directives.
        Finds the innermost directive block, applies its transformation,
        and replaces it with the result until no directives remain.
        """
        if not text:
            return text

        # Build a regex that matches any supported start tag
        tags_pattern = "|".join(map(re.escape, cls._DIRECTIVE_FUNCS.keys()))
        pattern = re.compile(r'\{%(' + tags_pattern + r')%\}([\s\S]*?)\{%\1 stop%\}')

        while True:
            match = pattern.search(text)
            if not match:
                break

            tag = match.group(1)
            inner = match.group(2)

            # Process any nested directives inside the block first
            processed_inner = cls._process_directives(inner)

            fun = cls._DIRECTIVE_FUNCS.get(tag)
            if callable(fun):
                result = getattr(cls, fun)(processed_inner)
            else:
                # Fallback – should never happen because of regex constraints
                result = processed_inner

            # Replace the whole directive block with its transformed content
            text = text[:match.start()] + result + text[match.end():]

        return text
    
    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs) -> bool:
        # bypass validation
        return True
    
    # -------------------------------------------------------------------------
    # Core build method
    # -------------------------------------------------------------------------
    
    def build_prompt(self, prompt: str, cachedValues: str = None, **kwargs) -> Tuple[str]:
        """
        Main entry point for the node.
        Returns (compiled_prompt, extra_compiled, help_text).
        """
        if cachedValues is None:
            cachedValues = "{}"
        
        # Reserved words
        COMPILED_PROMPT = "compiled_prompt"
        EXTRA_COMPILED = "extra_compiled"
        
        # Regex for placeholder syntax {{N:T:V:EV}}
        placeholder_pattern = re.compile(
            r"\{\{([^:{}]+):([^:{}]*):([^:{}]*):([^{}]*)\}\}"
        )
        placeholder_dup_pattern = re.compile(r"\{\{([^:{}]+)(:[^:{}]+)?\}\}")

        # Regex for toggle tag syntax with optional group: [[TAG]] or [[TAG:GROUP]]
        tag_pattern = re.compile(
            r'\[\[([^\]:/\[]+)(?::([^]\[]+))?\]\]([\s\S]*?)\[\[\/?\1\]\]',
            flags=re.MULTILINE
        )
        
        # Regex for toggle extra-block syntax [%extra%]...[%extra%]
        extra_block_pattern = re.compile(
            r'\[\%extra\%\]([\s\S]*?)\[\%\/?extra\%\]', flags=re.MULTILINE
        )
        
        # -----------------------------------------------------------------
        # Load cached values (widget states) and merge with any kwargs passed
        # -----------------------------------------------------------------
        try:
            _cachedValues = json.loads(cachedValues)
        except Exception as e:  # pragma: no cover
            _cachedValues = {}
            log.error(f"JSON parse error: {e}.")

        _cachedValues = {**_cachedValues, **kwargs}
        
        # -----------------------------------------------------------------
        # Removing reserved words
        # -----------------------------------------------------------------
        for _reserved_word in (COMPILED_PROMPT, EXTRA_COMPILED,):
            _cachedValues.pop(_reserved_word, "")

        # -----------------------------------------------------------------
        # Helper to apply toggle tags based on cached boolean values
        # -----------------------------------------------------------------
        def apply_tag_toggles(text: str, cache: dict) -> str:
            """Keep or discard sections wrapped in [[TAG]]...[[/TAG]]
            according to the boolean value of TAG in `cache` (default True)."""
            def repl(m):
                tag_name = m.group(1).strip()
                inner = m.group(3)
                val = cache.get(tag_name, True)

                enabled = self._to_bool(val)

                return inner if enabled else ""
            return tag_pattern.sub(repl, text)
            
        # -----------------------------------------------------------------
        # Strip comments before any further processing
        # -----------------------------------------------------------------
        prompt_clean = strip_all_comments(prompt)
        
        # -----------------------------------------------------------------
        # Extract optional extra block [%extra%]...[%extra%]
        # -----------------------------------------------------------------
        extra_match = extra_block_pattern.search(prompt_clean)
        if extra_match:
            extra_raw = extra_match.group(1)
            # Remove the whole block from the main prompt
            prompt_main = (
                prompt_clean[:extra_match.start()] + prompt_clean[extra_match.end():]
            )
        else:
            extra_raw = ""
            prompt_main = prompt_clean
        
        # -----------------------------------------------------------------
        # Apply toggle tags to the main prompt
        # -----------------------------------------------------------------
        prompt_processed = apply_tag_toggles(prompt_main, _cachedValues)

        # -----------------------------------------------------------------
        # Placeholder replacement helper
        # -----------------------------------------------------------------
        def replace_placeholder(match):
            name = match.group(1)
            return str(_cachedValues.get(name, ""))

        # -----------------------------------------------------------------
        # Build compiled_prompt (main) if the corresponding toggle is active
        # -----------------------------------------------------------------
        compiled_raw = placeholder_dup_pattern.sub(
                replace_placeholder,
                placeholder_pattern.sub(replace_placeholder, prompt_processed),
            )
        _cachedValues[COMPILED_PROMPT] = compiled_raw
        compiled_prompt_active = self._to_bool(_cachedValues.get("promptTextActive", False))
        if compiled_prompt_active:
            compiled_prompt = compiled_raw
        else:
            compiled_prompt = ""
        
        

        # -----------------------------------------------------------------
        # Build extra_compiled if the extra block exists and is active
        # -----------------------------------------------------------------
        extra_active = self._to_bool(_cachedValues.get("extraActive", False))
        if extra_raw and extra_active:
            extra_processed = apply_tag_toggles(extra_raw, _cachedValues)
            extra_compiled = placeholder_dup_pattern.sub(
                replace_placeholder,
                placeholder_pattern.sub(replace_placeholder, extra_processed),
            )
        else:
            extra_compiled = ""
            
        # -----------------------------------------------------------------
        # Apply nested formatting directives recursively
        # -----------------------------------------------------------------
        compiled_prompt = self._process_directives(compiled_prompt)
        extra_compiled = self._process_directives(extra_compiled)

        return (compiled_prompt, extra_compiled, self.HELP_TEXT,)
