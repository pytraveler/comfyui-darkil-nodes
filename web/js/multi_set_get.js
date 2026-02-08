//based on Kijai's SetGet nodes: https://github.com/kijai/ComfyUI-KJNodes

import { app } from "../../scripts/app.js";
import { brighten } from "./colors.js"

const LGraphNode = LiteGraph.LGraphNode;

// Node type identifiers
const DEFINE_SET_DISPLAY_NAME = "Multi Set [darkilNodes]";
const DEFINE_GET_DISPLAY_NAME = "Multi Get [darkilNodes]";
const DEFINE_GET_AIO_DISPLAY_NAME = "Multi Get AIO [darkilNodes]";
const DEFINE_SET_NODE_TYPE = "darkilMultiSetNode";
const DEFINE_KJ_SET_NODE_TYPE = "SetNode";  // KJNodes support
const DEFINE_GET_NODE_TYPE = "darkilMultiGetNode";
const DEFINE_GET_AIO_NODE_TYPE = "darkilMultiGetAIONode";
const DEFINE_MAX_AIO_PARS = 100;
const DEFINE_SET_NODE_TYPES = [
    DEFINE_KJ_SET_NODE_TYPE,
    DEFINE_SET_NODE_TYPE,
];
const DEFINE_GET_NODE_TYPES = [
    DEFINE_GET_NODE_TYPE,
    DEFINE_GET_AIO_NODE_TYPE,
];

// Settings helper (KJ settings)
let disablePrefix = false;
try {
    // May be undefined if the setting does not exist yet.
    disablePrefix = app.ui.settings.getSettingValue("KJNodes.disablePrefix");
} catch (e) { /* ignore */ }

// Helper: show toast on errors
function showAlert(message) {
    app.extensionManager.toast.add({
        severity: "warn",
        summary: "Multi Get/Set",
        detail: `${message}. Most likely you're missing custom nodes`,
        life: 8000,
    });
}

// darkilMultiSetNode – defines a *group* and creates dynamic slots                
class darkilMultiSetNode extends LGraphNode {
    isInitialized = false;
    defaultVisibility = true;
    serialize_widgets = true;
    drawConnection = false;
    canvas = app.canvas;
    lastColor = null;

    constructor(title) {
        super(title);
        if (!this.properties) this.properties = { previousName: "" };

        const node = this;
        // Group name widget
        this.addWidget(
            "text",
            "Group",
            "",
            (value) => {
                this.validateName(this.graph);
                this.groupName = value;
                this.properties.previousName = node.widgets[0].value;
            },
            {}
        );

        // Initial placeholder slot pair
        this.addInput("*", "*");
        this.addOutput("*", "*");

        if (this.title === DEFINE_SET_NODE_TYPE) this.title = DEFINE_SET_DISPLAY_NAME;

        // Mark as virtual – does not affect the prompt serialization
        this.isVirtualNode = true;
    }

    onNodeCreated() {
        const node = this;
        requestAnimationFrame(() => {
            if (!node.isInitialized) {
                node.isInitialized = true;
                if (node.widgets && node.widgets_values?.[0]) {
                    node.widgets[0].value = node.widgets_values[0];
                }
            }
        });
    }

    clone() {
        const cloned = super.clone?.apply(this, arguments);
        if (!cloned) return null;

        while (cloned.inputs.length > 1 && cloned.outputs.length > 1) {
            cloned.removeInput(cloned.inputs[0]);
            cloned.removeOutput(cloned.outputs[0]);
        }
        
        cloned.inputs[0].name = "*";
        cloned.inputs[0].type = "*";
        if (cloned.properties) cloned.properties.previousName = "";
        cloned.size = cloned.computeSize();
        cloned.setColorOption?.(null, false);
        
        return cloned;
    }

    currentWidgetValue() {
        return this.widgets?.[0]?.value || ""
    }

