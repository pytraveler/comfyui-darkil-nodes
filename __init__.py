from .nodes.global_utils import class_name_to_node_name as as_node_name

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

from .nodes.lora.wan22_lora_list_builder import Wan22VideoLoraListBuilder

from .nodes.files.files_list import FilesList


NODE_CLASS_MAPPINGS = {
    # TEXTS
    as_node_name(TextVariableBuilder): TextVariableBuilder,
    as_node_name(AdvancedVariableBuilder): AdvancedVariableBuilder,
    as_node_name(SimplePromptBuilder): SimplePromptBuilder,
    as_node_name(TextIsEmpty): TextIsEmpty,
    as_node_name(TextNotEmpty): TextNotEmpty,
    as_node_name(TextLinesCount): TextLinesCount,
    
    # LOGIC
    as_node_name(MultiToggles): MultiToggles,
    as_node_name(CustomCombo): CustomCombo,
    
    # LORA
    as_node_name(Wan22VideoLoraListBuilder): Wan22VideoLoraListBuilder,
    
    # FILES
    as_node_name(FilesList): FilesList,
}


NODE_DISPLAY_NAME_MAPPINGS = {
    # TEXTS
    as_node_name(TextVariableBuilder): "Variable builder [darkilNodes]",
    as_node_name(AdvancedVariableBuilder): "Advanced variable builder [darkilNodes]",
    as_node_name(SimplePromptBuilder): "Dynamic prompt builder [darkilNodes]",
    as_node_name(TextIsEmpty): "Text is empty [darkilNodes]",
    as_node_name(TextNotEmpty): "Text not empty [darkilNodes]",
    as_node_name(TextLinesCount): "Text lines count [darkilNodes]",
    
    # LOGIC
    as_node_name(MultiToggles): "Multi toggles [darkilNodes]",
    as_node_name(CustomCombo): "Custom combo box [darkilNodes]",

    # LORA
    as_node_name(Wan22VideoLoraListBuilder): "LoRA list for WanVideoWrapper by Kijai [darkilNodes]",
    
    # FILES
    as_node_name(FilesList): "Files list from dir [darkilNodes]",
}

WEB_DIRECTORY = "./web/js"


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
