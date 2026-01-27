from typing import Any, Dict, Tuple

from ..global_utils import (
    load_localized_help_text as localize_help_text,
    class_name_to_node_name as def_node_name,
)


class CustomCombo:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "list_selector": ("COMBO", {"default": "nope", "values": ["nope"]}),
            },
            "hidden": {
                "COMFY_LOCALE_SETTING": ("STRING", {})
            },
        }

    RETURN_TYPES = ("STRING", "STRING",)    
    RETURN_NAMES = ("str_selected", "❓help",)
    FUNCTION = "select_from_list"         
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False   
    OUTPUT_IS_LIST = (False, False,)
    
    HELP_TEXT = """Select an option from a custom combo list defined in the node's PROPERTY `text_for_combo`. 
Use ';' or '|' to separate multiple items. The chosen value is output as `str_selected`, 
and this help text appears on the second output (`❓help`)."""

    @classmethod
    def VALIDATE_INPUTS(cls, *args, **kwargs) -> bool:
        return True

    def select_from_list(self, list_selector, *args, **kwargs) -> Tuple[str]:
        _help_text = localize_help_text(
            def_node_name(CustomCombo),
            default=CustomCombo.HELP_TEXT,
            locale_str=kwargs.get("COMFY_LOCALE_SETTING", "en")
        )
        
        return (list_selector, _help_text)
