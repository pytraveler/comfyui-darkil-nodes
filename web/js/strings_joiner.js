import { app } from "../../scripts/app.js";
import { setLocaleSetting } from "./utils.js";

const NODE_NAME = "darkilStringsJoiner";


function _isConnected(node, idx) {
    const input = node.inputs[idx];
    return input && input.link !== null;
}

function _addDynamicInput(node) {
    let count = 0;
    for(const slot of node.inputs) {
        if (slot.name.startsWith("DYNAMIC_")) count += 1;
    }
    const TYPE = "STRING";
    const idx = count + 1;               
    const name = `DYNAMIC_${idx}`;
    
    node.addInput(name, TYPE);
}

function _removeDynamicInput(node, idx) {
    if (idx <= 0) return; 
    node.removeInput(idx);
}


function _recalcDynamicInputs(node) {
    const dynIndices = [];
    for (let i = 1; i < node.inputs.length; ++i) {
        if (node.inputs[i].name.startsWith("DYNAMIC_")) dynIndices.push(i);
    }

    let lastConnectedIdx = 0;
    for (let i = dynIndices.length - 1; i >= 0; --i) {
        if (_isConnected(node, dynIndices[i])) {
            lastConnectedIdx = dynIndices[i];
            break;
        }
    }

    let freeAfterLastFound = false;
    for (let i = dynIndices.length - 1; i >= 0; --i) {
        const idx = dynIndices[i];
        
        if (idx <= lastConnectedIdx) continue;
        
        if (_isConnected(node, idx)) continue;

        if (!freeAfterLastFound) {
            freeAfterLastFound = true;
        } else {
            _removeDynamicInput(node, idx);
        }
    }

    let idx = 0;
    for(const slot of node.inputs) {
        if (slot.name.startsWith("DYNAMIC_")) {
            idx += 1;
            slot.name = `DYNAMIC_${idx}`;
        }
    }

    if (!freeAfterLastFound && lastConnectedIdx > 0) {
        _addDynamicInput(node);
    }
    
    if (lastConnectedIdx === 0 && dynIndices.length === 0) {
        _addDynamicInput(node);
    }
}

app.registerExtension({
    name: `darkil_nodes_text.${NODE_NAME}`,

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const ret = origOnNodeCreated?.apply(this);
            this.serialize_widgets = true;  

            if (!this.widgets.find(w => w.name === "OTHER_INPUT")) {
                const w = this.addWidget("string", "OTHER_INPUT", "[]", () => {});
                w.hidden = true;
                w.computeSize = () => [0, -4];
            }
            
            const node = this;
            requestAnimationFrame(() => {
                _recalcDynamicInputs(node);
                setLocaleSetting(node);
            });

            return ret;
        };
        
        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (slotType, slot_idx, event, link_info, node_slot) {
            const me = origOnConnectionsChange?.apply(this, arguments);
            // Даем время завершиться операции подключения/отключения перед пересчетом
            requestAnimationFrame(() => {
                _recalcDynamicInputs(this);
            });
            return me;
        };
    },
});