    // Connection handling – creates matching output slots on input connect
    onConnectionsChange(slotType, slot, isChangeConnect, link_info) {
        try {
            const graph = this.graph;
            const inp = this.inputs[slot];
            const outp = this.outputs && this.outputs.length > slot ? this.outputs[slot] : undefined;
            const isInputChanged = slotType === 1
            const isOutputChanged = slotType === 2
            const nodeName = this.name ?? this.type ?? this.id;
            const showNodeUndefinedAlert = () => showAlert(
                `Node '${nodeName}' ${isInputChanged ? "input" : "output"} undefined.`
            )
            const currentWidgetIsDummy = () => {return ["", "*"].includes(this.currentWidgetValue().trim()) && this.isInitialized};

            //On Disconnect
            if (!isChangeConnect) {
                if (isInputChanged) {
                    inp.type = "*";
                    inp.name = "*";
                    outp.type = "*";
                    outp.name = "*";
                } 
            }

            //On Connect
            if (isChangeConnect && link_info && graph) {
                const resolved = link_info.resolve?.(graph);
                const resolvedType = (resolved?.subgraphInput ?? resolved?.output)?.type;

                if (isInputChanged) {
                    if (resolvedType) {
                        const baseName = `${resolvedType}_${slot + 1}`;  // TODO: make rename for all
                        const baseNameInput = `${!disablePrefix ? "Set_" : ""}${baseName}`;  
                        const baseNameOutput = `${slot + 1}_${resolvedType}`;
                        
                            if (currentWidgetIsDummy()){
                                this.widgets[0].value = baseNameInput;
                                this.title = baseNameInput;
                            }
                            
                            this.validateName(graph);
                            inp.type = resolvedType;
                            inp.name = baseName;

                            if (this.outputs?.[slot]?.type !== inp.type) {
                                this.outputs[slot].type = inp.type;
                                this.outputs[slot].name = baseNameOutput;
                            }
                    } else {
                        showNodeUndefinedAlert();
                    }
                } else if (isOutputChanged) {
                    const linkOriginId = link_info.origin_id;
                    const linkOriginSlot = link_info.origin_slot;

                    const fromNode = graph._nodes.find(
                        (n) => n.id == linkOriginId
                    );
                    

                    if (linkOriginSlot >= 0 && fromNode?.inputs?.[linkOriginSlot] && outp) {
                        const nodeType = fromNode.inputs[linkOriginSlot].type;
                        const baseName = `${slot + 1}_${resolvedType}`;
                        outp.type = nodeType;
                        outp.name = baseName;
                    } else {
                        showNodeUndefinedAlert();
                    }

                }

                // Guarantee a trailing empty slot pair for further connections
                if (!(this.inputs.some((i) => [i.type, i.name].includes("*")))) {
                    this.addInput("*", "*");
                    this.addOutput("*", "*");
                }


                // Ensure only one free wildcard input‑output pair remains (skip pairs that are still linked)
                const freePlaceholderIndices = this.inputs
                    .map((inp, idx) => ({ inp, outp: this.outputs[idx], idx }))
                    .filter(({ inp, outp }) =>
                        inp.type === "*" && inp.name === "*"
                        && (!inp.link || inp.link == null)                // input not connected
                        && (!outp.links || outp.links.length === 0)       // output not connected
                    )
                    .map(({ idx }) => idx);
                if (freePlaceholderIndices.length > 1) {
                    // Keep the last free placeholder pair, remove earlier ones
                    for (let i = freePlaceholderIndices.length - 2; i >= 0; i--) {
                        const idx = freePlaceholderIndices[i];
                        if (this.outputs[idx]) this.removeOutput(idx);
                        this.removeInput(idx);
                    }
                    this.size = this.computeSize?.();
                }
            }
        } catch (e) {
            console.log(`OnConnectionChange error: "${e}".`);
        }
        
        //Update either way
        this.update();
    }

    // Ensure group name uniqueness among Get nodes
    validateName(graph) {
        let widgetValue = this.currentWidgetValue();
        if (!widgetValue || !this.isInitialized) return;

        const existingValues = new Set();
        graph._nodes.forEach((otherNode) => {
            if (
                otherNode !== this &&
                DEFINE_SET_NODE_TYPES.includes(otherNode.type)
            ) {
                const val = otherNode.widgets?.[0]?.value;
                if (val) existingValues.add(val);
            }
        });

        let tries = 0;
        while (existingValues.has(widgetValue)) {
            widgetValue = `${this.widgets[0].value}_${tries}`;
            tries++;
        }

        this.widgets[0].value = widgetValue;
        this.update?.();
    }

