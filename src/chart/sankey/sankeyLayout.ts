/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as layout from '../../util/layout';
import * as zrUtil from 'zrender/src/core/util';
import {groupData} from '../../util/model';
import ExtensionAPI from '../../ExtensionAPI';
import SankeySeriesModel, { SankeySeriesOption, SankeyNodeItemOption } from './SankeySeries';
import { GraphNode, GraphEdge } from '../../data/Graph';
import { LayoutOrient } from '../../util/types';
import GlobalModel from '../../model/Global';

export default function (ecModel: GlobalModel, api: ExtensionAPI) {

    ecModel.eachSeriesByType('sankey', function (seriesModel: SankeySeriesModel) {

        var nodeWidth = seriesModel.get('nodeWidth');
        var nodeGap = seriesModel.get('nodeGap');

        var layoutInfo = getViewRect(seriesModel, api);

        seriesModel.layoutInfo = layoutInfo;

        var width = layoutInfo.width;
        var height = layoutInfo.height;

        var graph = seriesModel.getGraph();

        var nodes = graph.nodes;
        var edges = graph.edges;

        computeNodeValues(nodes);

        var filteredNodes = zrUtil.filter(nodes, function (node) {
            return node.getLayout().value === 0;
        });

        var iterations = filteredNodes.length !== 0 ? 0 : seriesModel.get('layoutIterations');

        var orient = seriesModel.get('orient');

        var nodeAlign = seriesModel.get('nodeAlign');

        layoutSankey(nodes, edges, nodeWidth, nodeGap, width, height, iterations, orient, nodeAlign);
    });
}

/**
 * Get the layout position of the whole view
 */
function getViewRect(seriesModel: SankeySeriesModel, api: ExtensionAPI) {
    return layout.getLayoutRect(
        seriesModel.getBoxLayoutParams(), {
            width: api.getWidth(),
            height: api.getHeight()
        }
    );
}

function layoutSankey(
    nodes: GraphNode[],
    edges: GraphEdge[],
    nodeWidth: number,
    nodeGap: number,
    width: number,
    height: number,
    iterations: number,
    orient: LayoutOrient,
    nodeAlign: SankeySeriesOption['nodeAlign']
) {
    computeNodeBreadths(nodes, edges, nodeWidth, width, height, orient, nodeAlign);
    computeNodeDepths(nodes, edges, height, width, nodeGap, iterations, orient);
    computeEdgeDepths(nodes, orient);
}

/**
 * Compute the value of each node by summing the associated edge's value
 */
function computeNodeValues(nodes: GraphNode[]) {
    zrUtil.each(nodes, function (node) {
        var value1 = sum(node.outEdges, getEdgeValue);
        var value2 = sum(node.inEdges, getEdgeValue);
        var nodeRawValue = node.getValue() as number || 0;
        var value = Math.max(value1, value2, nodeRawValue);
        node.setLayout({value: value}, true);
    });
}

/**
 * Compute the x-position for each node.
 *
 * Here we use Kahn algorithm to detect cycle when we traverse
 * the node to computer the initial x position.
 */
