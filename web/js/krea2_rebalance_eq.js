import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "darkilKrea2RebalanceEqualizer";
const PRESETS_URL = "/darkil/krea2_eq/presets";

const TAP_LAYERS = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
const N = TAP_LAYERS.length;
const V_MIN = -2.0;
const V_MAX = 10.0;
const STEP = 0.1;
const DEFAULT_WEIGHTS = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0";

const EQ_HEIGHT = 150;
const MARGIN = 15;
const PAD_TOP = 16;
const PAD_BOTTOM = 18;

const MULT_DEFAULT = 4.0;
const MULT_MIN = -10.0;
const MULT_MAX = 10.0;
const MULT_STEP = 0.1;
const MULT_HEIGHT = 42;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function ignoreInjectedWidth(w) {
    Object.defineProperty(w, "width", { configurable: true, get() {}, set() {} });
    return w;
}

function quantizeMult(v) {
    v = clamp(v, MULT_MIN, MULT_MAX);
    v = Math.round(v / MULT_STEP) * MULT_STEP;
    if (v === 0) v = 0;
    return v;
}

function multValueToX(v, trackX, trackW) {
    const f = (clamp(v, MULT_MIN, MULT_MAX) - MULT_MIN) / (MULT_MAX - MULT_MIN);
    return trackX + f * trackW;
}

function multXToValue(localX, trackX, trackW) {
    const f = clamp((localX - trackX) / trackW, 0, 1);
    return quantizeMult(MULT_MIN + f * (MULT_MAX - MULT_MIN));
}

function quantize(v) {
    v = clamp(v, V_MIN, V_MAX);
    v = Math.round(v / STEP) * STEP;
    if (v === 0) v = 0;
    return v;
}

function parseWeights(str) {
    const out = (str || "")
        .split(",")
        .map(s => parseFloat(s.trim()))
        .filter(v => !isNaN(v));
    const vals = [];
    for (let i = 0; i < N; i++) {
        vals.push(i < out.length ? quantize(out[i]) : 1.0);
    }
    return vals;
}

function joinWeights(vals) {
    return vals.map(v => quantize(v).toFixed(1)).join(",");
}

function layout(width) {
    const usable = Math.max(0, width - 2 * MARGIN);
    const colW = usable / N;
    const trackTop = PAD_TOP;
    const trackH = EQ_HEIGHT - PAD_TOP - PAD_BOTTOM;
    return { colW, trackTop, trackH };
}

function valueToY(v, trackTop, trackH) {
    const f = (clamp(v, V_MIN, V_MAX) - V_MIN) / (V_MAX - V_MIN);
    return trackTop + (1 - f) * trackH;
}

function yToValue(y, trackTop, trackH) {
    const f = clamp(1 - (y - trackTop) / trackH, 0, 1);
    return quantize(V_MIN + f * (V_MAX - V_MIN));
}

function columnAt(localX, width) {
    if (localX < MARGIN || localX > width - MARGIN) return -1;
    const { colW } = layout(width);
    if (colW <= 0) return -1;
    const idx = Math.floor((localX - MARGIN) / colW);
    return idx < 0 || idx >= N ? -1 : idx;
}

const ACTION_HEIGHT = 28;

function actionLayout(width) {
    const delW = 26;
    const gap = 8;
    const saveX = MARGIN;
    const delX = width - MARGIN - delW;
    const saveW = Math.max(20, delX - gap - saveX);
    const btnY = 3;
    const btnH = 22;
    return { saveX, saveW, delX, delW, btnY, btnH };
}

function drawActions(ctx, width, y) {
    const { saveX, saveW, delX, delW, btnY, btnH } = actionLayout(width);
    const textColor = window.LiteGraph?.WIDGET_TEXT_COLOR || "#ddd";

    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(saveX, y + btnY, saveW, btnH);
    ctx.fillStyle = textColor;
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Save preset", saveX + saveW / 2, y + btnY + btnH / 2 + 0.5);

    ctx.fillStyle = "#a33333";
    ctx.fillRect(delX, y + btnY, delW, btnH);
    const cx = delX + delW / 2;
    const cyc = y + btnY + btnH / 2;
    const r = 5;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, cyc - r);
    ctx.lineTo(cx + r, cyc + r);
    ctx.moveTo(cx + r, cyc - r);
    ctx.lineTo(cx - r, cyc + r);
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
}