    onAdded(graph) {
        const node = this;
        requestAnimationFrame(() => {
            node.validateName(graph);
        })
    }

    // Find Get nodes that reference this group
    findGetters(graph, checkForPreviousName) {
        const name = checkForPreviousName
            ? this.properties.previousName
            : this.widgets[0].value;
        return graph._nodes.filter(
            (otherNode) =>
                DEFINE_GET_NODE_TYPES.includes(otherNode.type) &&
                otherNode.widgets?.filter(w => w.type?.toLowerCase() === "combo").map(w => w.value).includes(name) &&
                name !== ""
        );
    }

    // Update all Get nodes after a connection change
    update() {
        if (!this.graph || !this.isInitialized) return;

        const getters = this.findGetters(this.graph);
        getters.forEach((getter) => {
            let inpIdx = 0;
            for (const inp of this.inputs) {
                getter.setType(inp.type, inpIdx++);
            }
        });

        // Propagate group name change to getters that stored previous name
        if (this.widgets[0].value) {
            const prevGetters = this.findGetters(this.graph, true);
            prevGetters.forEach((getter) => {
                getter.setGroup(this.widgets[0].value);
            });
        }
    }

    setColorsThroughGetNodes(colorOption) {
        if (this.widgets[0].value) {
            const prevGetters = this.findGetters(this.graph, true);
            prevGetters.forEach((getter) => {
                console.log(
                    `[darkilNodes] Changing color for MultiGet - "${getter.title ?? getter.type}": color - [${
                    colorOption?.color ?? "empty"}], bgcolor - [${colorOption?.bgcolor ?? "empty"}]`);
                getter.setColorsFromSetters?.(colorOption);
            });
        }
    }

    get renderingColor() {
        const color = super.renderingColor;
        if (this.lastColor !== color) {
            this.lastColor = color;
            this.setColorsThroughGetNodes({ color, bgcolor: this.renderingBgColor || color});
        }
        return color;
    }
    
    setColorOption(colorOption, throughGetNode = true) {
        const ret = super.setColorOption?.call(this, colorOption);

        if (throughGetNode === true) {
            this.setColorsThroughGetNodes(colorOption);
        }

        return ret;
    }
}

// darkilMultiGetNode – reads a group and creates matching outputs dynamically   
class darkilMultiGetNode extends LGraphNode {
    isInitialized = false;
    defaultVisibility = true;
    serialize_widgets = true;
    drawConnection = false;
    canvas = app.canvas;

    constructor(title) {
        super(title);
        if (!this.properties) this.properties = { };

        const node = this;

        // Group name widget – triggers output regeneration on change
        this.addWidget(
            "combo",
            "Group",
            "",
            (value) => {
                node.groupName = value;
                node.refreshOutputs();
                node.size = node.computeSize();
                node.setColorsFromSetters();
            },
            {
                values: () => {
                    const setterNodes = node.graph._nodes.filter(
                        (otherNode) => DEFINE_SET_NODE_TYPES.includes(otherNode.type) || otherNode.type == DEFINE_SET_NODE_TYPE);
                    return setterNodes.map((otherNode) => otherNode.widgets[0].value).sort();
                },
            }
        );

        if (this.title === DEFINE_GET_NODE_TYPE) this.title = DEFINE_GET_DISPLAY_NAME;
        
        node.isVirtualNode = true;
    }

    сlone() {
        const cloned = super.clone?.apply(this, arguments);
        if (!cloned) return null;

        cloned.groupName = this.groupName;
        cloned.size = cloned.computeSize();

        return cloned;
    }

    onNodeCreated() {
        const node = this;
        requestAnimationFrame(() => {
            if (!node.isInitialized) {
                node.isInitialized = true;
                if (node.widgets && node.widgets_values?.[0]) {
                    node.widgets[0].value = node.widgets_values[0];
                    node.groupName = node.widgets_values[0];
                }
            }
        });
    }

    getOutputName(outputType, inputIndex, groupName="") {
        return `${outputType || groupName}_${inputIndex}`
    }

