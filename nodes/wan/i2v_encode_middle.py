import gc
import logging
from typing import Any, Dict

import torch

from comfy import model_management as mm
from comfy.utils import common_upscale

from ..global_utils import (
    load_localized_help_text as localize_help_text,
    class_name_to_node_name as def_node_name,
)

log = logging.getLogger(__name__)

device = mm.get_torch_device()
offload_device = mm.unet_offload_device()

PATCH_SIZE = (1, 2, 2)


def _add_noise_to_reference_video(image, ratio=None):
    sigma = torch.ones((image.shape[0],)).to(image.device, image.dtype) * ratio
    image_noise = torch.randn_like(image) * sigma[:, None, None, None]
    image_noise = torch.where(image == -1, torch.zeros_like(image), image_noise)
    return image + image_noise


class WanVideoI2VEncodeMiddle:

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "width": ("INT", {"default": 832, "min": 64, "max": 8096, "step": 8, "tooltip": "Width of the image to encode"}),
                "height": ("INT", {"default": 480, "min": 64, "max": 8096, "step": 8, "tooltip": "Height of the image to encode"}),
                "num_frames": ("INT", {"default": 81, "min": 1, "max": 10000, "step": 4, "tooltip": "Number of frames to encode"}),
                "noise_aug_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.001, "tooltip": "Strength of noise augmentation, helpful for I2V where some noise can add motion and give sharper results"}),
                "start_latent_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.001, "tooltip": "Additional latent multiplier for the start frame, helpful for I2V where lower values allow for more motion"}),
                "end_latent_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.001, "tooltip": "Additional latent multiplier for the end frame, helpful for I2V where lower values allow for more motion"}),
                "middle_latent_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.001, "tooltip": "Additional latent multiplier for the middle frame"}),
                "middle_frame_ratio": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Position of the middle frame as a ratio of total frames (0.0 = start, 1.0 = end)"}),
                "force_offload": ("BOOLEAN", {"default": True}),
                "motion_amplitude": ("FLOAT", {"default": 1.0, "min": 1.0, "max": 2.0, "step": 0.05, "tooltip": "Motion amplitude multiplier, >1.0 enhances motion reducing slow motion, 1.0=disabled"}),
            },
            "optional": {
                "vae": ("WANVAE",),
                "clip_embeds": ("WANVIDIMAGE_CLIPEMBEDS", {"tooltip": "Clip vision encoded image"}),
                "start_image": ("IMAGE", {"tooltip": "Image to encode"}),
                "middle_image": ("IMAGE", {"tooltip": "Middle frame image"}),
                "end_image": ("IMAGE", {"tooltip": "End frame"}),
                "control_embeds": ("WANVIDIMAGE_EMBEDS", {"tooltip": "Control signal for the Fun -model"}),
                "fun_or_fl2v_model": ("BOOLEAN", {"default": True, "tooltip": "Enable when using official FLF2V or Fun model"}),
                "temporal_mask": ("MASK", {"tooltip": "mask"}),
                "extra_latents": ("LATENT", {"tooltip": "Extra latents to add to the input front, used for Skyreels A2 reference images"}),
                "tiled_vae": ("BOOLEAN", {"default": False, "tooltip": "Use tiled VAE encoding for reduced memory use"}),
                "add_cond_latents": ("ADD_COND_LATENTS", {"advanced": True, "tooltip": "Additional cond latents WIP"}),
                "augment_empty_frames": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.01, "tooltip": "EXPERIMENTAL: Augment empty frames with the difference to the start image to force more motion"}),
                "empty_frame_pad_image": ("IMAGE", {"tooltip": "Use this image to pad empty frames instead of gray, used with SVI-shot and SVI 2.0 LoRAs"}),
            },
            "hidden": {
                "COMFY_LOCALE_SETTING": ("STRING", {}),
            },
        }

    RETURN_TYPES = ("WANVIDIMAGE_EMBEDS",)
    RETURN_NAMES = ("image_embeds",)
    FUNCTION = "process"
    CATEGORY = "darkilNodes/wan"
    OUTPUT_NODE = False

    HELP_TEXT = """Clone of WanVideoWrapper's 'WanVideo ImageToVideo Encode' with added middle frame support.

Accepts start_image, middle_image (optional), and end_image (optional).
The middle_image is placed at the position determined by middle_frame_ratio (0.0-1.0).
middle_latent_strength controls the conditioning strength of the middle frame in latent space.

motion_amplitude (>1.0) enhances inter-frame motion by scaling centered latent differences
from the first frame while preserving overall brightness. 1.0 = disabled.

Requires ComfyUI-WanVideoWrapper (uses WANVAE type)."""

    @staticmethod
    def _calculate_aligned_position(ratio, total_frames):
        desired_idx = int(total_frames * ratio)
        aligned_idx = (desired_idx // 4) * 4
        aligned_idx = max(4, min(aligned_idx, total_frames - 5))
        return aligned_idx

    def process(
        self,
        width,
        height,
        num_frames,
        noise_aug_strength,
        start_latent_strength,
        end_latent_strength,
        middle_latent_strength,
        middle_frame_ratio,
        force_offload,
        motion_amplitude=1.0,
        start_image=None,
        middle_image=None,
        end_image=None,
        control_embeds=None,
        fun_or_fl2v_model=False,
        temporal_mask=None,
        extra_latents=None,
        clip_embeds=None,
        tiled_vae=False,
        add_cond_latents=None,
        vae=None,
        augment_empty_frames=0.0,
        empty_frame_pad_image=None,
        **kwargs,
    ):

        if vae is None:
            raise ValueError("VAE is required for image encoding.")

        H = height
        W = width

        lat_h = H // vae.upsampling_factor
        lat_w = W // vae.upsampling_factor

        num_frames = ((num_frames - 1) // 4) * 4 + 1
        two_ref_images = start_image is not None and end_image is not None

        if start_image is None and end_image is not None:
            fun_or_fl2v_model = True

        base_frames = num_frames + (1 if two_ref_images and not fun_or_fl2v_model else 0)

        middle_idx = None
        resized_middle_image = None
        if middle_image is not None:
            middle_idx = self._calculate_aligned_position(middle_frame_ratio, base_frames)
            middle_idx = min(middle_idx, base_frames - 1)

        if temporal_mask is None:
            mask = torch.zeros(1, base_frames, lat_h, lat_w, device=device, dtype=vae.dtype)
            if start_image is not None:
                mask[:, 0:start_image.shape[0]] = 1
            if end_image is not None:
                mask[:, -end_image.shape[0]:] = 1
            if middle_idx is not None:
                mask[:, middle_idx:middle_idx + 1] = 1
        else:
            mask = common_upscale(
                temporal_mask.unsqueeze(1).to(device), lat_w, lat_h, "nearest", "disabled"
            ).squeeze(1)
            if mask.shape[0] > base_frames:
                mask = mask[:base_frames]
            elif mask.shape[0] < base_frames:
                mask = torch.cat(
                    [mask, torch.zeros(base_frames - mask.shape[0], lat_h, lat_w, device=device)]
                )
            mask = mask.unsqueeze(0).to(device, vae.dtype)

        pixel_mask = mask.clone()

        start_mask_repeated = torch.repeat_interleave(mask[:, 0:1], repeats=4, dim=1)
        if end_image is not None and not fun_or_fl2v_model:
            end_mask_repeated = torch.repeat_interleave(mask[:, -1:], repeats=4, dim=1)
            mask = torch.cat([start_mask_repeated, mask[:, 1:-1], end_mask_repeated], dim=1)
        else:
            mask = torch.cat([start_mask_repeated, mask[:, 1:]], dim=1)

        mask = mask.view(1, mask.shape[1] // 4, 4, lat_h, lat_w)
        mask = mask.movedim(1, 2)[0]

        if start_image is not None:
            start_image = start_image[..., :3]
            if start_image.shape[1] != H or start_image.shape[2] != W:
                resized_start_image = common_upscale(
                    start_image.movedim(-1, 1), W, H, "lanczos", "disabled"
                ).movedim(0, 1)
            else:
                resized_start_image = start_image.permute(3, 0, 1, 2)
            resized_start_image = resized_start_image * 2 - 1
            if noise_aug_strength > 0.0:
                resized_start_image = _add_noise_to_reference_video(
                    resized_start_image, ratio=noise_aug_strength
                )

        if end_image is not None:
            end_image = end_image[..., :3]
            if end_image.shape[1] != H or end_image.shape[2] != W:
                resized_end_image = common_upscale(
                    end_image.movedim(-1, 1), W, H, "lanczos", "disabled"
                ).movedim(0, 1)
            else:
                resized_end_image = end_image.permute(3, 0, 1, 2)
            resized_end_image = resized_end_image * 2 - 1
            if noise_aug_strength > 0.0:
                resized_end_image = _add_noise_to_reference_video(
                    resized_end_image, ratio=noise_aug_strength
                )

        if middle_image is not None:
            middle_image = middle_image[..., :3]
            if middle_image.shape[1] != H or middle_image.shape[2] != W:
                resized_middle_image = common_upscale(
                    middle_image[:1].movedim(-1, 1), W, H, "lanczos", "disabled"
                ).movedim(0, 1)
            else:
                resized_middle_image = middle_image[:1].permute(3, 0, 1, 2)
            resized_middle_image = resized_middle_image * 2 - 1
            if noise_aug_strength > 0.0:
                resized_middle_image = _add_noise_to_reference_video(
                    resized_middle_image, ratio=noise_aug_strength
                )

        if start_image is not None and end_image is None:
            zero_frames = torch.zeros(
                3, num_frames - start_image.shape[0], H, W, device=device, dtype=vae.dtype
            )
            concatenated = torch.cat(
                [resized_start_image.to(device, dtype=vae.dtype), zero_frames], dim=1
            )
            del resized_start_image, zero_frames
        elif start_image is None and end_image is not None:
            zero_frames = torch.zeros(
                3, num_frames - end_image.shape[0], H, W, device=device, dtype=vae.dtype
            )
            concatenated = torch.cat(
                [zero_frames, resized_end_image.to(device, dtype=vae.dtype)], dim=1
            )
            del zero_frames
        elif start_image is None and end_image is None:
            concatenated = torch.zeros(3, num_frames, H, W, device=device, dtype=vae.dtype)
        else:
            if fun_or_fl2v_model:
                zero_frames = torch.zeros(
                    3,
                    num_frames - (start_image.shape[0] + end_image.shape[0]),
                    H,
                    W,
                    device=device,
                    dtype=vae.dtype,
                )
            else:
                zero_frames = torch.zeros(3, num_frames - 1, H, W, device=device, dtype=vae.dtype)
            concatenated = torch.cat(
                [
                    resized_start_image.to(device, dtype=vae.dtype),
                    zero_frames,
                    resized_end_image.to(device, dtype=vae.dtype),
                ],
                dim=1,
            )
            del resized_start_image, zero_frames

        if resized_middle_image is not None and middle_idx is not None:
            pixel_mid_idx = min(middle_idx, concatenated.shape[1] - 1)
            concatenated[:, pixel_mid_idx:pixel_mid_idx + 1] = resized_middle_image.to(
                device, dtype=vae.dtype
            )
            del resized_middle_image

        if empty_frame_pad_image is not None:
            pad_img = empty_frame_pad_image.clone()[..., :3]
            if pad_img.shape[1] != H or pad_img.shape[2] != W:
                pad_img = common_upscale(
                    pad_img.movedim(-1, 1), W, H, "lanczos", "disabled"
                ).movedim(1, -1)
            pad_img = (pad_img.movedim(-1, 0) * 2 - 1).to(device, dtype=vae.dtype)

            num_pad_frames = pad_img.shape[1]
            num_target_frames = concatenated.shape[1]
            if num_pad_frames < num_target_frames:
                pad_img = torch.cat(
                    [pad_img, pad_img[:, -1:].expand(-1, num_target_frames - num_pad_frames, -1, -1)],
                    dim=1,
                )
            else:
                pad_img = pad_img[:, :num_target_frames]

            frame_is_empty = (pixel_mask[0].mean(dim=(-2, -1)) < 0.5)[
                : concatenated.shape[1]
            ].clone()
            if start_image is not None:
                frame_is_empty[: start_image.shape[0]] = False
            if end_image is not None:
                frame_is_empty[-end_image.shape[0] :] = False
            if middle_idx is not None:
                mid_pixel = min(middle_idx, frame_is_empty.shape[0] - 1)
                frame_is_empty[mid_pixel:mid_pixel + 1] = False

            concatenated[:, frame_is_empty] = pad_img[:, frame_is_empty]

        mm.soft_empty_cache()
        gc.collect()

        vae.to(device)
        y = vae.encode(
            [concatenated],
            device,
            end_=(end_image is not None and not fun_or_fl2v_model),
            tiled=tiled_vae,
        )[0]
        del concatenated

        has_ref = False
        if extra_latents is not None:
            samples = extra_latents["samples"].squeeze(0)
            y = torch.cat([samples, y], dim=1)
            mask = torch.cat([torch.ones_like(mask[:, 0 : samples.shape[1]]), mask], dim=1)
            num_frames += samples.shape[1] * 4
            has_ref = True

        y[:, :1] *= start_latent_strength
        y[:, -1:] *= end_latent_strength

        if middle_idx is not None:
            latent_middle_idx = middle_idx // 4
            latent_middle_idx = min(latent_middle_idx, y.shape[1] - 1)
            y[:, latent_middle_idx:latent_middle_idx + 1] *= middle_latent_strength

        if augment_empty_frames > 0.0:
            frame_is_empty = (mask[0].mean(dim=(-2, -1)) < 0.5).view(1, -1, 1, 1)
            y = y[:, :1] + (y - y[:, :1]) * (
                (augment_empty_frames + 1) * frame_is_empty + ~frame_is_empty
            )

        if motion_amplitude > 1.0 and y.shape[1] > 1:
            base_latent = y[:, 0:1]
            other_latent = y[:, 1:]
            base_latent_bc = base_latent.expand(-1, other_latent.shape[1], -1, -1)
            diff = other_latent - base_latent_bc
            diff_mean = diff.mean(dim=(0, 2, 3), keepdim=True)
            diff_centered = diff - diff_mean
            scaled_other = base_latent_bc + diff_centered * motion_amplitude + diff_mean
            scaled_other = torch.clamp(scaled_other, -6, 6)
            y = torch.cat([base_latent, scaled_other], dim=1)

        patches_per_frame = lat_h * lat_w // (PATCH_SIZE[1] * PATCH_SIZE[2])
        frames_per_stride = (num_frames - 1) // 4 + (
            2 if end_image is not None and not fun_or_fl2v_model else 1
        )
        max_seq_len = frames_per_stride * patches_per_frame

        if add_cond_latents is not None:
            add_cond_latents["ref_latent_neg"] = vae.encode(
                torch.zeros(1, 3, 1, H, W, device=device, dtype=vae.dtype), device
            )

        if force_offload:
            vae.model.to(offload_device)
            mm.soft_empty_cache()
            gc.collect()

        image_embeds = {
            "image_embeds": y.cpu(),
            "clip_context": (
                clip_embeds.get("clip_embeds", None) if clip_embeds is not None else None
            ),
            "negative_clip_context": (
                clip_embeds.get("negative_clip_embeds", None)
                if clip_embeds is not None
                else None
            ),
            "max_seq_len": max_seq_len,
            "num_frames": num_frames,
            "lat_h": lat_h,
            "lat_w": lat_w,
            "control_embeds": (
                control_embeds["control_embeds"] if control_embeds is not None else None
            ),
            "end_image": resized_end_image if end_image is not None else None,
            "fun_or_fl2v_model": fun_or_fl2v_model,
            "has_ref": has_ref,
            "add_cond_latents": add_cond_latents,
            "mask": mask.cpu(),
        }

        return (image_embeds,)