function drawMultiplier(ctx, width, y, mw) {
    const v = clamp(Number(mw.value) || 0, MULT_MIN, MULT_MAX);
    const trackX = MARGIN;
    const trackW = Math.max(1, width - 2 * MARGIN);
    const trackY = y + 24;
    const trackH = 8;

    const textColor = window.LiteGraph?.WIDGET_TEXT_COLOR || "#ddd";
    const secondaryColor = window.LiteGraph?.WIDGET_SECONDARY_TEXT_COLOR || "#999";

    ctx.textAlign = "left";
    ctx.fillStyle = secondaryColor;
    ctx.font = "11px Arial";
    ctx.fillText("multiplier", trackX, y + 15);

    ctx.textAlign = "right";
    ctx.fillStyle = textColor;
    ctx.font = "11px Arial";
    ctx.fillText(v.toFixed(1), trackX + trackW, y + 15);

    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(trackX, trackY, trackW, trackH);

    const zeroX = multValueToX(0, trackX, trackW);
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zeroX, trackY - 3);
    ctx.lineTo(zeroX, trackY + trackH + 3);
    ctx.stroke();

    const handleX = multValueToX(v, trackX, trackW);
    ctx.fillStyle = v >= 0 ? "#4a9d5b" : "#b45151";
    const fx = Math.min(handleX, zeroX);
    const fw = Math.abs(handleX - zeroX);
    ctx.fillRect(fx, trackY, fw, trackH);

    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(handleX - 3, trackY - 3, 6, trackH + 6);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(handleX - 3, trackY - 3, 6, trackH + 6);
}

function drawEqualizer(ctx, node, width, y, weightsWidget) {
    const vals = parseWeights(weightsWidget.value);
    const { colW, trackTop, trackH } = layout(width);
    const zeroY = y + valueToY(0, trackTop, trackH);

    const textColor = window.LiteGraph?.WIDGET_TEXT_COLOR || "#ddd";
    const secondaryColor = window.LiteGraph?.WIDGET_SECONDARY_TEXT_COLOR || "#999";

    const trackW = Math.max(3, Math.min(6, colW * 0.28));

    for (let i = 0; i < N; i++) {
        const cx = MARGIN + colW * (i + 0.5);
        const v = vals[i];
        const handleY = y + valueToY(v, trackTop, trackH);

        ctx.fillStyle = "#1c1c1c";
        ctx.fillRect(cx - trackW / 2, y + trackTop, trackW, trackH);

        ctx.strokeStyle = "#3a3a3a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - colW * 0.42, zeroY);
        ctx.lineTo(cx + colW * 0.42, zeroY);
        ctx.stroke();

        const positive = v >= 0;
        ctx.fillStyle = positive ? "#4a9d5b" : "#b45151";
        const fillTop = Math.min(handleY, zeroY);
        const fillH = Math.abs(handleY - zeroY);
        ctx.fillRect(cx - trackW / 2, fillTop, trackW, fillH);

        const handleW = Math.max(colW * 0.55, trackW + 6);
        ctx.fillStyle = "#e6e6e6";
        ctx.fillRect(cx - handleW / 2, handleY - 2, handleW, 4);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cx - handleW / 2, handleY - 2, handleW, 4);

        ctx.textAlign = "center";
        ctx.fillStyle = textColor;
        ctx.font = "10px Arial";
        ctx.fillText(v.toFixed(1), cx, y + trackTop - 4);

        ctx.fillStyle = secondaryColor;
        ctx.font = "9px Arial";
        ctx.fillText(String(TAP_LAYERS[i]), cx, y + EQ_HEIGHT - 6);
    }
}

