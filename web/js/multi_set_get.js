// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * multi_set_get.js — Multi Set / Multi Get / Multi Get AIO nodes (darkilNodes)
 *
 * Derived from ComfyUI-KJNodes' web/js/setgetnodes.js
 *   Copyright (c) kijai and ComfyUI-KJNodes contributors
 *   https://github.com/kijai/ComfyUI-KJNodes
 * which is itself originally based on diffus3's ComfyUI-extensions SetGet.
 *
 * Modifications Copyright (c) 2026 pytraveler:
 *   - reworked the single-slot Set/Get into multi-slot Multi Set / Multi Get
 *     and an all-in-one multi-group Multi Get AIO node
 *   - color propagation to getters, localization hooks, cross-graph scoping
 *   - (2026-07) ported & adapted from upstream: virtual-link drawing,
 *     same-graph Set/Get -> links conversion, cross-graph setter navigation,
 *     combo type-filter / source labels / colored dropdown, type palette,
 *     Set-node context menu, Vue combo refresh
 *
 * This file is licensed under the GNU General Public License v3.0 (GPL-3.0),
 * inherited from the upstream KJNodes code — see LICENSE.GPL-3.0.txt in this
 * directory. The rest of the comfyui-darkil-nodes package is MIT-licensed.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. This program is distributed WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU General Public License for more details.
 */

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

// ============================================================
// Settings-backed helpers (some reuse KJNodes settings when installed)
// ============================================================
function getSetting(id, fallback) {
    try {
        const v = app.ui.settings.getSettingValue(id);
        return v === undefined ? fallback : v;
    } catch (e) { return fallback; }
}
function getDisablePrefix() {
    // Reuse KJNodes' setting when installed, else darkil's own.
    return getSetting("KJNodes.disablePrefix", getSetting("darkilNodes.disablePrefix", false));
}

// Type -> node color palette (ported from KJNodes)
let _typeColorMap;
function ensureTypeColorMap() {
    if (_typeColorMap) return _typeColorMap;
    const nc = (typeof LGraphCanvas !== "undefined" && LGraphCanvas.node_colors) || {};
    _typeColorMap = {
        "MODEL": nc.blue,
        "LATENT": nc.purple,
        "VAE": nc.red,
        "WANVAE": nc.red,
        "CONDITIONING": nc.brown,
        "IMAGE": nc.pale_blue,
        "CLIP": nc.yellow,
        "FLOAT": nc.green,
        "MASK": { color: "#1c5715", bgcolor: "#1f401b" },
        "INT": { color: "#1b4669", bgcolor: "#29699c" },
        "CONTROL_NET": { color: "#156653", bgcolor: "#1c453b" },
        "NOISE": { color: "#2e2e2e", bgcolor: "#242121" },
        "GUIDER": { color: "#3c7878", bgcolor: "#1c453b" },
        "SAMPLER": { color: "#614a4a", bgcolor: "#3b2c2c" },
        "SIGMAS": { color: "#485248", bgcolor: "#272e27" },
    };
    return _typeColorMap;
}
function colorForType(type) {
    return ensureTypeColorMap()[type] || null;
}
// Apply type-based color to a node (opt-in via setting). Returns applied color option or null.
function autoColor(node, type) {
    if (!getSetting("darkilNodes.nodeAutoColor", true)) return null;
    if (!type || type === "*") { node.color = null; node.bgcolor = null; return null; }
    const colors = colorForType(type);
    if (colors) {
        node.color = colors.color;
        node.bgcolor = colors.bgcolor;
        return colors;
    }
    return null;
}

// Virtual-link drawing mode
let _forceShowAllLinks = false;
function getShowLinksMode() {
    if (_forceShowAllLinks) return "always";
    return getSetting("darkilNodes.showSetGetLinks", "never");
}

// Force every Get node (root + subgraphs) to re-read its combo values (needed in Vue node mode).
function refreshAllGetNodeCombos(graph) {
    const root = findRootGraph(graph);
    if (!root) return;
    const allGraphs = [root];
    const subgraphs = root._subgraphs || root.subgraphs;
    if (subgraphs) {
        for (const sg of subgraphs.values()) allGraphs.push(sg);
    }
    for (const g of allGraphs) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if (DEFINE_GET_NODE_TYPES.includes(node.type)) node._refreshComboOptions?.();
        }
    }
}

