import json
import logging
from typing import Any, Dict, List, Tuple

from ..global_utils import (
    load_localized_help_text as localize_help_text,
    class_name_to_node_name as def_node_name,
)


log = logging.getLogger(__name__)


class MultiToggles:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {},
            "hidden": {
                "selected": ("STRING", {"default": "[]"}),
                "last_word": ("STRING", {"default": ""}),
                "delimiter": ("STRING", {"default": ", "}),
                "COMFY_LOCALE_SETTING": ("STRING", {})
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING",)    
    RETURN_NAMES = ("as_list", "as_string", "❓help",)
    FUNCTION = "select_active_toggles"         
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False   
    OUTPUT_IS_LIST = (True, False, False,)
    
    HELP_TEXT = """MultiToggles node:
- Outputs:
  1. **as_list** – the list of selected toggle values.
  2. **as_string** – a human-readable string joining the selections using `delimiter`. If `last_word` is set and more than one item is selected, it inserts `last_word` before the final element (e.g., “a, b, and c”).
  3. **❓help** – this help description.

UI configuration (via node PROPERTIES):
- **text_for_toggles** – defines toggle options as a semicolon (`;`) or pipe (`|`) separated list of labels, optionally using `label::value` pairs.
- **is_radio_toggles** – when enabled, toggles behave like radio buttons (only one can be active).
- **trim_values** – trims whitespace from toggle values before processing.
- **last_word** – custom word inserted before the last item in the joined string.
- **delimiter** – string used to join items (default “, ”)."""

    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs) -> bool:
        # bypass validation
        return True

    def select_active_toggles(self, selected: str = None, last_word: str = None, delimiter: str = None, **kwargs) -> Tuple[int]:
        if selected is None:
            selected = "[]"
            
        try:
            selected_list: List[str] = json.loads(selected)
        except Exception as e:
            log.error("[darkilNodes.MultiToggles] `selected` parsing error:", e)
            selected_list = []
            
        delimiter = ", " if delimiter is None else delimiter
        
        last_word = "" if last_word is None else last_word
        
        delimiter = delimiter.replace("\\\\n", "\n").replace("\\n", "\n")
        
        if last_word and selected_list and len(selected_list) > 1:
            selected_string = delimiter.join(selected_list[:len(selected_list)-1]) + f" {last_word} {selected_list[-1]}"
        else:
            selected_string = delimiter.join(selected_list)
        
        _help_text = localize_help_text(
            def_node_name(MultiToggles),
            default=MultiToggles.HELP_TEXT,
            locale_str=kwargs.get("COMFY_LOCALE_SETTING", "en")
        )
            
        return (selected_list, selected_string, _help_text,)
