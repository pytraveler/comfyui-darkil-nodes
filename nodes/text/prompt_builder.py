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

    DEFAULT_NODE_NAME = "PromptBuilder"
    HELP_TEXT = """Prompt Writing Help:
- Placeholders: `{{NAME:TYPE:VALUE:DEFAULT:USE_INPUT}}` define dynamic values.
   * TYPE can be STRING, INT, FLOAT, COMBO, SLIDER, KNOB.
   * VALUE is the current value (or minimum for numeric types).
   * DEFAULT is the fallback value (or maximum for numeric types).
   * USE_INPUT (`true`/`false`, optional) creates an input socket for this placeholder when true; omit it to default to false.

- Toggle tags: `[[TAG]]...[[/TAG]]` or `[[TAG:GROUP]]...[[/TAG]]`.
   * When a tag evaluates to false the wrapped block is removed.
   * Tags sharing the same GROUP are mutually exclusive – enabling one disables the others.
   * Tags may be nested.

- Comments (ignored during processing):
   * `// line comment` (only when at the start of a line or after whitespace, so URLs like http://… stay intact)
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

All other text remains unchanged in the compiled output."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True}),
            },
            "hidden": {
                "cachedValues": ("STRING", {"default": "{}"}),
                "COMFY_LOCALE_SETTING": ("STRING", {})
            }
        }

    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("compiled_prompt", "extra_compiled",)
    OUTPUT_NODE = False

    @staticmethod
    def _to_bool(value) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "+")

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

    _DIRECTIVE_PATTERN = re.compile(
        r'\{%(' + "|".join(map(re.escape, sorted(_DIRECTIVE_FUNCS, key=len, reverse=True)))
        + r')%\}([\s\S]*?)\{%\1 stop%\}'
    )

    @classmethod
    def _process_directives(cls, text: str) -> str:
        if not text:
            return text

        pattern = cls._DIRECTIVE_PATTERN

        while True:
            match = pattern.search(text)
            if not match:
                break

            tag = match.group(1)
            inner = match.group(2)

            processed_inner = cls._process_directives(inner)

            fun = cls._DIRECTIVE_FUNCS.get(tag)
            result = fun(processed_inner) if callable(fun) else processed_inner

            text = text[:match.start()] + result + text[match.end():]

        return text

    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs) -> bool:
        return True

    def build_prompt(self, prompt: str, cachedValues: str = None, **kwargs) -> Tuple[str, str, str]:
        if cachedValues is None:
            cachedValues = "{}"

        COMPILED_PROMPT = "compiled_prompt"
        EXTRA_COMPILED = "extra_compiled"

        placeholder_pattern = re.compile(
            r"\{\{([^:{}]+):([^:{}]*):([^:{}]*):([^{}]*)\}\}"
        )
        placeholder_dup_pattern = re.compile(r"\{\{([^:{}]+)(:[^:{}]+)?\}\}")

        tag_pattern = re.compile(
            r'\[\[([^\]:/\[]+)(?::([^]\[]+))?\]\]([\s\S]*?)\[\[\/?\1\]\]',
            flags=re.MULTILINE
        )
        group_open_pattern = re.compile(r'\[\[([^\]:/\[]+):([^]\[]+)\]\]')

        extra_block_pattern = re.compile(
            r'\[\%extra\%\]([\s\S]*?)\[\%\/?extra\%\]', flags=re.MULTILINE
        )
        vars_block_pattern = re.compile(
            r'\[\%vars\%\]([\s\S]*?)\[\%\/?vars\%\]', flags=re.MULTILINE
        )

        try:
            _cachedValues = json.loads(cachedValues)
        except Exception as e:
            _cachedValues = {}
            log.error(f"[darkilNodes.SimplePromptBuilder] JSON parse error: {e}.")

        _cachedValues = {**_cachedValues, **kwargs}

        for _reserved_word in (COMPILED_PROMPT, EXTRA_COMPILED,):
            _cachedValues.pop(_reserved_word, "")

        prompt_clean = strip_all_comments(prompt)

        var_match = vars_block_pattern.search(prompt_clean)
        if var_match:
            prompt_without_vars = (
                prompt_clean[:var_match.start()] + prompt_clean[var_match.end():]
            )
        else:
            prompt_without_vars = prompt_clean

        extra_match = extra_block_pattern.search(prompt_without_vars)
        if extra_match:
            extra_raw = extra_match.group(1)
            prompt_main = (
                prompt_without_vars[:extra_match.start()] + prompt_without_vars[extra_match.end():]
            )
        else:
            extra_raw = ""
            prompt_main = prompt_without_vars

        def resolve_group_exclusivity(text: str, cache: dict) -> dict:
            resolved = dict(cache)
            seen: Dict[str, str] = {}
            for m in group_open_pattern.finditer(text):
                name = m.group(1).strip()
                group = m.group(2).strip()
                if not self._to_bool(resolved.get(name, True)):
                    continue
                if group in seen:
                    resolved[name] = False
                else:
                    seen[group] = name
            return resolved

        def apply_tag_toggles(text: str, cache: dict) -> str:
            def repl(m):
                tag_name = m.group(1).strip()
                inner = m.group(3)
                return inner if self._to_bool(cache.get(tag_name, True)) else ""

            prev = None
            while prev != text:
                prev = text
                text = tag_pattern.sub(repl, text)
            return text

        def replace_placeholder(match):
            name = match.group(1).strip()
            if name in _cachedValues:
                return str(_cachedValues[name])
            groups = match.groups()
            if len(groups) >= 4:
                value = (groups[2] or "").strip()
                default = (groups[3] or "").strip()
                return value or default
            return ""

        resolved_main = resolve_group_exclusivity(prompt_main, _cachedValues)
        prompt_processed = apply_tag_toggles(prompt_main, resolved_main)

        compiled_raw = placeholder_dup_pattern.sub(
            replace_placeholder,
            placeholder_pattern.sub(replace_placeholder, prompt_processed),
        )
        compiled_prompt_active = self._to_bool(_cachedValues.get("promptTextActive", False))
        compiled_prompt = compiled_raw if compiled_prompt_active else ""

        extra_active = self._to_bool(_cachedValues.get("extraActive", False))
        if extra_raw and extra_active:
            resolved_extra = resolve_group_exclusivity(extra_raw, _cachedValues)
            extra_processed = apply_tag_toggles(extra_raw, resolved_extra)
            extra_compiled = placeholder_dup_pattern.sub(
                replace_placeholder,
                placeholder_pattern.sub(replace_placeholder, extra_processed),
            )
        else:
            extra_compiled = ""

        compiled_prompt = self._process_directives(compiled_prompt)
        extra_compiled = self._process_directives(extra_compiled)

        return (compiled_prompt, extra_compiled,)