    // Re‑build all output slots based on current graph state
    refreshOutputs() {

        const desired = [];

        if (!this.groupName) {
            // No group selected – clear all outputs
            while (this.outputs.length) this.removeOutput(0);
            return;
        }

        const group = this.widgets[0].value;
        const setter = this.graph._nodes.find(
            otherNode => (
                DEFINE_SET_NODE_TYPES.includes(otherNode.type) || otherNode.type === DEFINE_SET_NODE_TYPE
            ) && otherNode.widgets[0].value === group && group !== "");

        if (setter) {
            let relevantInputs = [];

            if (setter.type === DEFINE_SET_NODE_TYPE) {
                // Filter out placeholder slots
                relevantInputs = setter.inputs.filter(i => i.type !== "*" && i.name !== "*");
            } else if (setter.type === DEFINE_KJ_SET_NODE_TYPE) {
                // Single‑slot node – use its first input slot
                relevantInputs = [setter.inputs[0]];
            }

            let idx = 1;
            for (const inp of relevantInputs) {
                const outName = this.getOutputName(inp?.type, idx, this.groupName);
                const outType = inp?.type || "*";
                desired.push({ name: outName, type: outType });
                idx++;
            }
        }

        const savedLinks = this.outputs.map(outp => ({
            type: outp.type,
            links: (outp.links || []).map(lnkId => {
                const link = this.graph._links.get(lnkId);
                if (!link) return null;
                const targetNodeId = link.origin_id === this.id ? link.target_id : link.origin_id;
                const targetSlot   = link.origin_id === this.id ? link.target_slot : link.origin_slot;
                return { targetNodeId, targetSlot };
            }).filter(Boolean)
        }));

        const restoreOldLinks = (node) => {
            savedLinks.forEach((info, idx) => {
                if (!info || !info.links?.length) return;
                if (idx >= node.outputs.length) return;         
                const out = node.outputs[idx];
                if ((out.links && out.links.length) || out.type !== info.type) return;
                for (const { targetNodeId, targetSlot } of info.links) {
                    const targetNode = node.graph.getNodeById?.(targetNodeId)
                    if (!targetNode) continue; 
                    node.connectSlots(node.outputs[idx], targetNode, targetNode.inputs[targetSlot]);
                }
            });
        }

        // Find longest common prefix between current outputs and desired list
        let commonPrefixLength = 0;
        const minLen = Math.min(this.outputs.length, desired.length);
        while (
            commonPrefixLength < minLen &&
            this.outputs[commonPrefixLength].type === desired[commonPrefixLength].type &&
            this.outputs[commonPrefixLength].name === desired[commonPrefixLength].name
        ) {
            commonPrefixLength++;
        }

        // If overlap matches completely, only adjust the tail (add/remove)
        if (commonPrefixLength === minLen) {
            // Append missing outputs
            for (let i = this.outputs.length; i < desired.length; i++) {
                const { name, type } = desired[i];
                this.addOutput(name, type);
            }

            // Remove surplus trailing outputs
            while (this.outputs.length > desired.length) {
                this.removeOutput(this.outputs.length - 1);
            }

            restoreOldLinks(this);

            this.size = this.computeSize?.();
            return;
        }

        // Otherwise rebuild from scratch
        while (this.outputs.length) this.removeOutput(0);
        for (const { name, type } of desired) {
            this.addOutput(name, type);
        }

        restoreOldLinks(this);

        this.size = this.computeSize?.();
    }

    onConnectionsChange(slotType, slot, isChangeConnect, link_info) {
        // No special handling needed; just ensure dangling links are removed
        this.validateLinks();
    }

    setGroup(group) {
        if (!this.isInitialized) return;
        if (this.widgets?.[0]) this.widgets[0].value = group;
        this.groupName = group;
        this.refreshOutputs();
        // Mark node dirty so UI updates
        this.size = this.computeSize();
        this.setColorsFromSetters();
        this.setDirtyCanvas(true, true);
    }

    validateLinks() {
        const node = this;
        for (const outp of node.outputs) {
            if (outp.type !== "*" && outp.links) {
                outp.links.filter(
                    (linkId) => {
                        const link = node.graph?.links[linkId];
                        return (
                            link &&
                            !link.type.split(",").includes(outp.type) &&
                            link.type !== "*"
                        );
                    }).forEach((linkId) => {
                        node.graph.removeLink(linkId);
                    });
            }
        }
    }

