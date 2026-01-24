from typing import Any, Dict, Tuple


class CustomCombo:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "list_selector": ("COMBO", {"default": "nope", "values": ["nope"]}),
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
        return (list_selector, self.HELP_TEXT)