function computeNodeBreadths(
    nodes: GraphNode[],
    edges: GraphEdge[],
    nodeWidth: number,
    width: number,
    height: number,
    orient: LayoutOrient,
    nodeAlign: SankeySeriesOption['nodeAlign']
) {
    // Used to mark whether the edge is deleted. if it is deleted,
    // the value is 0, otherwise it is 1.
    var remainEdges = [];
    // Storage each node's indegree.
    var indegreeArr = [];
    //Used to storage the node with indegree is equal to 0.
    var zeroIndegrees: GraphNode[] = [];
    var nextTargetNode: GraphNode[] = [];
    var x = 0;
    // var kx = 0;

    for (let i = 0; i < edges.length; i++) {
        remainEdges[i] = 1;
    }
    for (let i = 0; i < nodes.length; i++) {
        indegreeArr[i] = nodes[i].inEdges.length;
        if (indegreeArr[i] === 0) {
            zeroIndegrees.push(nodes[i]);
        }
    }
    var maxNodeDepth = -1;
    // Traversing nodes using topological sorting to calculate the
    // horizontal(if orient === 'horizontal') or vertical(if orient === 'vertical')
    // position of the nodes.
    while (zeroIndegrees.length) {
        for (var idx = 0; idx < zeroIndegrees.length; idx++) {
            var node = zeroIndegrees[idx];
            var item = node.hostGraph.data.getRawDataItem(node.dataIndex) as SankeyNodeItemOption;
            var isItemDepth = item.depth != null && item.depth >= 0;
            if (isItemDepth && item.depth > maxNodeDepth) {
                maxNodeDepth = item.depth;
            }
            node.setLayout({depth: isItemDepth ? item.depth : x}, true);
            orient === 'vertical'
                ? node.setLayout({dy: nodeWidth}, true)
                : node.setLayout({dx: nodeWidth}, true);

            for (var edgeIdx = 0; edgeIdx < node.outEdges.length; edgeIdx++) {
                var edge = node.outEdges[edgeIdx];
                var indexEdge = edges.indexOf(edge);
                remainEdges[indexEdge] = 0;
                var targetNode = edge.node2;
                var nodeIndex = nodes.indexOf(targetNode);
                if (--indegreeArr[nodeIndex] === 0 && nextTargetNode.indexOf(targetNode) < 0) {
                    nextTargetNode.push(targetNode);
                }
            }
        }
        ++x;
        zeroIndegrees = nextTargetNode;
        nextTargetNode = [];
    }

    for (let i = 0; i < remainEdges.length; i++) {
        if (remainEdges[i] === 1) {
            throw new Error('Sankey is a DAG, the original data has cycle!');
        }
    }

    var maxDepth = maxNodeDepth > x - 1 ? maxNodeDepth : x - 1;
    if (nodeAlign && nodeAlign !== 'left') {
        adjustNodeWithNodeAlign(nodes, nodeAlign, orient, maxDepth);
    }
    var kx = orient === 'vertical'
        ? (height - nodeWidth) / maxDepth
        : (width - nodeWidth) / maxDepth;

    scaleNodeBreadths(nodes, kx, orient);
}

function isNodeDepth(node: GraphNode) {
    var item = node.hostGraph.data.getRawDataItem(node.dataIndex) as SankeyNodeItemOption;
    return item.depth != null && item.depth >= 0;
}

function adjustNodeWithNodeAlign(
    nodes: GraphNode[],
    nodeAlign: SankeySeriesOption['nodeAlign'],
    orient: LayoutOrient,
    maxDepth: number
) {
    if (nodeAlign === 'right') {
        var nextSourceNode: GraphNode[] = [];
        var remainNodes = nodes;
        var nodeHeight = 0;
        while (remainNodes.length) {
            for (var i = 0; i < remainNodes.length; i++) {
                var node = remainNodes[i];
                node.setLayout({skNodeHeight: nodeHeight}, true);
                for (var j = 0; j < node.inEdges.length; j++) {
                    var edge = node.inEdges[j];
                    if (nextSourceNode.indexOf(edge.node1) < 0) {
                        nextSourceNode.push(edge.node1);
                    }
                }
            }
            remainNodes = nextSourceNode;
            nextSourceNode = [];
            ++nodeHeight;
        }

        zrUtil.each(nodes, function (node) {
            if (!isNodeDepth(node)) {
                node.setLayout({depth: Math.max(0, maxDepth - node.getLayout().skNodeHeight)}, true);
            }
        });
    }
    else if (nodeAlign === 'justify') {
        moveSinksRight(nodes, maxDepth);
    }
}

/**
 * All the node without outEgdes are assigned maximum x-position and
 *     be aligned in the last column.
 *
 * @param nodes.  node of sankey view.
 * @param maxDepth.  use to assign to node without outEdges as x-position.
 */
function moveSinksRight(nodes: GraphNode[], maxDepth: number) {
    zrUtil.each(nodes, function (node) {
        if (!isNodeDepth(node) && !node.outEdges.length) {
            node.setLayout({depth: maxDepth}, true);
        }
    });
}

/**
 * Scale node x-position to the width
 *
 * @param nodes  node of sankey view
 * @param kx   multiple used to scale nodes
 */
function scaleNodeBreadths(nodes: GraphNode[], kx: number, orient: LayoutOrient) {
    zrUtil.each(nodes, function (node) {
        var nodeDepth = node.getLayout().depth * kx;
        orient === 'vertical'
            ? node.setLayout({y: nodeDepth}, true)
            : node.setLayout({x: nodeDepth}, true);
    });
}

/**
 * Using Gauss-Seidel iterations method to compute the node depth(y-position)
 *
 * @param nodes  node of sankey view
 * @param edges  edge of sankey view
 * @param height  the whole height of the area to draw the view
 * @param nodeGap  the vertical distance between two nodes
 *     in the same column.
 * @param iterations  the number of iterations for the algorithm
 */
