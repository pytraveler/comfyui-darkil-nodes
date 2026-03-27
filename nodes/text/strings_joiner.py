import logging
from typing import Any, Dict, Tuple

from ..global_utils import (
    class_name_to_node_name as as_node_name,
    load_localized_help_text as localize_help_text,
)

log = logging.getLogger(__name__)


class StringsJoiner:
    DEFAULT_NODE_NAME = "StringsJoiner"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "joiner": ("STRING", {"default": ""}),
            },
            "optional": {},
            "hidden": {
                "COMFY_LOCALE_SETTING": ("STRING", {}),
                "OTHER_INPUT": ("STRING", {"default": "[]"})
            }
        }

    RETURN_TYPES: Tuple[str, ...] = ("STRING", "STRING",)
    RETURN_NAMES: Tuple[str, ...] = ("joined_text", "❓help",)
    FUNCTION: str = "join_strings"
    CATEGORY: str = "darkilNodes/text"
    OUTPUT_NODE: bool = False
    OUTPUT_IS_LIST: Tuple[bool, ...] = (False, False,)

    HELP_TEXT: str = (
        "Joins multiple text inputs with a specified separator (joiner). "
        "The joiner supports escape sequences: \\n for newline, \\t for tab. "
        "Empty or None values are filtered out before joining."
    )

    def join_strings(self, joiner: str, OTHER_INPUT: str = "[]", COMFY_LOCALE_SETTING: str = "en", **kwargs) -> Tuple[str]:
        """
        Join all DYNAMIC_* input strings with the specified joiner.

        Args:
            joiner: The separator string used to join texts (supports escape sequences)
            OTHER_INPUT: Hidden field required by ComfyUI for dynamic inputs
            COMFY_LOCALE_SETTING: Locale setting for localized help text
            **kwargs: All DYNAMIC_* input fields containing text to join

        Returns:
            Tuple containing joined string and localized help text
        """
        # Collect all DYNAMIC_* input values from kwargs
        values = []
        
        for key, value in kwargs.items():
            if key.startswith("DYNAMIC_") and value is not None:
                if isinstance(value, str) and value.strip():
                    values.append(self._process_escape_chars(value))

        # Process escape characters in joiner
        processed_joiner = self._process_escape_chars(joiner)

        # Join the filtered values
        joined_text = processed_joiner.join(values)

        log.debug(f"Joined {len(values)} strings with joiner '{repr(processed_joiner)}': {joined_text[:100]}...")
        
        _help_text = localize_help_text(
            as_node_name(StringsJoiner),
            default=StringsJoiner.HELP_TEXT,
            locale_str=COMFY_LOCALE_SETTING
        )
        
        return (joined_text, _help_text)

    def _process_escape_chars(self, text: str) -> str:
        """
        Convert escape sequence strings to actual control characters.
        
        Args:
            text: String potentially containing escape sequences like \\n, \\t
            
        Returns:
            String with actual control characters
        """
        if not text:
            return text
            
        result = text
        # Replace common escape sequences
        escape_map = {
            "\\n": "\n",
            "\\r": "\r",
            "\\t": "\t",
            "\\\\": "\\",
            "\\\"": "\"",
            "\\'": "'"
        }
        
        for escaped, char in escape_map.items():
            result = result.replace(escaped, char)
            
        return result


NODE_CLASS_MAPPINGS = {
    as_node_name(StringsJoiner): StringsJoiner,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    as_node_name(StringsJoiner): "Strings Joiner",
}