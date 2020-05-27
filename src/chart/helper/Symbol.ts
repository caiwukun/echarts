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

import {createSymbol} from '../../util/symbol';
import * as graphic from '../../util/graphic';
import {parsePercent} from '../../util/number';
import {getDefaultLabel} from './labelHelper';
import List from '../../data/List';
import { DisplayState, ColorString } from '../../util/types';
import SeriesModel from '../../model/Series';
import { PathProps } from 'zrender/src/graphic/Path';
import { SymbolDrawSeriesScope, SymbolDrawItemModelOption } from './SymbolDraw';
import { extend } from 'zrender/src/core/util';

// Update common properties
const emphasisStyleAccessPath = ['emphasis', 'itemStyle'] as const;
const normalLabelAccessPath = ['label'] as const;
const emphasisLabelAccessPath = ['emphasis', 'label'] as const;

type ECSymbol = ReturnType<typeof createSymbol> & {
    onStateChange(fromState: DisplayState, toState: DisplayState): void
};

class Symbol extends graphic.Group {

    private _seriesModel: SeriesModel;

    private _symbolType: string;

    /**
     * Original scale
     */
    private _scaleX: number;
    private _scaleY: number;

    private _z2: number;

    constructor(data: List, idx: number, seriesScope?: SymbolDrawSeriesScope) {
        super();
        this.updateData(data, idx, seriesScope);
    }

    _createSymbol(
        symbolType: string,
        data: List,
        idx: number,
        symbolSize: number[],
        keepAspect: boolean
    ) {
        // Remove paths created before
        this.removeAll();

        // let symbolPath = createSymbol(
        //     symbolType, -0.5, -0.5, 1, 1, color
        // );
        // If width/height are set too small (e.g., set to 1) on ios10
        // and macOS Sierra, a circle stroke become a rect, no matter what
        // the scale is set. So we set width/height as 2. See #4150.
        const symbolPath = createSymbol(
            symbolType, -1, -1, 2, 2, null, keepAspect
        );

        symbolPath.attr({
            z2: 100,
            culling: true,
            scaleX: symbolSize[0] / 2,
            scaleY: symbolSize[1] / 2
        });
        // Rewrite drift method
        symbolPath.drift = driftSymbol;

        this._symbolType = symbolType;

        this.add(symbolPath);
    }

    /**
     * Stop animation
     * @param {boolean} toLastFrame
     */
    stopSymbolAnimation(toLastFrame: boolean) {
        this.childAt(0).stopAnimation(toLastFrame);
    }

    /**
     * FIXME:
     * Caution: This method breaks the encapsulation of this module,
     * but it indeed brings convenience. So do not use the method
     * unless you detailedly know all the implements of `Symbol`,
     * especially animation.
     *
     * Get symbol path element.
     */
    getSymbolPath() {
        return this.childAt(0) as ECSymbol;
    }

    /**
     * Get scale(aka, current symbol size).
     * Including the change caused by animation
     */
    getScale() {
        const symbolPath = this.childAt(0);
        return [symbolPath.scaleX, symbolPath.scaleY];
    }

    getOriginalScale() {
        return [this._scaleX, this._scaleY];
    }

    /**
     * Highlight symbol
     */
    highlight() {
        graphic.enterEmphasis(this.childAt(0));
    }

    /**
     * Downplay symbol
     */
    downplay() {
        graphic.leaveEmphasis(this.childAt(0));
    }

    /**
     * @param {number} zlevel
     * @param {number} z
     */
    setZ(zlevel: number, z: number) {
        const symbolPath = this.childAt(0) as ECSymbol;
        symbolPath.zlevel = zlevel;
        symbolPath.z = z;
    }

    setDraggable(draggable: boolean) {
        const symbolPath = this.childAt(0) as ECSymbol;
        symbolPath.draggable = draggable;
        symbolPath.cursor = draggable ? 'move' : symbolPath.cursor;
    }

    /**
     * Update symbol properties
     */
    updateData(data: List, idx: number, seriesScope?: SymbolDrawSeriesScope) {
        this.silent = false;

        const symbolType = data.getItemVisual(idx, 'symbol') || 'circle';
        const seriesModel = data.hostModel as SeriesModel;
        const symbolSize = Symbol.getSymbolSize(data, idx);
        const isInit = symbolType !== this._symbolType;

        if (isInit) {
            const keepAspect = data.getItemVisual(idx, 'symbolKeepAspect');
            this._createSymbol(symbolType as string, data, idx, symbolSize, keepAspect);
        }
        else {
            const symbolPath = this.childAt(0) as ECSymbol;
            symbolPath.silent = false;
            graphic.updateProps(symbolPath, {
                scaleX: symbolSize[0] / 2,
                scaleY: symbolSize[1] / 2
            }, seriesModel, idx);
        }

        this._updateCommon(data, idx, symbolSize, seriesScope);

        if (isInit) {
            const symbolPath = this.childAt(0) as ECSymbol;
            // Always fadeIn. Because it has fadeOut animation when symbol is removed..
            // const fadeIn = seriesScope && seriesScope.fadeIn;
            const fadeIn = true;

            const target: PathProps = {
                scaleX: this._scaleX,
                scaleY: this._scaleY
            };
            fadeIn && (target.style = {
                opacity: symbolPath.style.opacity
            });

            symbolPath.scaleX = symbolPath.scaleY = 0;
            fadeIn && (symbolPath.style.opacity = 0);

            graphic.initProps(symbolPath, target, seriesModel, idx);
        }

        this._seriesModel = seriesModel;
    }

