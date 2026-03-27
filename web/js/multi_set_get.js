import { app } from "../../scripts/app.js";
import { brighten } from "./colors.js"

// Node type identifiers - must be defined BEFORE cross-graph functions that use them
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

const LGraphNode = LiteGraph.LGraphNode;

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

// Paste rename map - coordinates rename between Set and Get nodes during paste operations
const _pasteRenameMap = new Map();

// ============================================================
// Cross-graph traversal utilities for Subgraph support.
// Set nodes propagate downward: a Set in parent graph is visible
// to all descendant subgraphs.
// Get nodes look upward: a Get searches its own graph first,
// then parent, then grandparent, etc.
// Duplicate names are allowed across unrelated (sibling) subgraphs.
// ============================================================

function findRootGraph(graph) {
    if (!graph) return null;
    return graph.rootGraph || graph;
}

// Find which SubgraphNode in parentGraph wraps the given subgraph
function findSubgraphNodeFor(parentGraph, innerNode) {
    if (!parentGraph?._nodes || !innerNode?.graph) return null;
    for (const n of parentGraph._nodes) {
        if (n.subgraph && n.subgraph === innerNode.graph) return n;
    }
    return null;
}

// Walk from a subgraph up to root, returning [graph, parent, grandparent, ..., root]
function getGraphAncestors(graph) {
    if (!graph) return [];
    const root = findRootGraph(graph);
    if (!root || graph === root) return [root];

    const chain = [graph];
    const visited = new Set([graph]);
    let current = graph;

    while (current !== root) {
        let found = false;
        // Search root nodes
        for (const n of root._nodes) {
            if (n.subgraph === current) {
                chain.push(root);
                current = root;
                found = true;
                break;
            }
        }
        if (found) break;
        
        // Search sibling subgraphs (for nested subgraphs)
        const subgraphs = root._subgraphs || root.subgraphs;
        if (subgraphs) {
            for (const sg of subgraphs.values()) {
                if (sg === current || !sg._nodes) continue;
                for (const n of sg._nodes) {
                    if (n.subgraph === current) {
                        if (visited.has(sg)) { found = false; break; }
                        visited.add(sg);
                        chain.push(sg);
                        current = sg;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }
        if (!found) {
            // Can't find parent, add root as fallback
            if (!chain.includes(root)) chain.push(root);
            break;
        }
    }
    return chain;
}

// Get all descendant subgraphs of a graph (children, grandchildren, etc.)
function getGraphDescendants(graph, _visited) {
    if (!graph?._nodes) return [];
    const visited = _visited || new Set();
    if (visited.has(graph)) return [];
    visited.add(graph);
    const descendants = [];
    for (const n of graph._nodes) {
        if (n.subgraph && !visited.has(n.subgraph)) {
            descendants.push(n.subgraph);
            descendants.push(...getGraphDescendants(n.subgraph, visited));
        }
    }
    return descendants;
}

// Collect nodes of a type from specific graphs
function collectNodesOfType(graphs, type) {
    const results = [];
    for (const g of graphs) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if (node.type === type) results.push({ node, graph: g });
        }
    }
    return results;
}

// Find all nodes of type across ALL graphs (root + all subgraphs)
function findAllNodesOfType(graph, type) {
    const root = findRootGraph(graph);
    if (!root) return [];
    const allGraphs = [root];
    const subgraphs = root._subgraphs || root.subgraphs;
    if (subgraphs) {
        for (const sg of subgraphs.values()) allGraphs.push(sg);
    }
    return collectNodesOfType(allGraphs, type);
}

// Scoped setter lookup: search current graph, then ancestors (look up).
// Returns {node, graph} or null
function darkilFindSetterByName(graph, name) {
    if (!name) return null;
    
    // Extract clean name - strip ",local" or ",parent" suffix if present
    const cleanName = String(name).replace(/,(local|parent)$/, '');
    
    for (const g of getGraphAncestors(graph)) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if ((DEFINE_SET_NODE_TYPES.includes(node.type) || node.type === DEFINE_SET_NODE_TYPE)
                && node.widgets[0].value === cleanName) {
                return { node, graph: g };
            }
        }
    }
    return null;
}

