"""Per-layer conditioning scaling.

Derived from ComfyUI-Conditioning-Rebalance (Apache License 2.0):
https://github.com/nova452/ComfyUI-ConditioningKrea2Rebalance
Only the layer-weight scaling helpers are vendored here; modified for this project.
See THIRD_PARTY_LICENSES.txt in this directory for the upstream license.
"""

import torch


def _parse_floats(s):
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        vals = [float(x) for x in s.replace(";", ",").split(",") if x.strip() != ""]
    except ValueError:
        return None
    if len(vals) < 2:
        return None
    return vals


def _scale_cond_tensor(t, scale, weights=None):
    if weights is None:
        return t * scale

    flat = t.shape[-1]
    n_layers = len(weights)
    if n_layers > 1 and flat % n_layers == 0:
        layer_dim = flat // n_layers
        orig_dtype = t.dtype
        t = t.float()
        t = t.view(*t.shape[:-1], n_layers, layer_dim)
        gains = torch.tensor(weights, dtype=t.dtype, device=t.device)
        t = t * gains.view(*([1] * (t.dim() - 2)), n_layers, 1)
        t = t.view(*t.shape[:-2], flat)
        return t.to(orig_dtype) * scale
    return t * scale


def scale_conditioning(structure, scale, weights=None):
    if isinstance(structure, list):
        out = []
        for item in structure:
            if isinstance(item, (list, tuple)) and len(item) == 2 \
                    and isinstance(item[0], torch.Tensor) and isinstance(item[1], dict):
                cond_t, extras = item
                new_cond = _scale_cond_tensor(cond_t, scale, weights)
                out.append([new_cond, dict(extras)])
            else:
                out.append(scale_conditioning(item, scale, weights))
        return out
    if isinstance(structure, torch.Tensor):
        return _scale_cond_tensor(structure, scale, weights)
    if isinstance(structure, dict):
        return {k: scale_conditioning(v, scale, weights)
                for k, v in structure.items()}
    return structure
