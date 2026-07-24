import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";

const NODE_ID = "darkilAnySwitch";
const PREFIX = "any_";
const MASK_KEY = "enabled_mask";
const ANY_TYPE = "*";

const BOX = 14;
const RIGHT_INSET = 34;
const MIN_WIDTH = 190;

function anyInputIndices(node) {
    const res = [];
    const inputs = node.inputs || [];
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i]?.name?.startsWith(PREFIX)) res.push(i);
    }
    return res;
}

function isConnected(node, idx) {
    const input = node.inputs?.[idx];
    return !!(input && input.link !== null && input.link !== undefined);
}

function suffixOf(name) {
    return name.slice(PREFIX.length);
}

function getMaskWidget(node) {
    return node.widgets?.find(w => w.name === MASK_KEY);
}

function readMask(node) {
    try {
        const raw = getMaskWidget(node)?.value ?? "{}";
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function writeMask(node, mask) {
    const w = getMaskWidget(node);
    if (w) w.value = JSON.stringify(mask);
}

function isEnabled(mask, name) {
    const v = mask[suffixOf(name)];
    return v === undefined ? true : !!v;
}

function toggleEnabled(node, name) {
    const mask = readMask(node);
    const key = suffixOf(name);
    const cur = mask[key] === undefined ? true : !!mask[key];
    mask[key] = !cur;
    writeMask(node, mask);
}

function addAnyInput(node) {
    let count = 0;
    for (const slot of node.inputs || []) {
        if (slot.name?.startsWith(PREFIX)) count += 1;
    }
    node.addInput(`${PREFIX}${count + 1}`, ANY_TYPE);
}

function recalcInputs(node) {
    const dyn = anyInputIndices(node);

    let lastConnected = -1;
    for (let i = dyn.length - 1; i >= 0; i--) {
        if (isConnected(node, dyn[i])) {
            lastConnected = dyn[i];
            break;
        }
    }

    let freeKept = false;
    for (let i = dyn.length - 1; i >= 0; i--) {
        const idx = dyn[i];
        if (idx <= lastConnected) continue;
        if (isConnected(node, idx)) continue;
        if (!freeKept) {
            freeKept = true;
        } else {
            node.removeInput(idx);
        }
    }

    let n = 0;
    for (const slot of node.inputs || []) {
        if (slot.name?.startsWith(PREFIX)) {
            n += 1;
            slot.name = `${PREFIX}${n}`;
        }
    }

    if (!freeKept) addAnyInput(node);
}

function drawCheckbox(ctx, cx, cy, checked, connected) {
    const s = BOX;
    const x = cx - s / 2;
    const y = cy - s / 2;
    const r = 3;

    ctx.save();
    ctx.globalAlpha = connected ? 1.0 : 0.35;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + s, y, x + s, y + s, r);
    ctx.arcTo(x + s, y + s, x, y + s, r);
    ctx.arcTo(x, y + s, x, y, r);
    ctx.arcTo(x, y, x + s, y, r);
    ctx.closePath();

    ctx.fillStyle = checked ? "#4a9d5b" : "#2b2b2b";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#6a6a6a";
    ctx.stroke();

    if (checked) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x + s * 0.24, y + s * 0.52);
        ctx.lineTo(x + s * 0.43, y + s * 0.72);
        ctx.lineTo(x + s * 0.78, y + s * 0.28);
        ctx.stroke();
    }

    ctx.restore();
}

app.registerExtension({
    name: `darkil_nodes_logic.${NODE_ID}`,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        const origOnDrawForeground = nodeType.prototype.onDrawForeground;
        const origOnMouseDown = nodeType.prototype.onMouseDown;

        nodeType.prototype.onNodeCreated = function () {
            const ret = origOnNodeCreated?.apply(this, arguments);
            this.serialize_widgets = true;

            if (!getMaskWidget(this)) {
                const w = this.addWidget("string", MASK_KEY, "{}", () => {});
                w.hidden = true;
                w.computeSize = () => [0, -4];
            }

            if (this.outputs?.[0]) this.outputs[0].label = " ";
            this.size[0] = Math.max(this.size[0] || 0, MIN_WIDTH);

            const node = this;
            requestAnimationFrame(() => {
                const w = getMaskWidget(node);
                const wi = node.widgets ? node.widgets.indexOf(w) : -1;
                const saved = (node.widgets_values && wi !== -1) ? node.widgets_values[wi] : undefined;
                if (typeof saved === "string" && saved.trim().startsWith("{")) {
                    w.value = saved;
                }
                recalcInputs(node);
                setLocaleSetting(node);
                node.setDirtyCanvas(true, true);
            });

            return ret;
        };

        nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info, ioSlot) {
            const me = origOnConnectionsChange?.apply(this, arguments);
            const node = this;
            requestAnimationFrame(() => {
                recalcInputs(node);
                node.setDirtyCanvas(true, true);
            });
            return me;
        };

        nodeType.prototype.onDrawForeground = function (ctx, canvas) {
            origOnDrawForeground?.apply(this, arguments);
            if (this.flags?.collapsed) return;

            const mask = readMask(this);
            const cx = this.size[0] - RIGHT_INSET;
            const tmp = new Float32Array(2);

            for (const idx of anyInputIndices(this)) {
                const slot = this.inputs[idx];
                this.getConnectionPos(true, idx, tmp);
                const cy = tmp[1] - this.pos[1];
                drawCheckbox(ctx, cx, cy, isEnabled(mask, slot.name), isConnected(this, idx));
            }
        };

        nodeType.prototype.onMouseDown = function (e, pos, canvas) {
            if (!this.flags?.collapsed) {
                const cx = this.size[0] - RIGHT_INSET;
                const half = BOX / 2 + 3;
                const tmp = new Float32Array(2);

                for (const idx of anyInputIndices(this)) {
                    this.getConnectionPos(true, idx, tmp);
                    const cy = tmp[1] - this.pos[1];
                    if (Math.abs(pos[0] - cx) <= half && Math.abs(pos[1] - cy) <= half) {
                        toggleEnabled(this, this.inputs[idx].name);
                        this.setDirtyCanvas(true, true);
                        return true;
                    }
                }
            }
            return origOnMouseDown ? origOnMouseDown.apply(this, arguments) : undefined;
        };

        return nodeType;
    },
});