// Scoped getter lookup: search current graph + descendants (propagate down).
// Returns array of {node, graph}
function darkilFindGettersByName(graph, name) {
    if (!name) return [];
    const graphs = [graph, ...getGraphDescendants(graph)];
    const results = [];
    for (const g of graphs) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if (DEFINE_GET_NODE_TYPES.includes(node.type)
                && node.widgets?.filter(w => w.type?.toLowerCase() === "combo").map(w => w.value).includes(name)
                && name !== "") {
                results.push({ node, graph: g });
            }
        }
    }
    return results;
}

// Get all visible SetNode names for a GetNode's combo dropdown.
// Shows names from current graph + ancestors (what's in scope).
let _darkilSetNameSourceMap = new Map();

function darkilGetVisibleSetNames(graph) {
    const sourceMap = new Map();
    const ancestors = getGraphAncestors(graph);
    for (const g of ancestors) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if (DEFINE_SET_NODE_TYPES.includes(node.type) || node.type === DEFINE_SET_NODE_TYPE) {
                const name = node.widgets[0]?.value;
                if (!name) continue;
                if (!sourceMap.has(name)) {
                    sourceMap.set(name, g === graph ? "local" : "parent");
                }
            }
        }
    }
    _darkilSetNameSourceMap = sourceMap;
    // Return array of names only (not pairs), sorted alphabetically
    const names = [...sourceMap.keys()].sort((a, b) => a.localeCompare(b));
    return names;
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
                    // inp.type = "*";
                    // inp.name = "*";
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
                            if (resolvedType !== "*") {
                                inp.type = resolvedType;
                                inp.name = baseName;
                            }
                            

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

    // Ensure group name uniqueness among Get nodes - search ancestors for duplicates
    validateName(graph) {
        let widgetValue = this.currentWidgetValue();
        if (!widgetValue || !this.isInitialized) return;

        const existingValues = new Set();

        // Search in all ancestor graphs (current + parent graphs)
        const ancestors = getGraphAncestors(graph);
        for (const g of ancestors) {
            if (!g?._nodes) continue;
            g._nodes.forEach((otherNode) => {
                if (
                    otherNode !== this &&
                    (DEFINE_SET_NODE_TYPES.includes(otherNode.type) || otherNode.type === DEFINE_SET_NODE_TYPE)
                ) {
                    const val = otherNode.widgets?.[0]?.value;
                    if (val) existingValues.add(val);
                }
            });
        }

        let tries = 0;
        while (existingValues.has(widgetValue)) {
            widgetValue = `${this.widgets[0].value}_${tries}`;
            tries++;
        }

        this.widgets[0].value = widgetValue;
        this.update?.();
    }

    onAdded() {
        this._justAdded = true;
    }

    onConfigure() {
        // Only run paste logic when actually pasting, not during workflow load
        if (this._justAdded && this.graph && !app.configuringGraph) {
            const oldName = this.widgets[0].value;
            this.validateName(this.graph, true);
            this._justAdded = false;
            const newName = this.widgets[0].value;
            if (newName !== oldName) {
                _pasteRenameMap.set(oldName, newName);
                // Clear the map after this paste cycle
                setTimeout(() => _pasteRenameMap.delete(oldName), 0);
            }
            // Reset type and color on paste — nothing is connected yet
            if (this.inputs[0]?.link == null) {
                this.inputs[0].type = '*';
                this.inputs[0].name = '*';
                this.outputs[0].type = '*';
                this.outputs[0].name = '*';
                this.color = null;
                this.bgcolor = null;
            }
        }
        this._justAdded = false;
    }

    // Find Get nodes that reference this group - search descendants for getters
    findGetters(graph, checkForPreviousName) {
        const name = checkForPreviousName
            ? this.properties.previousName
            : this.widgets[0].value;
        
        if (!name) return [];
        
        // Search in current graph + all descendant subgraphs
        const graphs = [graph, ...getGraphDescendants(graph)];
        const results = [];
        
        for (const g of graphs) {
            if (!g?._nodes) continue;
            for (const otherNode of g._nodes) {
                if (DEFINE_GET_NODE_TYPES.includes(otherNode.type) &&
                    otherNode.widgets?.filter(w => w.type?.toLowerCase() === "combo").map(w => w.value).includes(name) &&
                    name !== "") {
                    results.push(otherNode);
                }
            }
        }
        
        return results;
    }

    // Update all Get nodes after a connection change
    update() {
        if (!this.graph || !this.isInitialized) return;

        const getters = this.findGetters(this.graph);
        getters.forEach((getter) => {
            let inpIdx = 0;
            for (const inp of this.inputs) {
                // Skip wildcard types - don't propagate "*" to Get nodes
                if (inp.type !== "*") {
                    getter.setType(inp.type, inpIdx);
                }
                inpIdx++;
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
                    // Show names from current graph + all ancestors (what's visible from subgraph)
                    return darkilGetVisibleSetNames(node.graph);
                },
            }
        );

        if (this.title === DEFINE_GET_NODE_TYPE) this.title = DEFINE_GET_DISPLAY_NAME;
        
        node.isVirtualNode = true;
    }

    clone() {
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
        return outputType === "*" ? `ANY_${inputIndex}` : `${outputType || groupName}_${inputIndex}`
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
        
        // Search in current graph first, then ancestors
        const setterResult = darkilFindSetterByName(this.graph, group);
        const setter = setterResult?.node;

        if (setter) {
            let relevantInputs = [];

            if (setter.type === DEFINE_SET_NODE_TYPE) {
                // Include all inputs including wildcard "*" to preserve existing connections
                relevantInputs = [...setter.inputs];
            } else if (setter.type === DEFINE_KJ_SET_NODE_TYPE) {
                // Single‑slot node – use its first input slot
                relevantInputs = [setter.inputs[0]];
            }

            let idx = 1;
            for (const inp of relevantInputs) {
                // Skip placeholder slots that are not connected and have "*" type
                if (inp.type === "*" && inp.name === "*" && !inp.link) {
                    continue;
                }
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
                // if ((out.links && out.links.length) || (out.type !== info.type && out.type !== "*")) return;
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
        // Ignore wildcard types - don't change output type or validate links
        if (type === "*") return;
        if (this.outputs.length <= slot) return;
        this.outputs[slot].type = type;
        this.validateLinks();
    }

    onAdded() {
        this._justAdded = true;
        // Original onAdded logic - refresh outputs when added to graph
        const node = this;
        requestAnimationFrame(() => {
            node.refreshOutputs();
        });
    }

    onConfigure() {
        if (this._justAdded && !app.configuringGraph) {
            const name = this.widgets[0].value;
            if (name) {
                // Check if our paired SetNode was renamed during this paste
                const newName = _pasteRenameMap.get(name);
                if (newName) {
                    this.widgets[0].value = newName;
                }
                // Restore type/color from setter after paste
                setTimeout(() => this.setColorsFromSetters(), 0);
            }
        }
        this._justAdded = false;
    }

    // Find setter using cross-graph search (current graph + ancestors)
    findSetter() {
        const group = this.widgets[0]?.value;
        if (!group) return null;
        
        const result = darkilFindSetterByName(this.graph, group);
        return result?.node;
    }

    setColorsFromSetters(colorOption = null) {
        if (colorOption) {
            this.setColorOption?.(colorOption);
        } else {
            const setter = this.findSetter();
            if (setter?.getColorOption) {
                const opt = setter.getColorOption();
                this.setColorOption?.(opt);
            }
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

    // Resolve virtual output for cross-graph Set/Get support
    resolveVirtualOutput(slot) {
        const name = this.widgets?.find(w => w.type?.toLowerCase() === "combo")?.value;
        if (!name) return undefined;

        // Scoped lookup: own graph first, then ancestors
        const result = darkilFindSetterByName(this.graph, name);
        if (!result) return undefined;

        // Same graph — let the standard getInputLink path handle it
        if (result.graph === this.graph) return undefined;

        // Warn if multiple SetNodes with this name exist in scope
        const scopeGraphs = getGraphAncestors(this.graph);
        const scopedSetters = collectNodesOfType(scopeGraphs, DEFINE_SET_NODE_TYPE)
            .filter(e => e.node.widgets?.[0]?.value === name);
        
        // Also check KJ SetNode type
        const kjSetters = collectNodesOfType(scopeGraphs, DEFINE_KJ_SET_NODE_TYPE)
            .filter(e => e.node.widgets?.[0]?.value === name);
        const allScopedSetters = [...scopedSetters, ...kjSetters];
        
        if (allScopedSetters.length > 1) {
            showAlert(`Multiple SetNodes named "${name}" found in scope. Rename duplicates or use "Convert to links" to resolve`);
            return undefined;
        }

        const { node: setter, graph: setterGraph } = result;
        const slotInfo = setter.inputs?.[slot];
        if (!slotInfo || slotInfo.link == null) return undefined;

        const link = darkilGetLink(setterGraph, slotInfo.link);
        if (!link) return undefined;

        const sourceNode = setterGraph.getNodeById(link.origin_id);
        if (!sourceNode) return undefined;

        return { node: sourceNode, slot: link.origin_slot };
    }

    // Add context menu options for cross-graph operations
    getExtraMenuOptions(_, options) {
        this.currentSetter = this.findSetter();
        if (!this.currentSetter) return;
        
        const sameGraph = this.currentSetter.graph === this.graph;
        
        if (!sameGraph || this.currentSetter.drawConnection !== this.drawConnection) {
            let menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
            
            options.unshift(
                {
                    content: "Convert to links",
                    callback: () => {
                        const graph = this.graph;
                        const setters = new Set();
                        
                        // Find all getters with the same group name
                        const groupName = this.widgets[0]?.value;
                        if (groupName) {
                            const getters = darkilFindGettersByName(graph, groupName);
                            for (const g of getters) {
                                if (g.node.findSetter) {
                                    const s = g.node.findSetter(g.graph);
                                    if (s) setters.add(s);
                                }
                            }
                        }
                        
                        for (const s of setters) {
                            convertCrossGraphSetGet(s, s.graph, []);
                        }
                        app.canvas?.setDirty(true, true);
                    },
                },
                {
                    content: "Go to setter",
                    callback: () => {
                        if (!this.currentSetter) return;
                        app.canvas.selectNode(this.currentSetter, false);
                        app.canvas.centerOnNode(this.currentSetter);
                    },
                },
                {
                    content: menuEntry,
                    callback: () => {
                        if (!this.currentSetter) return;
                        const linkType = this.currentSetter.inputs?.[0]?.type;
                        this.currentSetter.drawConnection = !this.currentSetter.drawConnection;
                        this.currentSetter.slotColor = this.canvas.default_connection_color_byType?.[linkType];
                        this.drawConnection = this.currentSetter.drawConnection;
                        this.canvas.setDirty(true, true);
                    },
                },
            );
        }
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

    // Get available groups using cross-graph search (current + ancestors)
    getAvailableGroups() {
        if (!this.graph) return [];
        
        // Use the same visible names function for consistency
        const allGroups = darkilGetVisibleSetNames(this.graph);
        const groupsSet = new Set(this.getPrevGroups() || []);
        return allGroups.filter(g => !groupsSet.has(g));
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
        return outputType === "*" ? `ANY_${inputIndex}` : `${outputType}_${inputIndex} [ ${groupIndex} ]`
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
            // Ensure value is converted to string before trimming
            const group = String(combo.value ?? '').trim();
            if (!group) continue;
            
            // Use cross-graph setter lookup
            const setterResult = darkilFindSetterByName(this.graph, group);
            const setter = setterResult?.node;
            if (!setter) continue;
            let relevantInputs = [];
            if (setter.type === DEFINE_SET_NODE_TYPE) {
                relevantInputs = setter.inputs.filter(i => i.type !== "*" && i.name !== "*");
                // relevantInputs = [...setter.inputs];
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

        const notModifiedTypes = [];

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
                // if ((out.links && out.links.length) || (out.type !== info.type && out.type !== "*")) return;
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
                            !link.type.split(",").includes(outp.type) // &&
                            // link.type !== "*"
                        );
                    }
                ).forEach(linkId => node.graph.removeLink(linkId));
            }
        }
    }

    setType(type, slot) {
        // Ignore wildcard types - don't refresh outputs when type is "*"
        if (type === "*") return;
        this.refreshOutputs();
        this.setColorsFromSetters();
    }

    // Update group using cross-graph search
    setGroup(group) {
        if (!this.graph) return [];
        
        // Get all visible groups from current + ancestors
        const allGroups = darkilGetVisibleSetNames(this.graph);
        const groupsExist = new Set(allGroups);
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
        
        // Use cross-graph setter lookup
        const setterResult = darkilFindSetterByName(this.graph, groupName);
        const setter = setterResult?.node;
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

        const targetGraph = setterResult?.graph || this.graph;
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
            
            // Use cross-graph lookup
            let setter = settersCache[groupName];
            if (!setter) {
                const result = darkilFindSetterByName(this.graph, groupName);
                setter = result?.node;
                if (setter) settersCache[groupName] = setter;
            }
            if (!setter) continue;
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

    onAdded() {
        this._justAdded = true;
        // Original onAdded logic - refresh outputs when added to graph
        const node = this;
        requestAnimationFrame(() => {
            node.refreshOutputs();
            node.setColorsFromSetters();
        });
    }

    onConfigure() {
        if (this._justAdded && !app.configuringGraph) {
            // Check each group combo widget for rename from paste
            for (const comboWidget of this.groupComboWidgets) {
                const name = comboWidget?.value;
                if (!name) continue;
                
                // Check if our paired SetNode was renamed during this paste
                const newName = _pasteRenameMap.get(name);
                if (newName) {
                    comboWidget.value = newName;
                }
            }
            // Restore type/color from setter after paste
            setTimeout(() => this.setColorsFromSetters(), 0);
        }
        this._justAdded = false;
    }

    // Resolve virtual output for cross-graph Set/Get support
    resolveVirtualOutput(slot) {
        const info = this.slotInfo?.[slot];
        if (!info) return undefined;

        const { groupName } = info;
        if (!groupName) return undefined;

        // Scoped lookup: own graph first, then ancestors
        const result = darkilFindSetterByName(this.graph, groupName);
        if (!result) return undefined;

        // Same graph — let the standard getInputLink path handle it
        if (result.graph === this.graph) return undefined;

        // Cross-graph: find source node from setter's input link
        const { node: setter, graph: setterGraph } = result;

        // Find the corresponding input index in the setter
        const inputIdx = info.inputIdx;
        const slotInfo = setter.inputs?.[inputIdx];
        if (!slotInfo || slotInfo.link == null) return undefined;

        const link = setterGraph.links?.[slotInfo.link];
        if (!link) return undefined;

        const sourceNode = setterGraph.getNodeById(link.origin_id);
        if (!sourceNode) return undefined;

        return { node: sourceNode, slot: link.origin_slot };
    }

    // Find setter using cross-graph search
    findSetter() {
        // Check first combo widget value as primary group
        const group = this.groupComboWidgets?.[0]?.value;
        if (!group) return null;
        
        const result = darkilFindSetterByName(this.graph, group);
        return result?.node;
    }

    // Add context menu options for cross-graph operations
    getExtraMenuOptions(_, options) {
        this.currentSetter = this.findSetter();
        if (!this.currentSetter) return;
        
        const sameGraph = this.currentSetter.graph === this.graph;
        
        if (!sameGraph || this.currentSetter.drawConnection !== this.drawConnection) {
            let menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
            
            options.unshift(
                {
                    content: "Convert to links",
                    callback: () => {
                        const graph = this.graph;
                        const setters = new Set();
                        
                        // Find all getters with the same groups
                        for (const combo of this.groupComboWidgets || []) {
                            const groupName = combo.value;
                            if (groupName) {
                                const getters = darkilFindGettersByName(graph, groupName);
                                for (const g of getters) {
                                    if (g.node.findSetter) {
                                        const s = g.node.findSetter(g.graph);
                                        if (s) setters.add(s);
                                    }
                                }
                            }
                        }
                        
                        for (const s of setters) {
                            convertCrossGraphSetGet(s, s.graph, []);
                        }
                        app.canvas?.setDirty(true, true);
                    },
                },
                {
                    content: "Go to setter",
                    callback: () => {
                        if (!this.currentSetter) return;
                        app.canvas.selectNode(this.currentSetter, false);
                        app.canvas.centerOnNode(this.currentSetter);
                    },
                },
                {
                    content: menuEntry,
                    callback: () => {
                        if (!this.currentSetter) return;
                        const linkType = this.currentSetter.inputs?.[0]?.type;
                        this.currentSetter.drawConnection = !this.currentSetter.drawConnection;
                        this.currentSetter.slotColor = this.canvas.default_connection_color_byType?.[linkType];
                        this.drawConnection = this.currentSetter.drawConnection;
                        this.canvas.setDirty(true, true);
                    },
                },
            );
        }
    }
}


// ============================================================
// Helper functions for cross-graph conversion
// ============================================================

// Get link by ID - handles both Map and plain object _links
function darkilGetLink(graph, linkId) {
    if (linkId == null) return null;
    if (graph.getLink) return graph.getLink(linkId);
    return graph._links instanceof Map ? graph._links.get(linkId) : graph._links?.[linkId] ?? null;
}

// Collect {targetId, targetSlot} from an output slot's links
function darkilCollectOutputConnections(graph, output) {
    const connections = [];
    if (output?.links) {
        for (const linkId of [...output.links]) {
            const link = darkilGetLink(graph, linkId);
            if (link) connections.push({ targetId: link.target_id, targetSlot: link.target_slot });
        }
    }
    return connections;
}

// Convert cross-graph Set/Get to SubgraphInput/SubgraphOutput
function convertCrossGraphSetGet(setNode, setGraph, crossGraphGetters) {
    // Find what's connected to the SetNode's input(s)
    const relevantInputs = setNode.inputs.filter(i => i.type !== "*" && i.name !== "*");
    
    for (let inputIdx = 0; inputIdx < relevantInputs.length; inputIdx++) {
        const setInput = setNode.inputs[inputIdx];
        if (!setInput || setInput.link == null) continue;
        
        const sourceLink = darkilGetLink(setGraph, setInput.link);
        if (!sourceLink) continue;
        const sourceNode = setGraph.getNodeById(sourceLink.origin_id);
        if (!sourceNode) continue;
        const sourceSlot = sourceLink.origin_slot;
        const linkType = setInput.type || '*';

        for (const { node: getter, graph: getterGraph } of crossGraphGetters) {
            // Collect getter's downstream connections before removing it
            let outputIndex = -1;
            
            // For MultiGetAIONode, find the correct output index from slotInfo
            if (getter.slotInfo) {
                const matchingSlot = getter.slotInfo.find(si => si.groupName === setNode.widgets[0].value && si.inputIdx === inputIdx);
                if (matchingSlot) outputIndex = matchingSlot.outputIdx;
            }
            
            const getterOutput = outputIndex >= 0 ? getter.outputs[outputIndex] : getter.outputs?.[inputIdx];
            if (!getterOutput) continue;
            
            const connections = darkilCollectOutputConnections(getterGraph, getterOutput);
            if (connections.length === 0) {
                getterGraph.remove(getter);
                continue;
            }

            // Determine direction and create SubgraphInput or SubgraphOutput
            const rootGraph = findRootGraph(setGraph);
            const sgNodeForGetter = findSubgraphNodeFor(rootGraph, getter);
            const sgNodeForSetter = findSubgraphNodeFor(rootGraph, setNode);

            if (sgNodeForGetter && setGraph === rootGraph) {
                // Set in root, Get in subgraph → create SubgraphInput
                const subgraph = sgNodeForGetter.subgraph;
                const inputName = setNode.widgets[0].value || linkType;
                const newInput = subgraph.addInput(inputName, linkType);
                const inputIndex = subgraph.inputs.indexOf(newInput);

                // Connect source → SubgraphNode's new input in root graph
                sourceNode.connect(sourceSlot, sgNodeForGetter, inputIndex);

                // Inside subgraph: connect SubgraphInput slot → getter's targets
                for (const conn of connections) {
                    if (conn.targetId === subgraph.outputNode?.id) {
                        // GetNode fed a SubgraphOutput — bypass it and connect source directly in parent graph.
                        const sgNodeOutput = sgNodeForGetter.outputs[conn.targetSlot];
                        if (sgNodeOutput?.links) {
                            for (const parentLinkId of [...sgNodeOutput.links]) {
                                const parentLink = darkilGetLink(rootGraph, parentLinkId);
                                if (parentLink) {
                                    const parentTarget = rootGraph.getNodeById(parentLink.target_id);
                                    if (parentTarget) {
                                        sourceNode.connect(sourceSlot, parentTarget, parentLink.target_slot);
                                    }
                                }
                            }
                        }
                        // Remove the now-unnecessary SubgraphOutput
                        const sgOutput = subgraph.outputs[conn.targetSlot];
                        if (sgOutput) {
                            subgraph.removeOutput(sgOutput);
                        }
                    } else {
                        const targetNode = getterGraph.getNodeById(conn.targetId);
                        if (targetNode && targetNode.inputs?.[conn.targetSlot]) {
                            newInput.connect(targetNode.inputs[conn.targetSlot], targetNode);
                        }
                    }
                }

                // If no connections used the SubgraphInput, remove it
                if (!newInput.link || newInput.link === null) {
                    subgraph.removeInput(newInput);
                }

                getterGraph.remove(getter);

            } else if (sgNodeForSetter && getterGraph === rootGraph) {
                // Set in subgraph, Get in root → create SubgraphOutput
                const subgraph = sgNodeForSetter.subgraph;
                const outputName = setNode.widgets[0].value || linkType;
                const newOutput = subgraph.addOutput(outputName, linkType);
                const outputIndex = subgraph.outputs.indexOf(newOutput);

                // Inside subgraph: connect source output → SubgraphOutput slot
                newOutput.connect(sourceNode.outputs[sourceSlot], sourceNode);

                // In root graph: connect SubgraphNode's new output → getter's targets
                for (const conn of connections) {
                    const targetNode = getterGraph.getNodeById(conn.targetId);
                    if (targetNode) {
                        sgNodeForSetter.connect(outputIndex, targetNode, conn.targetSlot);
                    }
                }

                getterGraph.remove(getter);

            } else {
                // Both in different subgraphs (sibling) — would need both input and output
                console.warn(`[darkilNodes] Cannot convert cross-graph Set/Get: both nodes are in nested subgraphs. Consider using "Convert All" from the menu.`);
            }
        }
    }
}

// Convert all cross-graph Set/Get pairs to real links
function darkilConvertAllSetGetToLinks(graph) {
    if (!graph) return;
    const rootGraph = findRootGraph(graph);

    // First pass: handle cross-graph pairs
    const allSetEntries = [
        ...findAllNodesOfType(rootGraph, DEFINE_SET_NODE_TYPE),
        ...findAllNodesOfType(rootGraph, DEFINE_KJ_SET_NODE_TYPE)
    ];
    
    for (const { node: setNode, graph: setGraph } of [...allSetEntries]) {
        const name = setNode.widgets?.[0]?.value;
        if (!name) continue;
        
        const allGetEntries = darkilFindGettersByName(rootGraph, name);
        const crossGraphGetters = allGetEntries.filter(e => e.graph !== setGraph);
        if (crossGraphGetters.length > 0) {
            convertCrossGraphSetGet(setNode, setGraph, crossGraphGetters);
        }
    }

    // Second pass: handle remaining same-graph pairs
    // For now we just remove the virtual Get nodes that have no connections
    const allGetEntries = [
        ...findAllNodesOfType(rootGraph, DEFINE_GET_NODE_TYPE),
        ...findAllNodesOfType(rootGraph, DEFINE_GET_AIO_NODE_TYPE)
    ];
    
    for (const { node: getNode, graph: g } of allGetEntries) {
        // Check if this getter has any output connections
        let hasConnections = false;
        for (const outp of getNode.outputs || []) {
            if (outp.links && outp.links.length > 0) {
                hasConnections = true;
                break;
            }
        }
        
        // If no connections and setter is in a different graph, remove the getter
        if (!hasConnections) {
            const groupName = getNode.widgets?.[0]?.value ||
                (getNode.groupComboWidgets?.[0]?.value);
            if (groupName) {
                const setterResult = darkilFindSetterByName(g, groupName);
                if (setterResult && setterResult.graph !== g) {
                    g.remove(getNode);
                }
            }
        }
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

    // Add global "Convert All Set/Get to Links" command
    setup() {
        // Override getCanvasMenuOptions to add our custom option
        const originalGetCanvasMenuOptions = app.canvas.getCanvasMenuOptions;
        if (originalGetCanvasMenuOptions) {
            app.canvas.getCanvasMenuOptions = function(options, e) {
                const result = originalGetCanvasMenuOptions.call(this, options, e);
                
                // Find the appropriate place to insert our option (after "Add Node")
                let insertIndex = -1;
                for (let i = 0; i < result.length; i++) {
                    if (result[i]?.content === "Add Node") {
                        insertIndex = i + 1;
                        break;
                    }
                }
                
                const convertOption = {
                    content: "Convert All Set/Get to Links [darkilNodes]",
                    callback: () => {
                        if (confirm("This will replace ALL cross-graph Set/Get pairs with direct links. This is irreversible. Continue?")) {
                            darkilConvertAllSetGetToLinks(app.graph);
                            app.canvas.setDirty(true, true);
                        }
                    },
                };
                
                if (insertIndex > 0) {
                    result.splice(insertIndex, 0, convertOption);
                } else {
                    result.push(convertOption);
                }
                
                return result;
            };
        }
    },
});

// Cross-graph Set/Get support - patch for frontends without native resolveVirtualOutput
app.registerExtension({
    name: "darkilNodes.CrossGraphSetGet",  
    setup() {
        let patched = false;

        const originalGraphToPrompt = app.graphToPrompt.bind(app);
        app.graphToPrompt = async function(...args) {
            if (!patched) {
                try {
                    const subgraphNode = app.graph._nodes.find(n => typeof n.getInnerNodes === 'function');
                    if (subgraphNode) {
                        const tempMap = new Map();
                        const dtos = subgraphNode.getInnerNodes(tempMap, []);
                        if (dtos.length > 0) {
                            const proto = Object.getPrototypeOf(dtos[0]);
                            const DtoClass = proto.constructor;
                            const nativeSource = proto.resolveOutput.toString();
                            const hasNativeSupport = nativeSource.includes('resolveVirtualOutput');
                            console.log(`[darkilNodes] Cross-graph Set/Get: frontend native support ${hasNativeSupport ? 'detected, skipping patch' : 'not found, applying patch (kijai implementation)'}`);
                            if (!hasNativeSupport) {
                                const origResolveOutput = proto.resolveOutput;
                                proto.resolveOutput = function(slot, type, visited) {
                                    if (typeof this.node?.resolveVirtualOutput === 'function') {
                                        const virtualSource = this.node.resolveVirtualOutput(slot);
                                        if (virtualSource) {
                                            const inputNodeDto = [...this.nodesByExecutionId.values()]
                                                .find(dto => dto instanceof DtoClass && dto.node === virtualSource.node);
                                            if (inputNodeDto) {
                                                return inputNodeDto.resolveOutput(virtualSource.slot, type, visited);
                                            }
                                            throw new Error(`darkilNodes: No DTO found for cross-graph source node [${virtualSource.node.id}]`);
                                        }
                                    }
                                    return origResolveOutput.call(this, slot, type, visited);
                                };
                            }
                            patched = true;
                        }
                    }
                } catch (e) {
                    console.warn('[darkilNodes] Failed to probe ExecutableNodeDTO for cross-graph patch:', e);
                }
            }
            return originalGraphToPrompt(...args);
        };
    }
});