    setType(type, slot) {
        if (this.outputs.length <= slot) return;
        this.outputs[slot].type = type;
        this.validateLinks();
    }

    // Hook called when the node is placed into a graph
    onAdded(graph) {
        const node = this;
        requestAnimationFrame(() => {
            node.refreshOutputs();
        })
    }

    findSetter() {
        const group = this.widgets[0].value;
        const foundNode = this.graph._nodes.find(
            otherNode => (
                DEFINE_SET_NODE_TYPES.includes(otherNode.type) || otherNode.type === DEFINE_SET_NODE_TYPE
            ) && otherNode.widgets[0].value === group && group !== "");
        return foundNode;
    }

    setColorsFromSetters(colorOption = null) {
        if (colorOption) {
            this.setColorOption?.(colorOption);
        } else {
            const colorOption = this.findSetter()?.getColorOption?.();
            this.setColorOption?.(colorOption);
        }
    }

    getInputLink(slot) {
        const setter = this.findSetter();
        if (!setter) {
            showAlert(
                `No SetNode found for ${this.widgets?.[0]?.value || ""} (${this.type})`
            );
            return null;
        }

        const targetGraph = setter.graph || this.graph;

        const slotInfo = setter.inputs?.[slot];
        if (!slotInfo) {
            showAlert(`Invalid slot index ${slot} on SetNode`);
            return null;
        }

        const linkId = slotInfo.link;
        if (linkId == null) {
            // No connection for this slot
            return null;
        }

        const link = targetGraph.links?.[linkId];
        if (!link) {
            showAlert(`Link ${linkId} not found in the appropriate graph`);
            return null;
        }
        return link;
    }

}


class darkilMultiGetAIONode extends LGraphNode {
    isInitialized = false;
    defaultVisibility = true;
    serialize_widgets = true;
    drawConnection = false;
    canvas = app.canvas;

    constructor(title) {
        super(title);
        if (!this.properties) this.properties = { previousGroups: "[]" };

        const node = this;

        this.addWidget(
            "number",
            "Groups count",               
            1,                  
            (v) => {
                const cnt = Math.min(Math.max(1, parseInt(v) || 1), DEFINE_MAX_AIO_PARS);
                node.updateGroupCount(cnt);          
                node.refreshOutputs();              
                node.setColorsFromSetters();          
            },
            { min: 1, max: DEFINE_MAX_AIO_PARS, step: 1, step2: 1, precision: 0 }                
        );

        this.groupComboWidgets = [];

        if (this.title === DEFINE_GET_AIO_NODE_TYPE) this.title = DEFINE_GET_AIO_DISPLAY_NAME;

        this.isVirtualNode = true;
    }

    getPrevGroups() {
        return JSON.parse(this.properties?.previousGroups || "[]");
    }

    setPrevGroup(slot, groupValue) {
        const prevGroups = this.getPrevGroups();
        if (slot >= prevGroups.length || !groupValue) return;
        prevGroups[slot] = groupValue;
        if (prevGroups && this.properties) this.properties.previousGroups = JSON.stringify(prevGroups);  
    }

    setPrevGroupSize(needSize) {
        const lastArr = this.getPrevGroups();
        if (!Array.isArray(lastArr)) return;
        while (lastArr.length !== needSize) needSize > lastArr.length ? lastArr.push("") : lastArr.pop();
        if (lastArr && this.properties) this.properties.previousGroups = JSON.stringify(lastArr);  
    }

    clone() {
        const cloned = super.clone?.apply(this, arguments);
        if (!cloned) return null;

        const numW = cloned.widgets.find(w => w.type === "number");
        if (numW) numW.value = this.widgets[0].value;

        cloned.groupComboWidgets = [];
        cloned.updateGroupCount(this.groupComboWidgets.length);

        for (let i = 0; i < this.groupComboWidgets.length; ++i) {
            const src = this.groupComboWidgets[i];
            const dst = cloned.groupComboWidgets[i];
            if (dst && src) dst.value = src.value;
        }

        cloned.refreshOutputs();
        cloned.size = cloned.computeSize();

        return cloned;
    }

