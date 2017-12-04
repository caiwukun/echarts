import * as zrUtil from 'zrender/src/core/util';
import * as graphic from '../../util/graphic';
import ChartView from '../../view/Chart';
import SunburstPiece from './SunburstPiece';
import DataDiffer from '../../data/DataDiffer';

var SunburstView = ChartView.extend({

    type: 'sunburst',

    init: function () {
        var sectorGroup = new graphic.Group();
        this._sectorGroup = sectorGroup;

        /**
         * @private
         * @type {module:echarts/data/Tree}
         */
        this._oldTree;
    },

    render: function (seriesModel, ecModel, api, payload) {
        if (payload && (payload.from === this.uid)) {
            return;
        }

        var oldTree = this._oldTree;
        var newTree = seriesModel.getData().tree;
        // var treeRoot = seriesModel.getData().tree.root;

        // var oldData = this._data;
        var group = this.group;

        // var hasAnimation = ecModel.get('animation');
        // var isFirstRender = !oldData;
        // var animationType = seriesModel.get('animationType');

        // var onSectorClick = zrUtil.curry(
        //     updateDataSelected, this.uid, seriesModel, hasAnimation, api
        // );

        // treeRoot.eachNode(function (node) {
        //     if (node !== treeRoot) {
        //         var piece = new SunburstPiece(node, seriesModel, ecModel);
        //         node.piece = piece;
        //         group.add(piece);
        //     }
        // });

        dualTravel(
            newTree.root ? [newTree.root] : [],
            (oldTree && oldTree.root) ? [oldTree.root] : []
        );

        this._data = newTree.root;
        this._oldTree = newTree;

        function dualTravel(newChildren, oldChildren) {
            if (newChildren.length === 0 && oldChildren.length === 0) {
                return;
            }

            new DataDiffer(oldChildren, newChildren, getKey, getKey)
                .add(processNode)
                .update(processNode)
                .remove(zrUtil.curry(processNode, null))
                .execute();

            function getKey(node) {
                return node.getId();
            }

            function processNode(newId, oldId) {
                var newNode = newId == null ? null : newChildren[newId];
                var oldNode = oldId == null ? null : oldChildren[oldId];

                doRenderNode(newNode, oldNode);

                dualTravel(
                    newNode && newNode.children || [],
                    oldNode && oldNode.children || []
                );
            }
        }

        function doRenderNode(newNode, oldNode) {
            if (newNode !== newTree.root) {
                if (oldNode && oldNode.piece) {
                    if (newNode) {
                        // Update
                        oldNode.piece
                            .updateData(false, newNode, seriesModel, ecModel);
                    }
                    else {
                        // Remove
                        group.remove(oldNode.piece);
                    }
                }
                else {
                    // Add
                    var piece = new SunburstPiece(
                        newNode,
                        seriesModel,
                        ecModel
                    );
                    group.add(piece);
                }
            }
        }
    },

    dispose: function () {},

    _createClipPath: function (
        cx, cy, r, startAngle, clockwise, cb, seriesModel
    ) {
        var clipPath = new graphic.Sector({
            shape: {
                cx: cx,
                cy: cy,
                r0: 0,
                r: r,
                startAngle: startAngle,
                endAngle: startAngle,
                clockwise: clockwise
            }
        });

        graphic.initProps(clipPath, {
            shape: {
                endAngle: startAngle + (clockwise ? 1 : -1) * Math.PI * 2
            }
        }, seriesModel, cb);

        return clipPath;
    },

    /**
     * @implement
     */
    containPoint: function (point, seriesModel) {
        var treeRoot = seriesModel.getData();
        var itemLayout = treeRoot.getItemLayout(0);
        if (itemLayout) {
            var dx = point[0] - itemLayout.cx;
            var dy = point[1] - itemLayout.cy;
            var radius = Math.sqrt(dx * dx + dy * dy);
            return radius <= itemLayout.r && radius >= itemLayout.r0;
        }
    }

});

export default SunburstView;
