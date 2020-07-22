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
import { enterEmphasis, leaveEmphasis, enableHoverEmphasis } from '../../util/states';
import {parsePercent} from '../../util/number';
import {getDefaultLabel} from './labelHelper';
import List from '../../data/List';
import { ColorString, BlurScope } from '../../util/types';
import SeriesModel from '../../model/Series';
import { PathProps } from 'zrender/src/graphic/Path';
import { SymbolDrawSeriesScope, SymbolDrawItemModelOption } from './SymbolDraw';
import { extend } from 'zrender/src/core/util';
import { setLabelStyle, getLabelStatesModels } from '../../label/labelStyle';

type ECSymbol = ReturnType<typeof createSymbol>;

interface SymbolOpts {
    useNameLabel?: boolean
    symbolInnerColor?: string
}

class Symbol extends graphic.Group {

    private _seriesModel: SeriesModel;

    private _symbolType: string;

    /**
     * Original scale
     */
    private _sizeX: number;
    private _sizeY: number;

    private _z2: number;

    constructor(data: List, idx: number, seriesScope?: SymbolDrawSeriesScope, opts?: SymbolOpts) {
        super();
        this.updateData(data, idx, seriesScope, opts);
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
        this.childAt(0).stopAnimation(null, toLastFrame);
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
     * Highlight symbol
     */
    highlight() {
        enterEmphasis(this.childAt(0));
    }

    /**
     * Downplay symbol
     */
    downplay() {
        leaveEmphasis(this.childAt(0));
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
    updateData(data: List, idx: number, seriesScope?: SymbolDrawSeriesScope, opts?: SymbolOpts) {
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

        this._updateCommon(data, idx, symbolSize, seriesScope, opts);

        if (isInit) {
            const symbolPath = this.childAt(0) as ECSymbol;

            const target: PathProps = {
                scaleX: this._sizeX,
                scaleY: this._sizeY,
                style: {
                    // Always fadeIn. Because it has fadeOut animation when symbol is removed..
                    opacity: symbolPath.style.opacity
                }
            };

            symbolPath.scaleX = symbolPath.scaleY = 0;
            symbolPath.style.opacity = 0;

            graphic.initProps(symbolPath, target, seriesModel, idx);
        }

        this._seriesModel = seriesModel;
    }

    _updateCommon(
        data: List,
        idx: number,
        symbolSize: number[],
        seriesScope?: SymbolDrawSeriesScope,
        opts?: SymbolOpts
    ) {
        const symbolPath = this.childAt(0) as ECSymbol;
        const seriesModel = data.hostModel as SeriesModel;

        let itemStyle;
        let emphasisItemStyle;
        let blurItemStyle;
        let selectItemStyle;
        let focus;
        let blurScope: BlurScope;

        let symbolOffset;

        let labelStatesModels;

        let hoverScale;
        let cursorStyle;

        if (seriesScope) {
            itemStyle = seriesScope.itemStyle;
            emphasisItemStyle = seriesScope.emphasisItemStyle;
            blurItemStyle = seriesScope.blurItemStyle;
            selectItemStyle = seriesScope.selectItemStyle;
            focus = seriesScope.focus;
            blurScope = seriesScope.blurScope;

            symbolOffset = seriesScope.symbolOffset;

            labelStatesModels = seriesScope.labelStatesModels;

            hoverScale = seriesScope.hoverScale;
            cursorStyle = seriesScope.cursorStyle;
        }

        if (!seriesScope || data.hasItemOption) {
            const itemModel = (seriesScope && seriesScope.itemModel)
                ? seriesScope.itemModel : data.getItemModel<SymbolDrawItemModelOption>(idx);
            const emphasisModel = itemModel.getModel('emphasis');

            itemStyle = itemModel.getModel('itemStyle').getItemStyle(['color']);
            emphasisItemStyle = emphasisModel.getModel('itemStyle').getItemStyle();
            selectItemStyle = itemModel.getModel(['select', 'itemStyle']).getItemStyle();
            blurItemStyle = itemModel.getModel(['blur', 'itemStyle']).getItemStyle();

            focus = emphasisModel.get('focus');
            blurScope = emphasisModel.get('blurScope');

            symbolOffset = itemModel.getShallow('symbolOffset');

            labelStatesModels = getLabelStatesModels(itemModel);

            hoverScale = emphasisModel.getShallow('scale');
            cursorStyle = itemModel.getShallow('cursor');
        }

        const symbolRotate = data.getItemVisual(idx, 'symbolRotate');

        symbolPath.attr('rotation', (symbolRotate || 0) * Math.PI / 180 || 0);

        if (symbolOffset) {
            symbolPath.x = parsePercent(symbolOffset[0], symbolSize[0]);
            symbolPath.y = parsePercent(symbolOffset[1], symbolSize[1]);
        }

        cursorStyle && symbolPath.attr('cursor', cursorStyle);
        const symbolStyle = extend(extend({}, data.getItemVisual(idx, 'style')), itemStyle);
        const visualColor = symbolStyle.fill;
        symbolPath.useStyle(symbolStyle);
        symbolPath.setColor(visualColor, opts && opts.symbolInnerColor);
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

        const useNameLabel = opts && opts.useNameLabel;

        setLabelStyle(
            symbolPath, labelStatesModels,
            {
                labelFetcher: seriesModel,
                labelDataIndex: idx,
                defaultText: getLabelDefaultText,
                inheritColor: visualColor as ColorString
            }
        );

        // Do not execute util needed.
        function getLabelDefaultText(idx: number) {
            return useNameLabel ? data.getName(idx) : getDefaultLabel(data, idx);
        }

        this._sizeX = symbolSize[0] / 2;
        this._sizeY = symbolSize[1] / 2;

        symbolPath.ensureState('emphasis').style = emphasisItemStyle;
        symbolPath.ensureState('select').style = selectItemStyle;
        symbolPath.ensureState('blur').style = blurItemStyle;

        if (hoverScale) {
            this.ensureState('emphasis');
            this.setSymbolScale(1);
        }
        else {
            this.states.emphasis = null;
        }

        enableHoverEmphasis(this, focus, blurScope);
    }

    setSymbolScale(scale: number) {
        const emphasisState = this.states.emphasis;
        if (emphasisState) {
            const hoverScale = Math.max(scale * 1.1, 3 / this._sizeY + scale);
            emphasisState.scaleX = hoverScale;
            emphasisState.scaleY = hoverScale;
        }

        this.scaleX = this.scaleY = scale;
    }

    fadeOut(cb: () => void, opt?: {
        keepLabel: boolean
    }) {
        const symbolPath = this.childAt(0) as ECSymbol;
        // Avoid mistaken hover when fading out
        this.silent = symbolPath.silent = true;
        // Not show text when animating
        !(opt && opt.keepLabel) && (symbolPath.removeTextContent());

        graphic.removeElement(
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


function driftSymbol(this: ECSymbol, dx: number, dy: number) {
    this.parent.drift(dx, dy);
}


export default Symbol;