    onNodeCreated() {
        const node = this;
        requestAnimationFrame(() => {
            if (node.isInitialized) return;
            node.isInitialized = true;

            let savedCount = 1;
            if (node.widgets && node.widgets_values?.[0] != null) {
                savedCount = Math.min(Math.max(1, parseInt(node.widgets_values[0]) || 1), DEFINE_MAX_AIO_PARS);
                node.widgets[0].value = savedCount;             
            }

            node.updateGroupCount(savedCount);

            const savedGroups = this.getPrevGroups();
            if (savedGroups) {
                for (let i = 0; i < node.groupComboWidgets.length; ++i) {
                    const wVal = i < savedGroups.length ? savedGroups[i] : node.widgets_values?.[i + 1];
                    if (wVal) node.groupComboWidgets[i].value = wVal;
                }
            }
            
            node.refreshOutputs();
        });
    }

    getAvailableGroups() {
        if (!this.graph) return [];
        const setterNodes = this.graph._nodes.filter(
            n => DEFINE_SET_NODE_TYPES.includes(n.type) || n.type === DEFINE_SET_NODE_TYPE
        );

        const groups = [...new Set(setterNodes.map(n => n.widgets[0].value).filter(v => v))];
        const groupsSet = new Set(this.getPrevGroups() || []);
        return groups.filter(g => !groupsSet.has(g)).sort();
    }

    updateGroupCount(newCount) {
        newCount = Math.min(Math.max(1, parseInt(newCount) || 1), DEFINE_MAX_AIO_PARS);
        const curCount = this.groupComboWidgets.length;
        const node = this;

        if (newCount === curCount) return;

        this.setPrevGroupSize(newCount);

        if (newCount > curCount) {
            for (let i = curCount; i < newCount; ++i) {
                const combo = this.addWidget(
                    "combo",
                    `${i + 1} group`,
                    "",
                    (groupName) => {
                        this.setPrevGroup(i, groupName);
                        this.refreshOutputs();
                        this.setColorsFromSetters();   
                    },
                    { values: () => this.getAvailableGroups() }
                );
                this.groupComboWidgets.push(combo);
            }
        } else if (newCount < curCount) {
            for (let i = curCount - 1; i >= newCount; --i) {
                const w = this.groupComboWidgets[i];
                const idxInWidgets = this.widgets.indexOf(w);
                if (idxInWidgets !== -1) this.widgets.splice(idxInWidgets, 1); //TODO: is it work?!
                this.groupComboWidgets.pop();
            }
        }

        this.size = this.computeSize?.();
        // this.refreshOutputs();
    }

    getOutputName(groupIndex, outputType, inputIndex) {
        return `${outputType}_${inputIndex} [ ${groupIndex} ]`
    }

