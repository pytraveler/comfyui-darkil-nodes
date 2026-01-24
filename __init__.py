from .nodes.text.variable_builder import TextVariableBuilder
from .nodes.text.advanced_variable_builder import AdvancedVariableBuilder
from .nodes.text.prompt_builder import SimplePromptBuilder
from .nodes.text.simple import (
    TextIsEmpty,
    TextNotEmpty,
    TextLinesCount,
)
from .nodes.logic.multi_toggles import MultiToggles
from .nodes.logic.custom_combo import CustomCombo


NODE_CLASS_MAPPINGS = {
    # TEXTS
    "darkilTextVariableBuilder": TextVariableBuilder,
    "darkilAdvancedVariableBuilder": AdvancedVariableBuilder,
    "darkilPromptBuilder": SimplePromptBuilder,
    "darkilTextIsEmpty": TextIsEmpty,
    "darkilTextNotEmpty": TextNotEmpty,
    "darkilTextLinesCount": TextLinesCount,
    
    # LOGIC
    "darkilMultiToggles": MultiToggles,
    "darkilCustomCombo": CustomCombo,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    # TEXTS
    "darkilTextVariableBuilder": "Variable builder [darkilNodes]",
    "darkilAdvancedVariableBuilder": "Advanced variable builder [darkilNodes]",
    "darkilPromptBuilder": "Dynamic prompt builder [darkilNodes]",
    "darkilTextIsEmpty": "Text is empty [darkilNodes]",
    "darkilTextNotEmpty": "Text not empty [darkilNodes]",
    "darkilTextLinesCount": "Text lines count [darkilNodes]",
    
    # LOGIC
    "darkilMultiToggles": "Multi toggles [darkilNodes]",
    "darkilCustomCombo": "Custom combo box [darkilNodes]",

}


WEB_DIRECTORY = "./web/js"


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
