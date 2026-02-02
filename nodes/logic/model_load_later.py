import logging
import torch

import folder_paths                           # ComfyUI imports
import comfy.sd                               # ComfyUI imports
from comfy import model_management            # ComfyUI imports
from comfy.comfy_types.node_typing import IO  # ComfyUI imports


log = logging.getLogger(__name__)


class UNETLoaderLater:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": { 
                    "any_trigger": (IO.ANY,),
                    "unet_name": (folder_paths.get_filename_list("diffusion_models"), ), 
                    "weight_dtype": (["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],),
                    "empty_cache": (IO.BOOLEAN, {"default": False}),
                    "gc_collect": (IO.BOOLEAN, {"default": False}),
                    "unload_models": (IO.BOOLEAN, {"default": False}),
                }
            }
    
    DEFAULT_NODE_NAME = "DiffusionModelLoaderLater" 
    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet_later"
    RETURN_NAMES = ("as_list", "as_string", "❓help",)
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False  

    def load_unet_later(self, any_trigger,  unet_name, weight_dtype,
                        empty_cache, gc_collect, unload_models):
        
        log.warning(f"[darkilNodes.UNETLoaderLater] Model 'unet_name' loading now...")
        
        model_options = {}
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2
            
        if empty_cache:
            model_management.soft_empty_cache()
        if unload_models:
            model_management.unload_all_models()
        if gc_collect:
            import gc
            gc.collect()

        unet_path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        model = comfy.sd.load_diffusion_model(unet_path, model_options=model_options)
        return (model,)
