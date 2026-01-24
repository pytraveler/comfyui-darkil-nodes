import json
import logging
import re
from typing import Callable, Dict, Tuple

from .directives import *
from .utilities import (
    strip_all_comments,
)


log = logging.getLogger(__name__)


class SimplePromptBuilder:
    CATEGORY = "darkilNodes/text"
    FUNCTION = "build_prompt"
    
    HELP_TEXT = """Prompt Writing Help:
- Placeholders: `{{NAME:TYPE:VALUE:DEFAULT:USE_INPUT}}` define dynamic values.
   * TYPE can be STRING, INT, FLOAT, COMBO, SLIDER, KNOB.
   * VALUE is the current value (or minimum for numeric types).
   * DEFAULT is the fallback value (or maximum for numeric types).
   * USE_INPUT (`true`/`false`) creates an input socket for this placeholder when true.

- Toggle tags: `[[TAG]]...[[/TAG]]` or `[[TAG:GROUP]]...[[/TAG]]`.
   * When a tag evaluates to false the wrapped block is removed.
   * Tags sharing the same GROUP are mutually exclusive – enabling one disables the others.

- Comments (ignored during processing):
   * `// line comment`
   * `# line comment`
   * `/* multi-line comment */`

- Optional extra block: `[%extra%]...[%/extra%]`.
   * When present a toggle widget “Extra text active” appears.
   * If the toggle is enabled, the block is processed exactly like the main prompt (placeholders, toggles, directives).

- Optional variables block: `[%vars%]...[%/vars%]` - ignored on backend. 

- Spaceless blocks:
   * `{%spaceless%}…{%spaceless stop%}` or short form `{%sl%}…{%sl stop%}`
   * All excess whitespace (spaces, newlines, tabs) inside the block is collapsed to a single space and trimmed.

- Formatting directives (can be nested):
   * `lower` (`lw`) – convert text to lowercase.
   * `upper` (`up`) – convert text to uppercase.
   * `title` (`tl`) – Title-Case each word.
   * `sentence` (`snt`) – capitalise the first character of each sentence.
   * `trim` (`tr`) – remove leading/trailing whitespace.
   * `dedent` (`dd`) – remove common indentation (like Python’s textwrap.dedent).
   * `collapse_newlines` (`cnl`) – squeeze multiple consecutive newlines into one.
   * `strip_punct` (`sp`) – delete all punctuation characters.
   * `unescape_html` (`uneh`) – decode HTML entities (&amp;, &lt;, …).
   * `list` (`cl`) – clean list: remove empty lines and strip leading spaces.
   * `list_rtrim` (`clr`) – clean list and trim both sides of each line.
   * `list_and` (`la`) – convert a list to a comma-separated string, changing the last comma to “and”.

- UI Toggles (client-side only):
   * **Prompt enabled** – disables all processing of the main prompt when off.
   * **Extra enabled** – controls whether the extra block is processed.
   * **Main Prompt visible** – hides/shows the prompt input widget.

- Outputs:
   * `compiled_prompt` – the processed main prompt (empty if disabled).
   * `extra_compiled` – the processed extra block (empty if absent or disabled).
   * `❓help` – this help text.

All other text remains unchanged in the compiled output."""

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
        "spaceless": directive_spaceless,
        "sl": directive_spaceless,
        "lower": directive_lower,
        "lw": directive_lower,
        "upper": directive_upper,
        "up": directive_upper,
        "title": directive_title,
        "tl": directive_title,
        "sentence": directive_sentence,
        "snt": directive_sentence,
        "trim": directive_trim,
        "tr": directive_trim,
        "dedent": directive_dedent,
        "dd": directive_dedent,
        "collapse_newlines": directive_collapse_newlines,
        "cnl": directive_collapse_newlines,
        "strip_punct": directive_strip_punct,
        "sp": directive_strip_punct,
        "unescape_html": directive_unescape_html,
        "uneh": directive_unescape_html,
        "list": directive_list,
        "cl": directive_list,
        "list_rtrim": directive_list_right,
        "clr": directive_list_right,
        "list_and": directive_list_and,
        "la": directive_list_and
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
                result = fun(processed_inner)
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
        
        # Regex for vars block: [%vars%]...[%/vars%] – ignored on backend
        vars_block_pattern = re.compile(
            r'\[\%vars\%\]([\s\S]*?)\[\%\/?vars\%\]', flags=re.MULTILINE
        )
        
        # -----------------------------------------------------------------
        # Load cached values (widget states) and merge with any kwargs passed
        # -----------------------------------------------------------------
        try:
            _cachedValues = json.loads(cachedValues)
        except Exception as e:  # pragma: no cover
            _cachedValues = {}
            log.error(f"[darkilNodes.SimplePromptBuilder] JSON parse error: {e}.")

        _cachedValues = {**_cachedValues, **kwargs}
        
        # -----------------------------------------------------------------
        # Removing reserved words
        # -----------------------------------------------------------------
        for _reserved_word in (COMPILED_PROMPT, EXTRA_COMPILED,):
            _cachedValues.pop(_reserved_word, "")

        # -----------------------------------------------------------------
        # Strip comments before any further processing
        # -----------------------------------------------------------------
        prompt_clean = strip_all_comments(prompt)
        
        # -----------------------------------------------------------------
        # Remove [%vars%]...[%/vars%] block – ignored on backend
        # -----------------------------------------------------------------
        var_match = vars_block_pattern.search(prompt_clean)
        if var_match:
            # The content is completely ignored; remove it from the prompt.
            prompt_without_vars = (
                prompt_clean[:var_match.start()] + prompt_clean[var_match.end():]
            )
        else:
            prompt_without_vars = prompt_clean
        
        # -----------------------------------------------------------------
        # Extract optional extra block [%extra%]...[%extra%]
        # -----------------------------------------------------------------
        extra_match = extra_block_pattern.search(prompt_without_vars)
        if extra_match:
            extra_raw = extra_match.group(1)
            # Remove the whole block from the main prompt
            prompt_main = (
                prompt_without_vars[:extra_match.start()] + prompt_without_vars[extra_match.end():]
            )
        else:
            extra_raw = ""
            prompt_main = prompt_without_vars
        
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