app.registerExtension({
    name: "darkil_nodes_conditioning." + NODE_ID,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_ID) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const result = origOnNodeCreated?.apply(this, arguments);

            const node = this;
            this.serialize_widgets = true;

            const multiplierWidget = node.widgets.find(w => w.name === "multiplier");
            if (multiplierWidget) {
                multiplierWidget.hidden = true;
                multiplierWidget.computeSize = () => [0, -4];
            }

            const weightsWidget = this.addWidget("string", "per_layer_weights", DEFAULT_WEIGHTS, () => {});
            weightsWidget.hidden = true;
            weightsWidget.computeSize = () => [0, -4];

            const multBar = {
                name: "multiplier_bar",
                type: "custom",
                value: "",
                serialize: false,
                _drag: false,
                computeSize(width) {
                    return [width, MULT_HEIGHT];
                },
                draw(ctx, node, widgetWidth, widgetY, height) {
                    this.last_y = widgetY;
                    if (multiplierWidget) drawMultiplier(ctx, widgetWidth, widgetY, multiplierWidget);
                },
                mouse(event, pos, node) {
                    if (!multiplierWidget) return false;
                    const type = event.type || "";
                    if (type.endsWith("down")) {
                        this._drag = true;
                    } else if (type.endsWith("move")) {
                        if (!this._drag) return false;
                    } else if (type.endsWith("up")) {
                        this._drag = false;
                        return true;
                    } else {
                        return false;
                    }
                    const width = node.size[0];
                    multiplierWidget.value = multXToValue(pos[0], MARGIN, Math.max(1, width - 2 * MARGIN));
                    node.setDirtyCanvas(true, true);
                    return true;
                },
            };

            const eq = {
                name: "equalizer",
                type: "custom",
                value: "",
                serialize: false,
                _drag: null,
                computeSize(width) {
                    return [width, EQ_HEIGHT];
                },
                draw(ctx, node, widgetWidth, widgetY, height) {
                    this.last_y = widgetY;
                    drawEqualizer(ctx, node, widgetWidth, widgetY, weightsWidget);
                },
                mouse(event, pos, node) {
                    const width = node.size[0];
                    const localX = pos[0];
                    const localY = pos[1] - (this.last_y ?? 0);
                    const { trackTop, trackH } = layout(width);
                    const type = event.type || "";

                    if (type.endsWith("down")) {
                        const idx = columnAt(localX, width);
                        if (idx < 0) return false;
                        this._drag = idx;
                    } else if (type.endsWith("move")) {
                        if (this._drag == null) return false;
                    } else if (type.endsWith("up")) {
                        this._drag = null;
                        return true;
                    } else {
                        return false;
                    }

                    const vals = parseWeights(weightsWidget.value);
                    vals[this._drag] = yToValue(localY, trackTop, trackH);
                    weightsWidget.value = joinWeights(vals);
                    node.setDirtyCanvas(true, true);
                    return true;
                },
            };

            this.widgets.push(ignoreInjectedWidth(multBar));
            this.widgets.push(ignoreInjectedWidth(eq));

            const resetBtn = this.addWidget("button", "Reset to defaults", null, () => {
                if (multiplierWidget) multiplierWidget.value = MULT_DEFAULT;
                weightsWidget.value = DEFAULT_WEIGHTS;
                node.setDirtyCanvas(true, true);
            });
            resetBtn.serialize = false;

            let presetsCache = {};

            const comboWidget = this.addWidget("combo", "preset", "-", (v) => loadPreset(v), { values: ["-"] });
            comboWidget.serialize = false;

            const nameWidget = this.addWidget("text", "preset name", "", () => {});
            nameWidget.serialize = false;

            function setComboValues(names) {
                comboWidget.options.values = ["-", ...names];
                if (!comboWidget.options.values.includes(comboWidget.value)) {
                    comboWidget.value = "-";
                }
            }

            function loadPreset(name) {
                const p = presetsCache[name];
                if (!p || name === "-") return;
                if (multiplierWidget && typeof p.multiplier === "number") {
                    multiplierWidget.value = quantizeMult(p.multiplier);
                }
                if (typeof p.weights === "string" && p.weights.includes(",")) {
                    weightsWidget.value = joinWeights(parseWeights(p.weights));
                }
                nameWidget.value = name;
                node.setDirtyCanvas(true, true);
            }

            async function refreshPresets() {
                try {
                    const r = await api.fetchApi(PRESETS_URL);
                    const data = await r.json();
                    presetsCache = data.presets || {};
                } catch (e) {
                    console.error("[darkil krea2 eq] load presets failed", e);
                    presetsCache = {};
                }
                setComboValues(Object.keys(presetsCache));
                node.setDirtyCanvas(true, true);
            }

            async function doSave() {
                const name = (nameWidget.value || "").trim();
                if (!name) return;
                if (presetsCache[name] && !confirm(`Preset "${name}" already exists. Overwrite?`)) {
                    return;
                }
                const body = {
                    name,
                    multiplier: Number(multiplierWidget?.value) || 0,
                    weights: weightsWidget.value,
                };
                try {
                    const r = await api.fetchApi(PRESETS_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });
                    const data = await r.json();
                    presetsCache = data.presets || presetsCache;
                } catch (e) {
                    console.error("[darkil krea2 eq] save preset failed", e);
                }
                setComboValues(Object.keys(presetsCache));
                comboWidget.value = name;
                node.setDirtyCanvas(true, true);
            }

            async function doDelete() {
                const name = comboWidget.value;
                if (!name || name === "-") return;
                try {
                    const r = await api.fetchApi(PRESETS_URL + "?name=" + encodeURIComponent(name), { method: "DELETE" });
                    const data = await r.json();
                    presetsCache = data.presets || {};
                } catch (e) {
                    console.error("[darkil krea2 eq] delete preset failed", e);
                }
                setComboValues(Object.keys(presetsCache));
                comboWidget.value = "-";
                node.setDirtyCanvas(true, true);
            }

            const actions = {
                name: "preset_actions",
                type: "custom",
                value: "",
                serialize: false,
                computeSize(width) {
                    return [width, ACTION_HEIGHT];
                },
                draw(ctx, node, widgetWidth, widgetY, height) {
                    this.last_y = widgetY;
                    drawActions(ctx, widgetWidth, widgetY);
                },
                mouse(event, pos, node) {
                    const type = event.type || "";
                    if (!type.endsWith("down")) return false;
                    const width = node.size[0];
                    const localY = pos[1] - (this.last_y ?? 0);
                    const { saveX, saveW, delX, delW, btnY, btnH } = actionLayout(width);
                    if (localY < btnY || localY > btnY + btnH) return false;
                    const x = pos[0];
                    if (x >= saveX && x <= saveX + saveW) {
                        doSave();
                        return true;
                    }
                    if (x >= delX && x <= delX + delW) {
                        doDelete();
                        return true;
                    }
                    return false;
                },
            };

            this.widgets.push(ignoreInjectedWidth(actions));

            this.size[0] = Math.max(this.size[0] || 0, 340);

            requestAnimationFrame(() => {
                const idx = node.widgets.indexOf(weightsWidget);
                const saved = (node.widgets_values && idx !== -1) ? node.widgets_values[idx] : undefined;
                if (typeof saved === "string" && saved.includes(",")) {
                    weightsWidget.value = joinWeights(parseWeights(saved));
                } else if (!weightsWidget.value || !weightsWidget.value.includes(",")) {
                    weightsWidget.value = DEFAULT_WEIGHTS;
                } else {
                    weightsWidget.value = joinWeights(parseWeights(weightsWidget.value));
                }
                node.setDirtyCanvas(true, true);
                refreshPresets();
            });

            return result;
        };

        return nodeType;
    },
});
