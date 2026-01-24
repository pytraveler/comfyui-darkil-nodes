import { app } from "../../scripts/app.js";

const NODE_NAME = "darkilAdvancedVariableBuilder";


function _isConnected(node, idx) {
    const input = node.inputs[idx];
    return input && input.link !== null;
}

function _addDynamicInput(node) {
    let count = 0;
    for(const slot of node.inputs) {
        if (slot.name.startsWith("DYNAMIC_")) count += 1;
    }
    const TYPE = "BOOLEAN,INT,FLOAT,STRING,COMBO";
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

    let freeFound = false;
    for (let i = dynIndices.length - 1; i >= 0; --i) {
        const idx = dynIndices[i];
        if (_isConnected(node, idx)) continue;   

        if (!freeFound) {
            freeFound = true;                            
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
    

    if (!freeFound) {
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
                const w = this.addWidget("string", "OTHER_INPUT", "[]");
                w.hidden = true;
                w.computeSize = () => [0, -4];
            }

            requestAnimationFrame(() => _recalcDynamicInputs(this));

            return ret;
        };
        
        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (slotType, slot_idx, event, link_info, node_slot) {
            const me = origOnConnectionsChange?.apply(this, arguments);
            _recalcDynamicInputs(this);
            return me;
        };
    },
});