    refreshOutputs() {
        if (!this.graph) return;

        // Save the current connections and link them to the group + entry index.
        const previousSlotInfo = this.slotInfo ? [...this.slotInfo] : [];
        const savedLinks = this.outputs.map((outp, idx) => ({
            type: outp.type,
            links: (outp.links || []).map(lnkId => {
                const link = this.graph._links.get(lnkId);
                if (!link) return null;
                const targetNodeId = link.origin_id === this.id ? link.target_id : link.origin_id;
                const targetSlot   = link.origin_id === this.id ? link.target_slot : link.origin_slot;
                return { targetNodeId, targetSlot };
            }).filter(Boolean),
            // Link its group and the entry index to the old position.
            groupName: previousSlotInfo[idx]?.groupName ?? null,
            inputIdx:  previousSlotInfo[idx]?.inputIdx ?? null,
        }));

        // Creating a list of desired outputs and a new slotInfo
        const desired = [];   
        this.slotInfo = [];   
        let groupIdx = 1;
        let outputIdx = 0;
        for (const combo of this.groupComboWidgets) {
            const group = combo.value?.trim();
            if (!group) continue;          
            const setter = this.graph._nodes.find(
                n => (DEFINE_SET_NODE_TYPES.includes(n.type) || n.type === DEFINE_SET_NODE_TYPE)
                    && n.widgets[0].value === group
            );
            if (!setter) continue;        
            let relevantInputs = [];
            if (setter.type === DEFINE_SET_NODE_TYPE) {
                relevantInputs = setter.inputs.filter(i => i.type !== "*" && i.name !== "*");
            } else if (setter.type === DEFINE_KJ_SET_NODE_TYPE) {
                // KJ‑Set - Single‑slot node
                relevantInputs = [setter.inputs[0]];
            }
            let idx = 1;
            for (const inp of relevantInputs) {
                const outType = inp?.type || "*";
                const outName = this.getOutputName(groupIdx, outType, idx);
                desired.push({ name: outName, type: outType, group });
                // keep a new binding of the entry group/index to the exit position
                this.slotInfo.push({ outputIdx, groupIdx, groupName: group, inputIdx: idx - 1 });
                ++outputIdx;
                ++idx;
            }
            ++groupIdx;
        }

        // Map of new software exit indexes (groupName, inputIdx)
        const newOutputMap = {};
        this.slotInfo.forEach(info => {
            const key = `${info.groupName}|${info.inputIdx}`;
            newOutputMap[key] = info.outputIdx;
        });

        // Restoring old connections, taking into account the possible displacement
        const restoreOldLinks = (node) => {
            savedLinks.forEach((info, oldIdx) => {
                if (!info || !info.links?.length) return;
                // trying to find a new index by group + entry index
                let newIdx;
                if (info.groupName !== null && info.inputIdx !== null) {
                    const key = `${info.groupName}|${info.inputIdx}`;
                    if (key in newOutputMap) newIdx = newOutputMap[key];
                }
                // If haven't found it, we try to keep the previous index,
                // if it still exists in the current set of outputs
                if (newIdx === undefined || newIdx === null) {
                    if (oldIdx < node.outputs.length) newIdx = oldIdx;
                }
                if (newIdx === undefined || newIdx === null) return;
                const out = node.outputs[newIdx];
                if (!out) return;
                // do not reconnect if there are already links or the type does not match.
                if ((out.links && out.links.length) || out.type !== info.type) return;
                for (const { targetNodeId, targetSlot } of info.links) {
                    const targetNode = node.graph.getNodeById?.(targetNodeId);
                    if (!targetNode) continue;
                    node.connectSlots(node.outputs[newIdx], targetNode, targetNode.inputs[targetSlot]);
                }
            });
        };

        // Find longest common prefix between current outputs and desired list
        let commonPrefixLength = 0;
        const minLen = Math.min(this.outputs.length, desired.length);
        while (
            commonPrefixLength < minLen &&
            this.outputs[commonPrefixLength].type === desired[commonPrefixLength].type &&
            this.outputs[commonPrefixLength].name === desired[commonPrefixLength].name
        ) {
            commonPrefixLength++;
        }

        // If overlap matches completely, only adjust the tail (add/remove)
        if (commonPrefixLength === minLen) {
            // Append missing outputs
            for (let i = this.outputs.length; i < desired.length; i++) {
                const { name, type, group } = desired[i];
                this.addOutput(name, type);
                const outIdx = this.outputs.length - 1;
                // this.outputs[outIdx].tooltip = group;
            }

            // Remove surplus trailing outputs
            while (this.outputs.length > desired.length) {
                this.removeOutput(this.outputs.length - 1);
            }

            restoreOldLinks(this);


            this.size = this.computeSize?.();
            return;
        }

        while (this.outputs.length) this.removeOutput(0);
        for (const { name, type, group } of desired) {
            this.addOutput(name, type);
            const outIdx = this.outputs.length - 1;
            this.outputs[outIdx].tooltip = group;
        }

        restoreOldLinks(this);

        this.size = this.computeSize?.();
    } 

    onConnectionsChange(slotType, slot, isChangeConnect, link_info) {
        this.validateLinks();  
    }

    validateLinks() {
        const node = this;
        for (const outp of node.outputs) {
            if (outp.type !== "*" && outp.links) {
                outp.links.filter(
                    linkId => {
                        const link = node.graph?.links[linkId];
                        return (
                            link &&
                            !link.type.split(",").includes(outp.type) &&
                            link.type !== "*"
                        );
                    }
                ).forEach(linkId => node.graph.removeLink(linkId));
            }
        }
    }

