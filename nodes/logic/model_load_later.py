import logging
import torch

import folder_paths                                      # ComfyUI imports
import comfy.sd                                          # ComfyUI imports
from comfy import model_management                       # ComfyUI imports
from comfy.comfy_types.node_typing import IO             # ComfyUI imports
from nodes import CLIPLoader, DualCLIPLoader, VAELoader  # ComfyUI imports


log = logging.getLogger(__name__)


def clean_memory(empty_cache, gc_collect, unload_models):
    if empty_cache:
            model_management.soft_empty_cache()
    if unload_models:
        model_management.unload_all_models()
    if gc_collect:
        import gc
        gc.collect()


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
            
        clean_memory(empty_cache, gc_collect, unload_models)

        unet_path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        model = comfy.sd.load_diffusion_model(unet_path, model_options=model_options)
        return (model,)


def _get_legacy_input_types_with_trigger(klass):
    legacy_input_types_fun = getattr(klass, "INPUT_TYPES", None)
    legacy_input_types = legacy_input_types_fun() if callable(legacy_input_types_fun) else {}
    if not legacy_input_types.get("required", None):
        legacy_input_types["required"] = {}
    _ = {"any_trigger": (IO.ANY,)}
    _.update(legacy_input_types["required"])
    legacy_input_types["required"] = _
    return legacy_input_types


class CLIPLoaderLater(CLIPLoader):
    @classmethod
    def INPUT_TYPES(s):
        return _get_legacy_input_types_with_trigger(CLIPLoader)
    
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False  


    def load_clip(self, any_trigger, *args, **kwargs):
        return super().load_clip(*args, **kwargs)
    
    
class DualCLIPLoaderLater(DualCLIPLoader):
    @classmethod
    def INPUT_TYPES(s):
        return _get_legacy_input_types_with_trigger(DualCLIPLoader)
    
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False  
    
    def load_clip(self, any_trigger, *args, **kwargs):
        return super().load_clip(*args, **kwargs)


class VAELoaderLater(VAELoader):
    @classmethod
    def INPUT_TYPES(s):
        return _get_legacy_input_types_with_trigger(VAELoader)
    
    CATEGORY = "darkilNodes/logic"
    OUTPUT_NODE = False  


    def load_vae(self, any_trigger, *args, **kwargs):
        return super().load_vae(*args, **kwargs)