function computeNodeDepths(
    nodes: GraphNode[],
    edges: GraphEdge[],
    height: number,
    width: number,
    nodeGap: number,
    iterations: number,
    orient: LayoutOrient
) {
    var nodesByBreadth = prepareNodesByBreadth(nodes, orient);

    initializeNodeDepth(nodesByBreadth, edges, height, width, nodeGap, orient);
    resolveCollisions(nodesByBreadth, nodeGap, height, width, orient);

    for (var alpha = 1; iterations > 0; iterations--) {
        // 0.99 is a experience parameter, ensure that each iterations of
        // changes as small as possible.
        alpha *= 0.99;
        relaxRightToLeft(nodesByBreadth, alpha, orient);
        resolveCollisions(nodesByBreadth, nodeGap, height, width, orient);
        relaxLeftToRight(nodesByBreadth, alpha, orient);
        resolveCollisions(nodesByBreadth, nodeGap, height, width, orient);
    }
}

function prepareNodesByBreadth(nodes: GraphNode[], orient: LayoutOrient) {
    var nodesByBreadth: GraphNode[][] = [];
    var keyAttr = orient === 'vertical' ? 'y' : 'x';

    var groupResult = groupData(nodes, function (node) {
        return node.getLayout()[keyAttr] as number;
    });
    groupResult.keys.sort(function (a, b) {
        return a - b;
    });
    zrUtil.each(groupResult.keys, function (key) {
        nodesByBreadth.push(groupResult.buckets.get(key));
    });

    return nodesByBreadth;
}

/**
 * Compute the original y-position for each node
 */
function initializeNodeDepth(
    nodesByBreadth: GraphNode[][],
    edges: GraphEdge[],
    height: number,
    width: number,
    nodeGap: number,
    orient: LayoutOrient
) {
    var minKy = Infinity;
    zrUtil.each(nodesByBreadth, function (nodes) {
        var n = nodes.length;
        var sum = 0;
        zrUtil.each(nodes, function (node) {
            sum += node.getLayout().value;
        });
        var ky = orient === 'vertical'
                    ? (width - (n - 1) * nodeGap) / sum
                    : (height - (n - 1) * nodeGap) / sum;

        if (ky < minKy) {
            minKy = ky;
        }
    });

    zrUtil.each(nodesByBreadth, function (nodes) {
        zrUtil.each(nodes, function (node, i) {
            var nodeDy = node.getLayout().value * minKy;
            if (orient === 'vertical') {
                node.setLayout({x: i}, true);
                node.setLayout({dx: nodeDy}, true);
            }
            else {
                node.setLayout({y: i}, true);
                node.setLayout({dy: nodeDy}, true);
            }
        });
    });

    zrUtil.each(edges, function (edge) {
        var edgeDy = +edge.getValue() * minKy;
        edge.setLayout({dy: edgeDy}, true);
    });
}

/**
 * Resolve the collision of initialized depth (y-position)
 */
function resolveCollisions(
    nodesByBreadth: GraphNode[][],
    nodeGap: number,
    height: number,
    width: number,
    orient: LayoutOrient
) {
    var keyAttr = orient === 'vertical' ? 'x' : 'y';
    zrUtil.each(nodesByBreadth, function (nodes) {
        nodes.sort(function (a, b) {
            return a.getLayout()[keyAttr] - b.getLayout()[keyAttr];
        });
        var nodeX;
        var node;
        var dy;
        var y0 = 0;
        var n = nodes.length;
        var nodeDyAttr = orient === 'vertical' ? 'dx' : 'dy';
        for (let i = 0; i < n; i++) {
            node = nodes[i];
            dy = y0 - node.getLayout()[keyAttr];
            if (dy > 0) {
                nodeX = node.getLayout()[keyAttr] + dy;
                orient === 'vertical'
                    ? node.setLayout({x: nodeX}, true)
                    : node.setLayout({y: nodeX}, true);
            }
            y0 = node.getLayout()[keyAttr] + node.getLayout()[nodeDyAttr] + nodeGap;
        }
        var viewWidth = orient === 'vertical' ? width : height;
        // If the bottommost node goes outside the bounds, push it back up
        dy = y0 - nodeGap - viewWidth;
        if (dy > 0) {
            nodeX = node.getLayout()[keyAttr] - dy;
            orient === 'vertical'
                ? node.setLayout({x: nodeX}, true)
                : node.setLayout({y: nodeX}, true);

            y0 = nodeX;
            for (let i = n - 2; i >= 0; --i) {
                node = nodes[i];
                dy = node.getLayout()[keyAttr] + node.getLayout()[nodeDyAttr] + nodeGap - y0;
                if (dy > 0) {
                    nodeX = node.getLayout()[keyAttr] - dy;
                    orient === 'vertical'
                        ? node.setLayout({x: nodeX}, true)
                        : node.setLayout({y: nodeX}, true);
                }
                y0 = node.getLayout()[keyAttr];
            }
        }
    });
}