    _updateCommon(
        data: List,
        idx: number,
        symbolSize: number[],
        seriesScope?: SymbolDrawSeriesScope
    ) {
        const symbolPath = this.childAt(0) as ECSymbol;
        const seriesModel = data.hostModel as SeriesModel;

        let hoverItemStyle = seriesScope && seriesScope.hoverItemStyle;
        let symbolOffset = seriesScope && seriesScope.symbolOffset;
        let labelModel = seriesScope && seriesScope.labelModel;
        let hoverLabelModel = seriesScope && seriesScope.hoverLabelModel;
        let hoverAnimation = seriesScope && seriesScope.hoverAnimation;
        let cursorStyle = seriesScope && seriesScope.cursorStyle;

        if (!seriesScope || data.hasItemOption) {
            const itemModel = (seriesScope && seriesScope.itemModel)
                ? seriesScope.itemModel : data.getItemModel<SymbolDrawItemModelOption>(idx);

            hoverItemStyle = itemModel.getModel(emphasisStyleAccessPath).getItemStyle();

            symbolOffset = itemModel.getShallow('symbolOffset');

            labelModel = itemModel.getModel(normalLabelAccessPath);
            hoverLabelModel = itemModel.getModel(emphasisLabelAccessPath);
            hoverAnimation = itemModel.getShallow('hoverAnimation');
            cursorStyle = itemModel.getShallow('cursor');
        }

        const symbolRotate = data.getItemVisual(idx, 'symbolRotate');

        symbolPath.attr('rotation', (symbolRotate || 0) * Math.PI / 180 || 0);

        if (symbolOffset) {
            symbolPath.x = parsePercent(symbolOffset[0], symbolSize[0]);
            symbolPath.y = parsePercent(symbolOffset[1], symbolSize[1]);
        }

        cursorStyle && symbolPath.attr('cursor', cursorStyle);

        // PENDING setColor before setStyle!!!
        const symbolStyle = data.getItemVisual(idx, 'style');
        const visualColor = symbolStyle.fill;
        if (symbolPath.__isEmptyBrush) {
            // fill and stroke will be swapped if it's empty.
            // So we cloned a new style to avoid it affecting the original style in visual storage.
            // TODO Better implementation. No empty logic!
            symbolPath.useStyle(extend({}, symbolStyle));
        }
        else {
            symbolPath.useStyle(symbolStyle);
        }
        symbolPath.setColor(visualColor, seriesScope && seriesScope.symbolInnerColor);
        symbolPath.style.strokeNoScale = true;

        const liftZ = data.getItemVisual(idx, 'liftZ');
        const z2Origin = this._z2;
        if (liftZ != null) {
            if (z2Origin == null) {
                this._z2 = symbolPath.z2;
                symbolPath.z2 += liftZ;
            }
        }
        else if (z2Origin != null) {
            symbolPath.z2 = z2Origin;
            this._z2 = null;
        }

        const useNameLabel = seriesScope && seriesScope.useNameLabel;

        graphic.setLabelStyle(
            symbolPath, labelModel, hoverLabelModel,
            {
                labelFetcher: seriesModel,
                labelDataIndex: idx,
                defaultText: getLabelDefaultText,
                autoColor: visualColor as ColorString
            }
        );

        // Do not execute util needed.
        function getLabelDefaultText(idx: number) {
            return useNameLabel ? data.getName(idx) : getDefaultLabel(data, idx);
        }

        this._scaleX = symbolSize[0] / 2;
        this._scaleY = symbolSize[1] / 2;
        symbolPath.onStateChange = (
            hoverAnimation && seriesModel.isAnimationEnabled()
        ) ? onStateChange : null;

        graphic.enableHoverEmphasis(symbolPath, hoverItemStyle);
    }

    fadeOut(cb: () => void, opt?: {
        keepLabel: boolean
    }) {
        const symbolPath = this.childAt(0) as ECSymbol;
        // Avoid mistaken hover when fading out
        this.silent = symbolPath.silent = true;
        // Not show text when animating
        !(opt && opt.keepLabel) && (symbolPath.removeTextContent());

        graphic.updateProps(
            symbolPath,
            {
                style: {
                    opacity: 0
                },
                scaleX: 0,
                scaleY: 0
            },
            this._seriesModel,
            graphic.getECData(this).dataIndex,
            cb
        );
    }

    static getSymbolSize(data: List, idx: number) {
        const symbolSize = data.getItemVisual(idx, 'symbolSize');
        return symbolSize instanceof Array
            ? symbolSize.slice()
            : [+symbolSize, +symbolSize];
    }
}

function onStateChange(this: ECSymbol, fromState: DisplayState, toState: DisplayState) {
    // Do not support this hover animation util some scenario required.
    // Animation can only be supported in hover layer when using `el.incremetal`.
    if (this.incremental || this.useHoverLayer) {
        return;
    }

    const scale = (this.parent as Symbol).getOriginalScale();
    if (toState === 'emphasis') {
        const ratio = scale[1] / scale[0];
        const emphasisOpt = {
            scaleX: Math.max(scale[0] * 1.1, scale[0] + 3),
            scaleY: Math.max(scale[1] * 1.1, scale[1] + 3 * ratio)
        };
        // FIXME
        // modify it after support stop specified animation.
        // toState === fromState
        //     ? (this.stopAnimation(), this.attr(emphasisOpt))
        this.animateTo(emphasisOpt, { duration: 400, easing: 'elasticOut' });
    }
    else if (toState === 'normal') {
        this.animateTo({
            scaleX: scale[0],
            scaleY: scale[1]
        }, { duration: 400, easing: 'elasticOut' });
    }
}

function driftSymbol(this: ECSymbol, dx: number, dy: number) {
    this.parent.drift(dx, dy);
}


export default Symbol;