    setType() {  
        this.refreshOutputs();
        this.setColorsFromSetters();  
    }

    setGroup(group) {
        if (!this.graph) return [];
        const setterNodes = this.graph._nodes.filter(
            n => DEFINE_SET_NODE_TYPES.includes(n.type) || n.type === DEFINE_SET_NODE_TYPE
        );
        const groupsExist = new Set(setterNodes.map(n => n.widgets[0].value).filter(v => v));
        const widgetsMissed = this.widgets.map((w, wIdx) => ({i: wIdx - 1, w: w})).filter(w => w.w.type==="combo" && !groupsExist.has(w.w.value));
        if (!widgetsMissed || widgetsMissed.length !== 1) return;
        console.log(widgetsMissed);
        const { w, i } = widgetsMissed[0];
        if (w && i >= 0) {
            w.value = group;
            this.setPrevGroup(i, group);
            this.refreshOutputs();
            this.setColorsFromSetters();  
        }
    }

    getInputLink(slot) {
        const info = this.slotInfo?.[slot];
        if (!info) return null;

        const { groupName, inputIdx } = info;
        const setter = this.graph._nodes.find(
            n => (DEFINE_SET_NODE_TYPES.includes(n.type) || n.type === DEFINE_SET_NODE_TYPE)
                && n.widgets[0].value === groupName
        );
        if (!setter) {
            showAlert(`No SetNode or MultiSetNode found for group (constant) "${groupName}"`);
            return null;
        }

        const input = setter.inputs?.[inputIdx];
        if (!input) {
            showAlert(`Invalid input index ${inputIdx} on SetNode or MultiSetNode of group (constant) "${groupName}"`);
            return null;
        }

        const linkId = input.link;
        if (linkId == null) return null;

        const targetGraph = setter.graph || this.graph;
        return targetGraph.links?.[linkId] ?? null;
    }

    setColorsFromSetters() {
        if (!this.graph &&
            !this.slotInfo && 
            !this.outputs.length && 
            !this.groupComboWidgets.length) return;

        const settersCache = {};
        for (let i = 0; i < this.outputs.length; i++) {
            const groupInfo = this.slotInfo?.[i];
            if (!groupInfo) continue;
            const { groupName } = groupInfo;
            const setter = settersCache[groupName] || this.graph._nodes.find(
                n => (DEFINE_SET_NODE_TYPES.includes(n.type) || n.type === DEFINE_SET_NODE_TYPE)
                    && n.widgets[0].value === groupName
            );
            if (!setter) continue;
            if (!(groupName in settersCache)) settersCache[groupName] = setter;
            let { bgcolor, color } = setter?.getColorOption?.() || {};
            if (bgcolor || color) {
                this.outputs[i].color_off = bgcolor || color;
                this.outputs[i].color_on = brighten(bgcolor || color, 1.7) || (bgcolor || color);
            } else {
                color = setter?.color;
                if (color) {
                    this.outputs[i].color_off = color;
                    this.outputs[i].color_on = brighten(color, 1.5) || (color);
                } 
            }
        }
    }

    onAdded(graph) {
        const node = this;
        requestAnimationFrame(() => {
            node.refreshOutputs();
            node.setColorsFromSetters();
        });
    }
}


// Extension registration                                                    
app.registerExtension({
    name: "darkil_nodes_logic.darkilMultiSetGet",
    
    registerCustomNodes() {
        // Register Multi Set node
        LiteGraph.registerNodeType(
            DEFINE_SET_NODE_TYPE,
            Object.assign(darkilMultiSetNode, {
                title: "Multi Set"
            })
        );

        // Register Multi Get node
        LiteGraph.registerNodeType(
            DEFINE_GET_NODE_TYPE,
            Object.assign(darkilMultiGetNode, {
                title: "Multi Get"
            })
        );

        // Register Multi Get AIO node
        LiteGraph.registerNodeType(
            DEFINE_GET_AIO_NODE_TYPE,
            Object.assign(darkilMultiGetAIONode, {
                title: "Multi Get AIO"
            })
        );

        darkilMultiSetNode.category = darkilMultiGetNode.category = "darkilNodes/logic";
        darkilMultiGetAIONode.category = "darkilNodes/logic";
    },
});