/**
 * Change the y-position of the nodes, except most the right side nodes
 * @param nodesByBreadth
 * @param alpha  parameter used to adjust the nodes y-position
 */
function relaxRightToLeft(
    nodesByBreadth: GraphNode[][],
    alpha: number,
    orient: LayoutOrient
) {
    zrUtil.each(nodesByBreadth.slice().reverse(), function (nodes) {
        zrUtil.each(nodes, function (node) {
            if (node.outEdges.length) {
                var y = sum(node.outEdges, weightedTarget, orient)
                    / sum(node.outEdges, getEdgeValue);
                if (orient === 'vertical') {
                    var nodeX = node.getLayout().x + (y - center(node, orient)) * alpha;
                    node.setLayout({x: nodeX}, true);
                }
                else {
                    var nodeY = node.getLayout().y + (y - center(node, orient)) * alpha;
                    node.setLayout({y: nodeY}, true);
                }
            }
        });
    });
}

function weightedTarget(edge: GraphEdge, orient: LayoutOrient) {
    return center(edge.node2, orient) * (edge.getValue() as number);
}

function weightedSource(edge: GraphEdge, orient: LayoutOrient) {
    return center(edge.node1, orient) * (edge.getValue() as number);
}

function center(node: GraphNode, orient: LayoutOrient) {
    return orient === 'vertical'
            ? node.getLayout().x + node.getLayout().dx / 2
            : node.getLayout().y + node.getLayout().dy / 2;
}

function getEdgeValue(edge: GraphEdge) {
    return edge.getValue() as number;
}

function sum<T>(array: T[], cb: (item: T, orient?: LayoutOrient) => number, orient?: LayoutOrient) {
    var sum = 0;
    var len = array.length;
    var i = -1;
    while (++i < len) {
        var value = +cb(array[i], orient);
        if (!isNaN(value)) {
            sum += value;
        }
    }
    return sum;
}

/**
 * Change the y-position of the nodes, except most the left side nodes
 */
function relaxLeftToRight(nodesByBreadth: GraphNode[][], alpha: number, orient: LayoutOrient) {
    zrUtil.each(nodesByBreadth, function (nodes) {
        zrUtil.each(nodes, function (node) {
            if (node.inEdges.length) {
                var y = sum(node.inEdges, weightedSource, orient)
                        / sum(node.inEdges, getEdgeValue);
                if (orient === 'vertical') {
                    var nodeX = node.getLayout().x + (y - center(node, orient)) * alpha;
                    node.setLayout({x: nodeX}, true);
                }
                else {
                    var nodeY = node.getLayout().y + (y - center(node, orient)) * alpha;
                    node.setLayout({y: nodeY}, true);
                }
            }
        });
    });
}

/**
 * Compute the depth(y-position) of each edge
 */
function computeEdgeDepths(nodes: GraphNode[], orient: LayoutOrient) {
    var keyAttr = orient === 'vertical' ? 'x' : 'y';
    zrUtil.each(nodes, function (node) {
        node.outEdges.sort(function (a, b) {
            return a.node2.getLayout()[keyAttr] - b.node2.getLayout()[keyAttr];
        });
        node.inEdges.sort(function (a, b) {
            return a.node1.getLayout()[keyAttr] - b.node1.getLayout()[keyAttr];
        });
    });
    zrUtil.each(nodes, function (node) {
        var sy = 0;
        var ty = 0;
        zrUtil.each(node.outEdges, function (edge) {
            edge.setLayout({sy: sy}, true);
            sy += edge.getLayout().dy;
        });
        zrUtil.each(node.inEdges, function (edge) {
            edge.setLayout({ty: ty}, true);
            ty += edge.getLayout().dy;
        });
    });
}