// Tracks nodes flagged has_errors so they can be cleared before the next alert.
const _errorNodes = new Set();
// Show a warning toast; optionally flash the offending node(s) red on canvas.
function showAlert(message, nodes) {
    const nodeList = nodes ? (Array.isArray(nodes) ? nodes : [nodes]) : [];
    const nodeInfo = nodeList
        .filter(n => n && n.pos)
        .map(n => `${n.title || n.type} [${Math.round(n.pos[0])}, ${Math.round(n.pos[1])}]`)
        .join(", ");
    if (nodeList.length) {
        for (const n of _errorNodes) n.has_errors = false;
        _errorNodes.clear();
        setTimeout(() => {
            for (const n of nodeList) {
                if (!n) continue;
                n.has_errors = true;
                _errorNodes.add(n);
            }
            app.canvas?.setDirty(true, true);
        }, 100);
    }
    app.extensionManager.toast.add({
        severity: "warn",
        summary: "Multi Get/Set",
        detail: nodeInfo ? `${message} — ${nodeInfo}` : message,
        life: 6000,
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
            if (DEFINE_SET_NODE_TYPES.includes(node.type)
                && node.widgets?.[0]?.value === cleanName) {
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

// Get all visible SetNode names for a Get node's combo dropdown.
// Shows names from current graph + ancestors (what's in scope), records each
// name's source (local/parent) for getOptionLabel, and can filter by compatible
// type. The module-level source map is safe because the values getter and
// getOptionLabel run in the same synchronous render pass.
let _darkilSetNameSourceMap = new Map();

// Collect the non-wildcard input types a setter exposes.
function darkilSetterInputTypes(node) {
    const types = new Set();
    for (const inp of node.inputs || []) {
        if (inp?.type && inp.type !== "*") {
            for (const t of String(inp.type).split(",")) types.add(t);
        }
    }
    return types;
}

function darkilGetVisibleSetNames(graph, filterTypes) {
    const sourceMap = new Map();
    for (const g of getGraphAncestors(graph)) {
        if (!g?._nodes) continue;
        for (const node of g._nodes) {
            if (!DEFINE_SET_NODE_TYPES.includes(node.type)) continue;
            const name = node.widgets?.[0]?.value;
            if (!name) continue;
            if (filterTypes && filterTypes.length) {
                const setTypes = darkilSetterInputTypes(node);
                if (setTypes.size && !filterTypes.some(ft => setTypes.has(ft))) continue;
            }
            if (!sourceMap.has(name)) {
                sourceMap.set(name, g === graph ? "local" : "parent");
            }
        }
    }
    _darkilSetNameSourceMap = sourceMap;
    return [...sourceMap.keys()].sort((a, b) => a.localeCompare(b));
}

// Build the shared group-combo options: source labels + live values with optional type filter.
function darkilMakeGroupComboOptions(node, getFilterTypes) {
    const options = {
        getOptionLabel: (value) => {
            if (!value) return "";
            const source = _darkilSetNameSourceMap.get(value);
            return (!source || source === "local") ? value : `${value} (${source})`;
        },
    };
    Object.defineProperty(options, "values", {
        get: () => darkilGetVisibleSetNames(node.graph, getFilterTypes ? getFilterTypes() : null),
        enumerable: true,
        configurable: true,
    });
    return options;
}

// Legacy-mode only: replace the combo click with a ContextMenu whose entries are
// left-bordered by each SetNode's type color. Vue mode handles labels natively.
function darkilInstallComboColorMenu(node, widget, options) {
    const origOnClick = widget.onClick?.bind(widget);
    widget.onClick = (params) => {
        if (LiteGraph.vueNodesMode) return origOnClick?.(params);
        const { e, canvas, node: n } = params;
        const x = e.canvasX - n.pos[0];
        const width = widget.width || n.size[0];
        if (x < 40) return widget.decrementValue?.({ e, node: n, canvas });
        if (x > width - 40) return widget.incrementValue?.({ e, node: n, canvas });
        const rawValues = options.values;
        const labels = rawValues.map(v => options.getOptionLabel(v) || v);
        const menu = new LiteGraph.ContextMenu(labels, {
            scale: Math.max(1, canvas.ds.scale),
            event: e,
            className: "dark",
            callback: (selectedLabel) => {
                const idx = labels.indexOf(selectedLabel);
                if (idx >= 0) widget.setValue?.(rawValues[idx], { e, node: n, canvas });
            },
        });
        ensureTypeColorMap();
        const entries = menu.root?.querySelectorAll(".litemenu-entry");
        rawValues.forEach((name, i) => {
            if (!entries?.[i]) return;
            const setter = darkilFindSetterByName(node.graph, name)?.node;
            const type = setter?.inputs?.find(inp => inp.type && inp.type !== "*")?.type;
            const c = colorForType(type);
            const border = canvas.default_connection_color_byType?.[type]
                || (typeof LGraphCanvas !== "undefined" && LGraphCanvas.link_type_colors?.[type])
                || (c && (c.color || c.bgcolor))
                || setter?.color
                || "#888";
            entries[i].style.borderLeft = `4px solid ${border}`;
            entries[i].style.paddingLeft = "8px";
        });
    };
}

// Install _refreshComboOptions: swap every combo widget's options object and
// re-insert the widget so Vue re-extracts values (needed in Vue node mode).
function darkilInstallComboRefresh(node) {
    node._refreshComboOptions = () => {
        const combos = (node.widgets || []).filter(w => w.type?.toLowerCase() === "combo");
        for (const w of combos) {
            const desc = Object.getOwnPropertyDescriptor(w.options || {}, "values");
            const newOpts = { getOptionLabel: w.options?.getOptionLabel };
            if (desc) Object.defineProperty(newOpts, "values", desc);
            else newOpts.values = w.options?.values;
            w.options = newOpts;
            const idx = node.widgets.indexOf(w);
            if (idx >= 0) {
                node.widgets.splice(idx, 1);
                node.widgets.splice(idx, 0, w);
            }
        }
    };
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
        this.properties["Node name for S&R"] = DEFINE_SET_NODE_TYPE;
        this.properties["aux_id"] = "darkil/comfyui-darkil-nodes";

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
                        const baseNameInput = `${!getDisablePrefix() ? "Set_" : ""}${baseName}`;
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

                            autoColor(this, resolvedType);
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
            console.error(`[darkilNodes] MultiSet onConnectionsChange error:`, e);
        }
        
        //Update either way
        this.update();
    }

    // Ensure group name uniqueness among Set nodes in scope. Returns true if renamed.
    // sameGraphOnly: only check the immediate graph (used for paste/clone).
    validateName(graph, sameGraphOnly) {
        let widgetValue = this.currentWidgetValue();
        if (!widgetValue || !this.isInitialized) return false;

        const existingValues = new Set();
        const scopeGraphs = sameGraphOnly ? [graph] : getGraphAncestors(graph);
        for (const g of scopeGraphs) {
            if (!g?._nodes) continue;
            g._nodes.forEach((otherNode) => {
                if (otherNode !== this && DEFINE_SET_NODE_TYPES.includes(otherNode.type)) {
                    const val = otherNode.widgets?.[0]?.value;
                    if (val) existingValues.add(val);
                }
            });
        }

        const originalValue = widgetValue;
        // Strip a trailing _N only during paste, to avoid FOO_0_1_2 accumulation.
        // For manual renames keep the full name as base (user may intend FOO_3).
        const baseName = this._justAdded ? widgetValue.replace(/_\d+$/, "") : widgetValue;
        let tries = 0;
        while (existingValues.has(widgetValue)) {
            widgetValue = `${baseName}_${tries}`;
            tries++;
        }

        this.widgets[0].value = widgetValue;
        this.update?.();
        return widgetValue !== originalValue;
    }

    onAdded() {
        this._justAdded = true;
        // Vue node mode doesn't always re-extract Get combo options when a Set is added.
        if (LiteGraph.vueNodesMode && this.graph && !app.configuringGraph) {
            refreshAllGetNodeCombos(this.graph);
        }
    }

    onRemoved() {
        if (!LiteGraph.vueNodesMode) return;
        const g = this.graph;
        if (!g) return;
        // Defer: onRemoved fires before _nodes is spliced.
        setTimeout(() => refreshAllGetNodeCombos(g), 0);
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

    getExtraMenuOptions(_, options) {
        const graph = this.graph;
        if (!graph) return;
        const name = this.widgets?.[0]?.value;

        const entries = [
            {
                content: "Add paired Get node",
                callback: () => {
                    const getNode = LiteGraph.createNode(DEFINE_GET_NODE_TYPE);
                    if (!getNode) return;
                    getNode.pos = [this.pos[0] + this.size[0] + 30, this.pos[1]];
                    graph.add(getNode);
                    if (getNode.widgets?.[0] && name) {
                        getNode.widgets[0].value = name;
                        getNode.groupName = name;
                        getNode.refreshOutputs?.();
                        getNode.setColorsFromSetters?.();
                    }
                    app.canvas.selectNode(getNode, false);
                    app.canvas.setDirty(true, true);
                },
            },
            {
                content: "Convert to links",
                callback: () => {
                    darkilConvertSetGetToLinks(this);
                    app.canvas?.setDirty(true, true);
                },
            },
            {
                content: this.drawConnection ? "Hide connections" : "Show connections",
                callback: () => {
                    const linkType = this.inputs?.[0]?.type;
                    this.drawConnection = !this.drawConnection;
                    this.slotColor = this.canvas.default_connection_color_byType?.[linkType];
                    this.canvas.setDirty(true, true);
                },
            },
            {
                content: "Hide all connections",
                callback: () => {
                    for (const n of graph._nodes) {
                        if (DEFINE_SET_NODE_TYPES.includes(n.type) || DEFINE_GET_NODE_TYPES.includes(n.type)) {
                            n.drawConnection = false;
                        }
                    }
                    this.canvas.setDirty(true, true);
                },
            },
        ];

        // Submenu listing all getters of this group, with navigation (incl. into subgraphs).
        const getters = this.findGetters(graph);
        if (getters.length) {
            const submenu = getters.map((getter) => {
                const sameGraph = getter.graph === graph;
                const sgNode = !sameGraph ? findSubgraphNodeFor(graph, getter) : null;
                const label = sameGraph
                    ? `${getter.title || getter.type} id: ${getter.id}`
                    : `${getter.title || getter.type} (in subgraph${sgNode ? ": " + (sgNode.title || sgNode.type) : ""})`;
                return {
                    content: label,
                    callback: () => {
                        if (sameGraph) {
                            this.canvas.centerOnNode(getter);
                            this.canvas.selectNode(getter, false);
                        } else if (sgNode?.subgraph && this.canvas.openSubgraph) {
                            this.canvas.openSubgraph(sgNode.subgraph, sgNode);
                            setTimeout(() => {
                                this.canvas.centerOnNode(getter);
                                this.canvas.selectNode(getter, false);
                            }, 0);
                        }
                        this.canvas.setDirty(true, true);
                    },
                };
            });
            entries.push({
                content: "Getters",
                has_submenu: true,
                submenu: { title: "Get nodes", options: submenu },
            });
        }

        options.unshift(...entries);
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
        this.properties["Node name for S&R"] = DEFINE_GET_NODE_TYPE;
        this.properties["aux_id"] = "darkil/comfyui-darkil-nodes";

        const node = this;

        // Group name widget – triggers output regeneration on change
        const comboOptions = darkilMakeGroupComboOptions(node, () => node._comboFilterTypes());
        const constantWidget = this.addWidget(
            "combo",
            "Group",
            "",
            (value) => {
                if (app.configuringGraph) return;
                node.groupName = value;
                node.refreshOutputs();
                node.size = node.computeSize();
                node.setColorsFromSetters();
            },
            comboOptions
        );
        darkilInstallComboColorMenu(this, constantWidget, comboOptions);
        darkilInstallComboRefresh(this);

        if (this.title === DEFINE_GET_NODE_TYPE) this.title = DEFINE_GET_DISPLAY_NAME;

        node.isVirtualNode = true;
    }

    // Type filter for the group dropdown: narrow to setters compatible with the
    // types this Get is currently feeding downstream. Returns null when disabled
    // or nothing is connected (show all).
    _comboFilterTypes() {
        if (getSetting("darkilNodes.filterGetNodeOptions", true) !== true) return null;
        if (!this.graph) return null;
        const types = new Set();
        for (const outp of this.outputs || []) {
            if (!outp?.links || !outp.links.length) continue;
            for (const linkId of outp.links) {
                const link = darkilGetLink(this.graph, linkId);
                if (!link) continue;
                const target = this.graph.getNodeById(link.target_id);
                const t = target?.inputs?.[link.target_slot]?.type;
                if (t && t !== "*") for (const s of String(t).split(",")) types.add(s);
            }
        }
        return types.size ? [...types] : null;
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
                const link = darkilGetLink(this.graph, lnkId);
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
                        const link = darkilGetLink(node.graph, linkId);
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
            if (colorOption.color !== undefined) this.color = colorOption.color;
            if (colorOption.bgcolor !== undefined) this.bgcolor = colorOption.bgcolor;
            return;
        }
        const setter = this.findSetter();
        if (!setter) return;
        const opt = setter.getColorOption?.();
        if (opt) {
            this.setColorOption?.(opt);
            this.color = opt.color ?? this.color;
            this.bgcolor = opt.bgcolor ?? this.bgcolor;
        } else if (setter.color || setter.bgcolor) {
            this.color = setter.color;
            this.bgcolor = setter.bgcolor;
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

        const link = darkilGetLink(targetGraph, linkId);
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
        darkilBuildGetMenu(this, options);
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
        this.properties["Node name for S&R"] = DEFINE_GET_AIO_NODE_TYPE;
        this.properties["aux_id"] = "darkil/comfyui-darkil-nodes";

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
        darkilInstallComboRefresh(this);

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
                const comboOptions = {
                    getOptionLabel: (value) => {
                        if (!value) return "";
                        const source = _darkilSetNameSourceMap.get(value);
                        return (!source || source === "local") ? value : `${value} (${source})`;
                    },
                };
                Object.defineProperty(comboOptions, "values", {
                    get: () => this.getAvailableGroups(),
                    enumerable: true,
                    configurable: true,
                });
                const combo = this.addWidget(
                    "combo",
                    `${i + 1} group`,
                    "",
                    (groupName) => {
                        this.setPrevGroup(i, groupName);
                        this.refreshOutputs();
                        this.setColorsFromSetters();
                    },
                    comboOptions
                );
                darkilInstallComboColorMenu(this, combo, comboOptions);
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
                const link = darkilGetLink(this.graph, lnkId);
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
                        const link = darkilGetLink(node.graph, linkId);
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
        // Coalesce bursts of setType() calls (one per setter input) into a single
        // rebuild on the next frame - avoids O(N^2) full refreshOutputs() per input.
        if (this._refreshScheduled) return;
        this._refreshScheduled = true;
        requestAnimationFrame(() => {
            this._refreshScheduled = false;
            this.refreshOutputs();
            this.setColorsFromSetters();
        });
    }

    // Update group using cross-graph search
    setGroup(group) {
        if (!this.graph) return [];
        
        // Get all visible groups from current + ancestors
        const allGroups = darkilGetVisibleSetNames(this.graph);
        const groupsExist = new Set(allGroups);
        const widgetsMissed = this.widgets.map((w, wIdx) => ({i: wIdx - 1, w: w})).filter(w => w.w.type==="combo" && !groupsExist.has(w.w.value));
        if (!widgetsMissed || widgetsMissed.length !== 1) return;
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
        return darkilGetLink(targetGraph, linkId);
    }

    setColorsFromSetters() {
        if (!this.graph ||
            !this.slotInfo ||
            !this.outputs.length ||
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

        const link = darkilGetLink(setterGraph, slotInfo.link);
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
        darkilBuildGetMenu(this, options);
    }
}


// ============================================================
// Helper functions for cross-graph conversion
// ============================================================

// Get link by ID - handles getLink(), Map _links, and plain object links/_links
function darkilGetLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (graph.getLink) return graph.getLink(linkId);
    if (graph._links instanceof Map) return graph._links.get(linkId) ?? null;
    return graph._links?.[linkId] ?? graph.links?.[linkId] ?? null;
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

// ============================================================
// Same-graph conversion + setter navigation (multi-slot aware)
// ============================================================

// Map a Get node's output slot to the setter input slot index it mirrors.
function darkilSetterInputForGetterOutput(getter, setter, outputSlot) {
    if (getter.slotInfo) {
        // AIO: slotInfo.inputIdx is the position among the setter's non-wildcard inputs.
        const info = getter.slotInfo[outputSlot];
        if (!info) return -1;
        const filtered = (setter.inputs || [])
            .map((inp, i) => ({ inp, i }))
            .filter(({ inp }) => inp.type !== "*" && inp.name !== "*");
        return filtered[info.inputIdx]?.i ?? -1;
    }
    // KJ single-slot setter: always input 0.
    if (setter.type === DEFINE_KJ_SET_NODE_TYPE) return 0;
    // MultiGet: outputs follow the setter's kept (non-placeholder) inputs, in order.
    const kept = [];
    for (let i = 0; i < (setter.inputs || []).length; i++) {
        const inp = setter.inputs[i];
        if (inp.type === "*" && inp.name === "*" && !inp.link) continue;
        kept.push(i);
    }
    return kept[outputSlot] ?? -1;
}

// Resolve the real source (node + slot) feeding a setter's input, within its graph.
function darkilResolveSetterSource(setter, graph, inputSlot) {
    const inp = setter.inputs?.[inputSlot];
    if (!inp || inp.link == null) return null;
    const link = darkilGetLink(graph, inp.link);
    if (!link) return null;
    const src = graph.getNodeById(link.origin_id);
    if (!src) return null;
    return { node: src, slot: link.origin_slot };
}

// Convert the same-graph Set/Get pairs of one setter into direct links.
function darkilConvertSameGraphSetGet(setNode, graph) {
    if (!graph || !setNode) return;
    const name = setNode.widgets?.[0]?.value;
    if (!name) return;

    const getters = darkilFindGettersByName(graph, name)
        .filter(e => e.graph === graph)
        .map(e => e.node);

    const relinks = [];
    const addConsumers = (outp, source) => {
        if (!source) return;
        for (const conn of darkilCollectOutputConnections(graph, outp)) {
            relinks.push({ source, targetId: conn.targetId, targetSlot: conn.targetSlot });
        }
    };

    // Getter outputs → source feeding the mirrored setter input.
    for (const getter of getters) {
        for (let os = 0; os < (getter.outputs?.length || 0); os++) {
            const outp = getter.outputs[os];
            if (!outp?.links || !outp.links.length) continue;
            if (getter.slotInfo) {
                // AIO: only handle slots that belong to this setter's group.
                const info = getter.slotInfo[os];
                if (!info || info.groupName !== name) continue;
            }
            const inputSlot = darkilSetterInputForGetterOutput(getter, setNode, os);
            if (inputSlot < 0) continue;
            addConsumers(outp, darkilResolveSetterSource(setNode, graph, inputSlot));
        }
    }

    // SetNode passthrough outputs: output i mirrors input i.
    for (let os = 0; os < (setNode.outputs?.length || 0); os++) {
        const outp = setNode.outputs[os];
        if (!outp?.links || !outp.links.length) continue;
        addConsumers(outp, darkilResolveSetterSource(setNode, graph, os));
    }

    // Remove fully-consumed getters. Keep AIO nodes that also reference other groups.
    for (const getter of getters) {
        if (getter.groupComboWidgets) {
            const groups = getter.groupComboWidgets.map(w => w.value).filter(Boolean);
            if (groups.length && groups.every(g => g === name)) graph.remove(getter);
        } else {
            graph.remove(getter);
        }
    }

    // Only remove the setter if nothing in this graph still references it.
    const stillReferenced = darkilFindGettersByName(graph, name).some(e => e.graph === graph);
    if (!stillReferenced) graph.remove(setNode);

    // Create the direct links.
    for (const r of relinks) {
        const target = graph.getNodeById(r.targetId);
        if (target) r.source.node.connect(r.source.slot, target, r.targetSlot);
    }
    app.canvas?.setDirty(true, true);
}

// Unified "Convert to links" for one setter: cross-graph first, then same-graph.
function darkilConvertSetGetToLinks(setNode) {
    const graph = setNode?.graph;
    if (!graph) return;
    const name = setNode.widgets?.[0]?.value;
    if (name) {
        const cross = darkilFindGettersByName(graph, name).filter(e => e.graph !== graph);
        if (cross.length) convertCrossGraphSetGet(setNode, graph, cross);
    }
    darkilConvertSameGraphSetGet(setNode, graph);
}

// Collect unique setters reachable from a list of Get nodes (via their group widgets).
function darkilSettersForGetters(getterNodes, graph) {
    const setters = new Set();
    for (const g of getterNodes) {
        const groups = g.groupComboWidgets
            ? g.groupComboWidgets.map(w => w.value)
            : [g.widgets?.[0]?.value];
        for (const name of groups) {
            if (!name) continue;
            const s = darkilFindSetterByName(graph, name)?.node;
            if (s) setters.add(s);
        }
    }
    return setters;
}

// Navigate to a setter, switching graphs if it lives in a different (parent/child) graph.
function darkilGoToSetter(fromNode, setter) {
    if (!setter) return;
    const canvas = app.canvas;
    const setterGraph = setter.graph;
    if (setterGraph && setterGraph !== fromNode.graph && canvas.setGraph) {
        canvas.setGraph(setterGraph);
        setTimeout(() => {
            canvas.centerOnNode(setter);
            canvas.selectNode(setter, false);
            canvas.setDirty(true, true);
        }, 0);
    } else {
        canvas.centerOnNode(setter);
        canvas.selectNode(setter, false);
        canvas.setDirty(true, true);
    }
}

// Build the shared Get-node context menu (Convert to links, Go to setter, Show/Hide).
function darkilBuildGetMenu(node, options) {
    const setter = node.findSetter();
    node.currentSetter = setter;
    if (!setter) return;
    const sameGraph = setter.graph === node.graph;

    const entries = [{
        content: "Convert to links",
        callback: () => {
            const graph = node.graph;
            for (const s of darkilSettersForGetters([node], graph)) darkilConvertSetGetToLinks(s);
            app.canvas?.setDirty(true, true);
        },
    }];

    if (sameGraph) {
        entries.push(
            {
                content: "Go to setter",
                callback: () => darkilGoToSetter(node, node.findSetter()),
            },
            {
                content: setter.drawConnection ? "Hide connections" : "Show connections",
                callback: () => {
                    const s = node.findSetter();
                    if (!s) return;
                    const linkType = s.inputs?.[0]?.type;
                    s.drawConnection = !s.drawConnection;
                    s.slotColor = node.canvas.default_connection_color_byType?.[linkType];
                    node.drawConnection = s.drawConnection;
                    node.canvas.setDirty(true, true);
                },
            },
        );
    } else {
        const isRoot = setter.graph === findRootGraph(node.graph);
        entries.push({
            content: `Go to setter (in ${isRoot ? "parent graph" : "subgraph"})`,
            callback: () => darkilGoToSetter(node, node.findSetter()),
        });
    }

    options.unshift(...entries);
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

    // Second pass: convert remaining same-graph pairs into direct links.
    // Restricted to darkil setters — KJ Set/Get pairs are handled by KJNodes itself.
    for (const { node: setNode, graph: g } of [...findAllNodesOfType(rootGraph, DEFINE_SET_NODE_TYPE)]) {
        darkilConvertSameGraphSetGet(setNode, g);
    }
}


// Extension registration
app.registerExtension({
    name: "darkil_nodes_logic.darkilMultiSetGet",

    settings: [
        {
            id: "darkilNodes.nodeAutoColor",
            name: "Multi Set/Get: auto-color by type",
            category: ["darkilNodes", "Multi Set & Get", "Auto-color by type"],
            tooltip: "Color Multi Set/Get nodes from a per-type palette on connect",
            type: "boolean",
            defaultValue: true,
        },
        {
            id: "darkilNodes.showSetGetLinks",
            name: "Multi Set/Get: show links",
            category: ["darkilNodes", "Multi Set & Get", "Show links"],
            tooltip: "When to draw virtual links between Multi Set/Get pairs",
            type: "combo",
            options: ["never", "selected", "always"],
            defaultValue: "never",
            onChange: () => app.canvas?.setDirty(true, true),
        },
        {
            id: "darkilNodes.filterGetNodeOptions",
            name: "Multi Set/Get: filter Get options by type",
            category: ["darkilNodes", "Multi Set & Get", "Filter Get options by type"],
            tooltip: "When a Multi Get is connected, only show groups with a compatible type",
            type: "boolean",
            defaultValue: true,
        },
        {
            id: "darkilNodes.disablePrefix",
            name: "Multi Set/Get: disable Set_ prefix",
            category: ["darkilNodes", "Multi Set & Get", "Disable Set_ prefix"],
            tooltip: "Prevents automatically adding the Set_ prefix to Multi Set titles",
            type: "boolean",
            defaultValue: false,
        },
    ],

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

        // --- Keep Set/Get nodes with visible connections in the visible set (#1) ---
        if (!LGraphCanvas.prototype.__darkilVisiblePatched) {
            const originalComputeVisibleNodes = LGraphCanvas.prototype.computeVisibleNodes;
            LGraphCanvas.prototype.computeVisibleNodes = function () {
                const visible = originalComputeVisibleNodes.apply(this, arguments);
                for (const node of this.graph?._nodes || []) {
                    if ((DEFINE_SET_NODE_TYPES.includes(node.type) || DEFINE_GET_NODE_TYPES.includes(node.type))
                        && node.drawConnection && !visible.includes(node)) {
                        visible.push(node);
                    }
                }
                return visible;
            };
            LGraphCanvas.prototype.__darkilVisiblePatched = true;
        }

        // --- Draw virtual links between Multi Set/Get pairs (#1) ---
        if (!app.canvas.__darkilDrawPatched) {
            app.canvas.__darkilDrawPatched = true;
            const origOnDrawBackground = app.canvas.onDrawBackground;
            app.canvas.onDrawBackground = function (ctx, visibleArea) {
                origOnDrawBackground?.call(this, ctx, visibleArea);

                const graph = this.graph || app.graph;
                if (!graph?._nodes || typeof this.renderLink !== "function") return;
                const mode = getShowLinksMode();
                const anySetDrawFlag = () => graph._nodes.some(n => n.type === DEFINE_SET_NODE_TYPE && n.drawConnection);

                let selectedNames = null;
                if (mode === "selected") {
                    const sel = Object.values(this.selected_nodes || {});
                    if (!sel.length) {
                        if (!anySetDrawFlag()) return;
                    } else {
                        selectedNames = new Set();
                        for (const n of sel) {
                            if (!DEFINE_SET_NODE_TYPES.includes(n.type) && !DEFINE_GET_NODE_TYPES.includes(n.type)) continue;
                            const names = n.groupComboWidgets
                                ? n.groupComboWidgets.map(w => w.value)
                                : [n.widgets?.[0]?.value ?? n.title];
                            for (const v of names) if (v) selectedNames.add(v);
                        }
                        if (!selectedNames.size && !anySetDrawFlag()) return;
                    }
                } else if (mode === "never") {
                    if (!anySetDrawFlag()) return;
                }

                // Group getters (current graph + descendants) by each group name they reference.
                const gettersByName = new Map();
                for (const g of [graph, ...getGraphDescendants(graph)]) {
                    if (!g?._nodes) continue;
                    for (const node of g._nodes) {
                        if (!DEFINE_GET_NODE_TYPES.includes(node.type)) continue;
                        const names = node.groupComboWidgets
                            ? node.groupComboWidgets.map(w => w.value)
                            : [node.widgets?.[0]?.value];
                        for (const nm of names) {
                            if (!nm) continue;
                            let list = gettersByName.get(nm);
                            if (!list) { list = []; gettersByName.set(nm, list); }
                            list.push(node);
                        }
                    }
                }

                for (const setNode of graph._nodes) {
                    if (setNode.type !== DEFINE_SET_NODE_TYPE) continue;
                    const name = setNode.widgets?.[0]?.value ?? setNode.title;
                    const showByMode = mode === "always" || (mode === "selected" && selectedNames?.has(name));
                    if (!showByMode && !setNode.drawConnection) continue;

                    const drawTargets = [];
                    const seenSubgraphs = new Set();
                    for (const getter of gettersByName.get(name) || []) {
                        if (getter.graph === graph) {
                            drawTargets.push(getter);
                        } else {
                            const sgNode = findSubgraphNodeFor(graph, getter);
                            if (sgNode && !seenSubgraphs.has(sgNode)) {
                                seenSubgraphs.add(sgNode);
                                drawTargets.push(sgNode);
                            }
                        }
                    }
                    if (!drawTargets.length) continue;

                    const linkType = setNode.inputs?.[0]?.type;
                    const slotColor = this.default_connection_color_byType?.[linkType]
                        || (typeof LGraphCanvas !== "undefined" && LGraphCanvas.link_type_colors?.[linkType])
                        || setNode.bgcolor
                        || (setNode.slotColor && setNode.slotColor !== "#FFF" ? setNode.slotColor : null)
                        || "#AAA";

                    const startPos = setNode.getConnectionPos(false, 0);
                    for (const target of drawTargets) {
                        const endPos = target.getConnectionPos(true, 0);
                        const highlighted = setNode.is_selected || target.is_selected;
                        const color = highlighted ? "#FFF" : slotColor;
                        this.renderLink(ctx, startPos, endPos, null, false, null, color, LiteGraph.RIGHT, LiteGraph.LEFT);
                    }
                }
            };
        }

        // --- Double-click a Multi Get node → jump to its Set node (#7) ---
        if (!window.__darkilSetGetDblClick) {
            window.__darkilSetGetDblClick = true;
            document.addEventListener("dblclick", () => {
                if (document.querySelector(".litecontextmenu")) return;
                const canvas = app.canvas;
                if (!canvas) return;
                const sel = Object.values(canvas.selected_nodes || {});
                if (sel.length !== 1) return;
                const node = sel[0];
                if (DEFINE_GET_NODE_TYPES.includes(node.type) && node.findSetter) {
                    const setter = node.findSetter();
                    if (setter) darkilGoToSetter(node, setter);
                }
            });
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
                            // Prototype is shared across all DTOs; the marker keeps the
                            // patch idempotent if this extension is reloaded (HMR) while
                            // the same prototype object is still live.
                            if (proto && !proto.__darkilResolveOutputPatched) {
                                const DtoClass = proto.constructor;
                                const hasNativeSupport = proto.resolveOutput.toString().includes('resolveVirtualOutput');
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
                                proto.__darkilResolveOutputPatched = true;
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