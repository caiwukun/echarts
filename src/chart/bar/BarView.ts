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

import {__DEV__} from '../../config';
import {
    Rect,
    Sector,
    getECData,
    updateProps,
    initProps,
    updateLabel,
    initLabel,
    removeElement} from '../../util/graphic';
import { enableHoverEmphasis, setStatesStylesFromModel } from '../../util/states';
import { setLabelStyle } from '../../label/labelStyle';
import Path, { PathProps } from 'zrender/src/graphic/Path';
import Group from 'zrender/src/graphic/Group';
import {throttle} from '../../util/throttle';
import {createClipPath} from '../helper/createClipPathFromCoordSys';
import Sausage from '../../util/shape/sausage';
import ChartView from '../../view/Chart';
import List, {DefaultDataVisual} from '../../data/List';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../ExtensionAPI';
import {
    StageHandlerProgressParams,
    ZRElementEvent,
    ColorString,
    OrdinalSortInfo,
    Payload,
    OrdinalNumber,
    ParsedValue
} from '../../util/types';
import BarSeriesModel, { BarSeriesOption, BarDataItemOption } from './BarSeries';
import type Axis2D from '../../coord/cartesian/Axis2D';
import type Cartesian2D from '../../coord/cartesian/Cartesian2D';
import type { RectLike } from 'zrender/src/core/BoundingRect';
import type Model from '../../model/Model';
import { isCoordinateSystemType } from '../../coord/CoordinateSystem';
import { getDefaultLabel } from '../helper/labelHelper';
import OrdinalScale from '../../scale/Ordinal';
import AngleAxis from '../../coord/polar/AngleAxis';
import RadiusAxis from '../../coord/polar/RadiusAxis';
import { extend, map, defaults, each } from 'zrender/src/core/util';

const BAR_BORDER_WIDTH_QUERY = ['itemStyle', 'borderWidth'] as const;
const BAR_BORDER_RADIUS_QUERY = ['itemStyle', 'borderRadius'] as const;
const _eventPos = [0, 0];

const mathMax = Math.max;
const mathMin = Math.min;

type CoordSysOfBar = BarSeriesModel['coordinateSystem'];
type RectShape = Rect['shape'];
type SectorShape = Sector['shape'];

type SectorLayout = SectorShape;
type RectLayout = RectShape;

type BarPossiblePath = Sector | Rect | Sausage;

function getClipArea(coord: CoordSysOfBar, data: List) {
    let coordSysClipArea;
    if (isCoordinateSystemType<Cartesian2D>(coord, 'cartesian2d')) {
        coordSysClipArea = coord.getArea && coord.getArea();
        const baseAxis = coord.getBaseAxis();
        // When boundaryGap is false or using time axis. bar may exceed the grid.
        // We should not clip this part.
        // See test/bar2.html
        if (baseAxis.type !== 'category' || !baseAxis.onBand) {
            const expandWidth = data.getLayout('bandWidth');
            if (baseAxis.isHorizontal()) {
                coordSysClipArea.x -= expandWidth;
                coordSysClipArea.width += expandWidth * 2;
            }
            else {
                coordSysClipArea.y -= expandWidth;
                coordSysClipArea.height += expandWidth * 2;
            }
        }
    }

    return coordSysClipArea;
}


class BarView extends ChartView {
    static type = 'bar' as const;
    type = BarView.type;

    private _data: List;

    private _isLargeDraw: boolean;

    private _backgroundGroup: Group;

    private _backgroundEls: (Rect | Sector)[];

    render(seriesModel: BarSeriesModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload) {
        this._updateDrawMode(seriesModel);

        const coordinateSystemType = seriesModel.get('coordinateSystem');
        const isReorder = payload && payload.type === 'changeAxisOrder';

        if (coordinateSystemType === 'cartesian2d'
            || coordinateSystemType === 'polar'
        ) {
            this._isLargeDraw
                ? this._renderLarge(seriesModel, ecModel, api)
                : this._renderNormal(seriesModel, ecModel, api, isReorder);
        }
        else if (__DEV__) {
            console.warn('Only cartesian2d and polar supported for bar.');
        }
    }

    incrementalPrepareRender(seriesModel: BarSeriesModel): void {
        this._clear();
        this._updateDrawMode(seriesModel);
        // incremental also need to clip, otherwise might be overlow.
        // But must not set clip in each frame, otherwise all of the children will be marked redraw.
        this._updateLargeClip(seriesModel);
    }

    incrementalRender(params: StageHandlerProgressParams, seriesModel: BarSeriesModel): void {
        // Do not support progressive in normal mode.
        this._incrementalRenderLarge(params, seriesModel);
    }

    private _updateDrawMode(seriesModel: BarSeriesModel): void {
        const isLargeDraw = seriesModel.pipelineContext.large;
        if (this._isLargeDraw == null || isLargeDraw !== this._isLargeDraw) {
            this._isLargeDraw = isLargeDraw;
            this._clear();
        }
    }

    private _renderNormal(
        seriesModel: BarSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        isReorder: boolean
    ): void {
        const that = this;
        const group = this.group;
        const data = seriesModel.getData();
        const oldData = this._data;

        const coord = seriesModel.coordinateSystem;
        const baseAxis = coord.getBaseAxis();
        let valueAxis: Axis2D | RadiusAxis | AngleAxis;
        let isHorizontalOrRadial: boolean;

        if (coord.type === 'cartesian2d') {
            isHorizontalOrRadial = (baseAxis as Axis2D).isHorizontal();
            valueAxis = coord.getOtherAxis(baseAxis as Axis2D);
        }
        else if (coord.type === 'polar') {
            isHorizontalOrRadial = baseAxis.dim === 'angle';
            valueAxis = coord.getOtherAxis(baseAxis as (AngleAxis | RadiusAxis));
        }

        const animationModel = seriesModel.isAnimationEnabled() ? seriesModel : null;
        const axisAnimationModel = baseAxis.model;

        const axis2DModel = (baseAxis as Axis2D).model;
        const axisSort = coord.type === 'cartesian2d' && axis2DModel.get('sort')
            && axis2DModel.get('sortSeriesIndex') === seriesModel.seriesIndex;
        const realtimeSort = axisSort && axis2DModel.get('realtimeSort');

        const needsClip = seriesModel.get('clip', true);
        const coordSysClipArea = getClipArea(coord, data);
        // If there is clipPath created in large mode. Remove it.
        group.removeClipPath();
        // We don't use clipPath in normal mode because we needs a perfect animation
        // And don't want the label are clipped.

        const labelModel = seriesModel.getModel('label');

        const roundCap = seriesModel.get('roundCap', true);

        const drawBackground = seriesModel.get('showBackground', true);
        const backgroundModel = seriesModel.getModel('backgroundStyle');
        const barBorderRadius = backgroundModel.get('borderRadius') || 0;

        const bgEls: BarView['_backgroundEls'] = [];
        const oldBgEls = this._backgroundEls;

        let hasDuringForOneData = false;
        let getDuring: () => (() => void) = () => {
            return null;
        };
        if (coord.type === 'cartesian2d') {
            const oldOrder = (baseAxis.scale as OrdinalScale).getCategorySortInfo();
            const orderMap = (idx: number) => {
                return data.get(valueAxis.dim, idx) as number;
            };

            if (realtimeSort) {
                // Sort in animation during
                const isOrderChanged = this._isDataOrderChanged(data, orderMap, oldOrder);
                if (isOrderChanged) {
                    getDuring = () => {
                        if (!hasDuringForOneData) {
                            hasDuringForOneData = true;
                            return () => {
                                const orderMap = (idx: number) => {
                                    const el = (data.getItemGraphicEl(idx) as Rect);
                                    if (el) {
                                        const shape = el.shape;
                                        return isHorizontalOrRadial ? shape.y + shape.height : shape.x + shape.width;
                                    }
                                    else {
                                        return 0;
                                    }
                                };
                                that._updateSort(data, orderMap, baseAxis as Axis2D, api);
                            };
                        }
                        else {
                            return () => null;
                        }
                    };
                }
            }
            else if (axisSort) {
                // Sort now in the first frame
                this._updateSort(data, orderMap, baseAxis as Axis2D, api);
            }
        }


        data.diff(oldData)
            .add(function (dataIndex) {
                const itemModel = data.getItemModel(dataIndex);
                const layout = getLayout[coord.type](data, dataIndex, itemModel);

                if (drawBackground) {
                    const bgLayout = getLayout[coord.type](data, dataIndex);
                    const bgEl = createBackgroundEl(coord, isHorizontalOrRadial, bgLayout);
                    bgEl.useStyle(backgroundModel.getItemStyle());
                    // Only cartesian2d support borderRadius.
                    if (coord.type === 'cartesian2d') {
                        (bgEl as Rect).setShape('r', barBorderRadius);
                    }
                    bgEls[dataIndex] = bgEl;
                }

                // If dataZoom in filteMode: 'empty', the baseValue can be set as NaN in "axisProxy".
                if (!data.hasValue(dataIndex)) {
                    return;
                }

                if (needsClip) {
                    // Clip will modify the layout params.
                    // And return a boolean to determine if the shape are fully clipped.
                    const isClipped = clip[coord.type](coordSysClipArea, layout);
                    if (isClipped) {
                        // group.remove(el);
                        return;
                    }
                }

                const el = elementCreator[coord.type](
                    seriesModel,
                    data,
                    dataIndex,
                    layout,
                    isHorizontalOrRadial,
                    animationModel,
                    false,
                    getDuring(),
                    roundCap
                );
                data.setItemGraphicEl(dataIndex, el);
                group.add(el);

                updateStyle(
                    el, data, dataIndex, itemModel, layout,
                    seriesModel, isHorizontalOrRadial, coord.type === 'polar'
                );
            })
            .update(function (newIndex, oldIndex) {
                const itemModel = data.getItemModel(newIndex);
                const layout = getLayout[coord.type](data, newIndex, itemModel);

                if (drawBackground) {
                    const bgEl = oldBgEls[oldIndex];
                    bgEl.useStyle(backgroundModel.getItemStyle());
                    // Only cartesian2d support borderRadius.
                    if (coord.type === 'cartesian2d') {
                        (bgEl as Rect).setShape('r', barBorderRadius);
                    }
                    bgEls[newIndex] = bgEl;

                    const bgLayout = getLayout[coord.type](data, newIndex);
                    const shape = createBackgroundShape(isHorizontalOrRadial, bgLayout, coord);
                    updateProps(
                        bgEl as Path, { shape: shape }, animationModel, newIndex
                    );
                }

                let el = oldData.getItemGraphicEl(oldIndex) as BarPossiblePath;
                if (!data.hasValue(newIndex)) {
                    group.remove(el);
                    return;
                }

                if (needsClip) {
                    const isClipped = clip[coord.type](coordSysClipArea, layout);
                    if (isClipped) {
                        group.remove(el);
                        return;
                    }
                }

                if (el) {
                    if (coord.type === 'cartesian2d'
                        && baseAxis.type === 'category' && (baseAxis as Axis2D).model.get('sort')
                    ) {
                        const rect = layout as RectShape;
                        let seriesShape;
                        let axisShape;
                        if (baseAxis.dim === 'x') {
                            axisShape = {
                                x: rect.x,
                                width: rect.width
                            };
                            seriesShape = {
                                y: rect.y,
                                height: rect.height
                            };
                        }
                        else {
                            axisShape = {
                                y: rect.y,
                                height: rect.height
                            };
                            seriesShape = {
                                x: rect.x,
                                width: rect.width
                            };
                        }

                        if (!isReorder) {
                            updateProps(
                                el as Path,
                                { shape: seriesShape },
                                animationModel,
                                newIndex,
                                null,
                                getDuring()
                            );
                        }
                        updateProps(el as Path, { shape: axisShape }, axisAnimationModel, newIndex, null);
                    }
                    else {
                        updateProps(el as Path, {
                            shape: layout
                        }, animationModel, newIndex, null);
                    }

                    const defaultTextGetter = (values: ParsedValue | ParsedValue[]) => {
                        return getDefaultLabel(seriesModel.getData(), newIndex, values);
                    };
                    updateLabel(el, data, newIndex, labelModel, seriesModel, animationModel, defaultTextGetter);
                }
                else {
                    el = elementCreator[coord.type](
                        seriesModel,
                        data,
                        newIndex,
                        layout,
                        isHorizontalOrRadial,
                        animationModel,
                        true,
                        getDuring(),
                        roundCap
                    );
                }

                data.setItemGraphicEl(newIndex, el);
                // Add back
                group.add(el);

                updateStyle(
                    el, data, newIndex, itemModel, layout,
                    seriesModel, isHorizontalOrRadial, coord.type === 'polar'
                );
            })
            .remove(function (dataIndex) {
                const el = oldData.getItemGraphicEl(dataIndex);
                if (coord.type === 'cartesian2d') {
                    el && removeRect(dataIndex, animationModel, el as Rect);
                }
                else {
                    el && removeSector(dataIndex, animationModel, el as Sector);
                }
            })
            .execute();

        const bgGroup = this._backgroundGroup || (this._backgroundGroup = new Group());
        bgGroup.removeAll();

        for (let i = 0; i < bgEls.length; ++i) {
            bgGroup.add(bgEls[i]);
        }
        group.add(bgGroup);
        this._backgroundEls = bgEls;

        this._data = data;
    }

    private _renderLarge(seriesModel: BarSeriesModel, ecModel: GlobalModel, api: ExtensionAPI): void {
        this._clear();
        createLarge(seriesModel, this.group);
        this._updateLargeClip(seriesModel);
    }

    private _incrementalRenderLarge(params: StageHandlerProgressParams, seriesModel: BarSeriesModel): void {
        this._removeBackground();
        createLarge(seriesModel, this.group, true);
    }

    private _updateLargeClip(seriesModel: BarSeriesModel): void {
        // Use clipPath in large mode.
        const clipPath = seriesModel.get('clip', true)
            ? createClipPath(seriesModel.coordinateSystem, false, seriesModel)
            : null;
        if (clipPath) {
            this.group.setClipPath(clipPath);
        }
        else {
            this.group.removeClipPath();
        }
    }

    _dataSort(
        data: List<BarSeriesModel, DefaultDataVisual>,
        idxMap: ((idx: number) => number)
    ): OrdinalSortInfo[] {
        type SortValueInfo = {
            mappedValue: number,
            ordinalNumber: OrdinalNumber,
            beforeSortIndex: number
        };
        const info: SortValueInfo[] = [];
        data.each(idx => {
            info.push({
                mappedValue: idxMap(idx),
                ordinalNumber: idx,
                beforeSortIndex: null
            });
        });

        info.sort((a, b) => {
            return b.mappedValue - a.mappedValue;
        });

        // Update beforeSortIndex
        for (let i = 0; i < info.length; ++i) {
            info[info[i].ordinalNumber].beforeSortIndex = i;
        }

        return map(info, item => {
            return {
                ordinalNumber: item.ordinalNumber,
                beforeSortIndex: item.beforeSortIndex
            };
        });
    }

    _isDataOrderChanged(
        data: List<BarSeriesModel, DefaultDataVisual>,
        orderMap: ((idx: number) => number),
        oldOrder: OrdinalSortInfo[]
    ): boolean {
        const oldCount = oldOrder ? oldOrder.length : 0;
        if (oldCount !== data.count()) {
            return true;
        }

        let lastValue = Number.MAX_VALUE;
        for (let i = 0; i < oldOrder.length; ++i) {
            const value = orderMap(oldOrder[i].ordinalNumber);
            if (value > lastValue) {
                return true;
            }
            lastValue = value;
        }
        return false;
    }

    _updateSort(
        data: List<BarSeriesModel, DefaultDataVisual>,
        orderMap: ((idx: number) => number),
        baseAxis: Axis2D,
        api: ExtensionAPI
    ) {
        const oldOrder = (baseAxis.scale as OrdinalScale).getCategorySortInfo();
        const isOrderChanged = this._isDataOrderChanged(data, orderMap, oldOrder);
        if (isOrderChanged) {
            // re-sort and update in axis
            const sortInfo = this._dataSort(data, orderMap);
            baseAxis.setCategorySortInfo(sortInfo);

            const action = {
                type: 'changeAxisOrder',
                componentType: baseAxis.dim + 'Axis',
                axisId: baseAxis.index
            } as Payload;
            api.dispatchAction(action);
        }
    }

    remove(ecModel?: GlobalModel) {
        this._clear(ecModel);
    }

    private _clear(ecModel?: GlobalModel): void {
        const group = this.group;
        const data = this._data;
        if (ecModel && ecModel.get('animation') && data && !this._isLargeDraw) {
            this._removeBackground();
            this._backgroundEls = [];

            data.eachItemGraphicEl(function (el: Sector | Rect) {
                if (el.type === 'sector') {
                    removeSector(getECData(el).dataIndex, ecModel, el as (Sector));
                }
                else {
                    removeRect(getECData(el).dataIndex, ecModel, el as (Rect));
                }
            });
        }
        else {
            group.removeAll();
        }
        this._data = null;
    }

    private _removeBackground(): void {
        this.group.remove(this._backgroundGroup);
        this._backgroundGroup = null;
    }
}

interface Clipper {
    (coordSysBoundingRect: RectLike, layout: RectLayout | SectorLayout): boolean
}
const clip: {
    [key in 'cartesian2d' | 'polar']: Clipper
} = {
    cartesian2d(coordSysBoundingRect: RectLike, layout: Rect['shape']) {
        const signWidth = layout.width < 0 ? -1 : 1;
        const signHeight = layout.height < 0 ? -1 : 1;
        // Needs positive width and height
        if (signWidth < 0) {
            layout.x += layout.width;
            layout.width = -layout.width;
        }
        if (signHeight < 0) {
            layout.y += layout.height;
            layout.height = -layout.height;
        }

        const x = mathMax(layout.x, coordSysBoundingRect.x);
        const x2 = mathMin(layout.x + layout.width, coordSysBoundingRect.x + coordSysBoundingRect.width);
        const y = mathMax(layout.y, coordSysBoundingRect.y);
        const y2 = mathMin(layout.y + layout.height, coordSysBoundingRect.y + coordSysBoundingRect.height);

        layout.x = x;
        layout.y = y;
        layout.width = x2 - x;
        layout.height = y2 - y;

        const clipped = layout.width < 0 || layout.height < 0;

        // Reverse back
        if (signWidth < 0) {
            layout.x += layout.width;
            layout.width = -layout.width;
        }
        if (signHeight < 0) {
            layout.y += layout.height;
            layout.height = -layout.height;
        }

        return clipped;
    },

    polar() {
        return false;
    }
};

interface ElementCreator {
    (
        seriesModel: BarSeriesModel, data: List, newIndex: number,
        layout: RectLayout | SectorLayout, isHorizontalOrRadial: boolean,
        animationModel: BarSeriesModel, isUpdate: boolean, during: () => void,
        roundCap?: boolean
    ): BarPossiblePath
}

const elementCreator: {
    [key in 'polar' | 'cartesian2d']: ElementCreator
} = {

    cartesian2d(
        seriesModel, data, newIndex, layout: RectLayout, isHorizontal,
        animationModel, isUpdate, during
    ) {
        const rect = new Rect({
            shape: extend({}, layout),
            z2: 1
        });
        // rect.autoBatch = true;

        rect.name = 'item';

        // Animation
        if (animationModel) {
            const rectShape = rect.shape;
            const animateProperty = isHorizontal ? 'height' : 'width' as 'width' | 'height';
            const animateTarget = {} as RectShape;
            rectShape[animateProperty] = 0;
            animateTarget[animateProperty] = layout[animateProperty];

            (isUpdate ? updateProps : initProps)(rect, {
                shape: animateTarget
            }, animationModel, newIndex, null, during);

            const defaultTextGetter = (values: ParsedValue | ParsedValue[]) => {
                return getDefaultLabel(seriesModel.getData(), newIndex, values);
            };

            const labelModel = seriesModel.getModel('label');
            (isUpdate ? updateLabel : initLabel)(
                rect, data, newIndex, labelModel, seriesModel, animationModel, defaultTextGetter
            );
        }

        return rect;
    },

    polar(
        seriesModel, data, newIndex, layout: SectorLayout, isRadial: boolean,
        animationModel, isUpdate, during, roundCap
    ) {
        // Keep the same logic with bar in catesion: use end value to control
        // direction. Notice that if clockwise is true (by default), the sector
        // will always draw clockwisely, no matter whether endAngle is greater
        // or less than startAngle.
        const clockwise = layout.startAngle < layout.endAngle;

        const ShapeClass = (!isRadial && roundCap) ? Sausage : Sector;

        const sector = new ShapeClass({
            shape: defaults({clockwise: clockwise}, layout),
            z2: 1
        });

        sector.name = 'item';

        // Animation
        if (animationModel) {
            const sectorShape = sector.shape;
            const animateProperty = isRadial ? 'r' : 'endAngle' as 'r' | 'endAngle';
            const animateTarget = {} as SectorShape;
            sectorShape[animateProperty] = isRadial ? 0 : layout.startAngle;
            animateTarget[animateProperty] = layout[animateProperty];
            (isUpdate ? updateProps : initProps)(sector, {
                shape: animateTarget
                // __value: typeof dataValue === 'string' ? parseInt(dataValue, 10) : dataValue
            }, animationModel);
        }

        return sector;
    }
};

function removeRect(
    dataIndex: number,
    animationModel: BarSeriesModel | GlobalModel,
    el: Rect
) {
    // Not show text when animating
    el.removeTextContent();
    removeElement(el, {
        style: {
            opacity: 0
        }
    }, animationModel, dataIndex, function () {
        el.parent && el.parent.remove(el);
    });
}

function removeSector(
    dataIndex: number,
    animationModel: BarSeriesModel | GlobalModel,
    el: Sector
) {
    // Not show text when animating
    el.removeTextContent();
    removeElement(el, {
        style: {
            opacity: 0
        }
    }, animationModel, dataIndex, function () {
        el.parent && el.parent.remove(el);
    });
}

interface GetLayout {
    (data: List, dataIndex: number, itemModel?: Model<BarDataItemOption>): RectLayout | SectorLayout
}
const getLayout: {
    [key in 'cartesian2d' | 'polar']: GetLayout
} = {
    // itemModel is only used to get borderWidth, which is not needed
    // when calculating bar background layout.
    cartesian2d(data, dataIndex, itemModel?): RectLayout {
        const layout = data.getItemLayout(dataIndex) as RectLayout;
        const fixedLineWidth = itemModel ? getLineWidth(itemModel, layout) : 0;

        // fix layout with lineWidth
        const signX = layout.width > 0 ? 1 : -1;
        const signY = layout.height > 0 ? 1 : -1;
        return {
            x: layout.x + signX * fixedLineWidth / 2,
            y: layout.y + signY * fixedLineWidth / 2,
            width: layout.width - signX * fixedLineWidth,
            height: layout.height - signY * fixedLineWidth
        };
    },

    polar(data, dataIndex, itemModel?): SectorLayout {
        const layout = data.getItemLayout(dataIndex);
        return {
            cx: layout.cx,
            cy: layout.cy,
            r0: layout.r0,
            r: layout.r,
            startAngle: layout.startAngle,
            endAngle: layout.endAngle
        } as SectorLayout;
    }
};

function isZeroOnPolar(layout: SectorLayout) {
    return layout.startAngle != null
        && layout.endAngle != null
        && layout.startAngle === layout.endAngle;
}

function updateStyle(
    el: BarPossiblePath,
    data: List, dataIndex: number,
    itemModel: Model<BarDataItemOption>,
    layout: RectLayout | SectorLayout,
    seriesModel: BarSeriesModel,
    isHorizontal: boolean,
    isPolar: boolean
) {
    const style = data.getItemVisual(dataIndex, 'style');

    if (!isPolar) {
        (el as Rect).setShape('r', itemModel.get(BAR_BORDER_RADIUS_QUERY) || 0);
    }

    el.useStyle(style);

    el.ignore = isZeroOnPolar(layout as SectorLayout);

    const cursorStyle = itemModel.getShallow('cursor');
    cursorStyle && (el as Path).attr('cursor', cursorStyle);

    if (!isPolar) {
        const labelPositionOutside = isHorizontal
            ? ((layout as RectLayout).height > 0 ? 'bottom' as const : 'top' as const)
            : ((layout as RectLayout).width > 0 ? 'left' as const : 'right' as const);

        const labelModel = itemModel.getModel('label');
        const hoverLabelModel = itemModel.getModel(['emphasis', 'label']);
        setLabelStyle(
            el, labelModel, hoverLabelModel,
            {
                labelFetcher: seriesModel,
                labelDataIndex: dataIndex,
                defaultText: getDefaultLabel(seriesModel.getData(), dataIndex),
                inheritColor: style.fill as ColorString,
                defaultOutsidePosition: labelPositionOutside
            }
        );
    }

    const emphasisModel = itemModel.getModel(['emphasis']);
    enableHoverEmphasis(el, emphasisModel.get('focus'), emphasisModel.get('blurScope'));
    setStatesStylesFromModel(el, itemModel);
    if (isZeroOnPolar(layout as SectorLayout)) {
        each(el.states, (state) => {
            if (state.style) {
                state.style.fill = state.style.stroke = 'none';
            }
        });
    }
}

// In case width or height are too small.
function getLineWidth(
    itemModel: Model<BarSeriesOption>,
    rawLayout: RectLayout
) {
    const lineWidth = itemModel.get(BAR_BORDER_WIDTH_QUERY) || 0;
    // width or height may be NaN for empty data
    const width = isNaN(rawLayout.width) ? Number.MAX_VALUE : Math.abs(rawLayout.width);
    const height = isNaN(rawLayout.height) ? Number.MAX_VALUE : Math.abs(rawLayout.height);
    return Math.min(lineWidth, width, height);
}

class LagePathShape {
    points: ArrayLike<number>;
}
interface LargePathProps extends PathProps {
    shape?: LagePathShape
}
class LargePath extends Path<LargePathProps> {
    type = 'largeBar';

    shape: LagePathShape;
;
    __startPoint: number[];
    __baseDimIdx: number;
    __largeDataIndices: ArrayLike<number>;
    __barWidth: number;

    constructor(opts?: LargePathProps) {
        super(opts);
    }

    getDefaultShape() {
        return new LagePathShape();
    }

    buildPath(ctx: CanvasRenderingContext2D, shape: LagePathShape) {
        // Drawing lines is more efficient than drawing
        // a whole line or drawing rects.
        const points = shape.points;
        const startPoint = this.__startPoint;
        const baseDimIdx = this.__baseDimIdx;

        for (let i = 0; i < points.length; i += 2) {
            startPoint[baseDimIdx] = points[i + baseDimIdx];
            ctx.moveTo(startPoint[0], startPoint[1]);
            ctx.lineTo(points[i], points[i + 1]);
        }
    }
}

function createLarge(
    seriesModel: BarSeriesModel,
    group: Group,
    incremental?: boolean
) {
    // TODO support polar
    const data = seriesModel.getData();
    const startPoint = [];
    const baseDimIdx = data.getLayout('valueAxisHorizontal') ? 1 : 0;
    startPoint[1 - baseDimIdx] = data.getLayout('valueAxisStart');

    const largeDataIndices = data.getLayout('largeDataIndices');
    const barWidth = data.getLayout('barWidth');

    const backgroundModel = seriesModel.getModel('backgroundStyle');
    const drawBackground = seriesModel.get('showBackground', true);

    if (drawBackground) {
        const points = data.getLayout('largeBackgroundPoints');
        const backgroundStartPoint: number[] = [];
        backgroundStartPoint[1 - baseDimIdx] = data.getLayout('backgroundStart');

        const bgEl = new LargePath({
            shape: {points: points},
            incremental: !!incremental,
            silent: true,
            z2: 0
        });
        bgEl.__startPoint = backgroundStartPoint;
        bgEl.__baseDimIdx = baseDimIdx;
        bgEl.__largeDataIndices = largeDataIndices;
        bgEl.__barWidth = barWidth;
        setLargeBackgroundStyle(bgEl, backgroundModel, data);
        group.add(bgEl);
    }

    const el = new LargePath({
        shape: {points: data.getLayout('largePoints')},
        incremental: !!incremental
    });
    el.__startPoint = startPoint;
    el.__baseDimIdx = baseDimIdx;
    el.__largeDataIndices = largeDataIndices;
    el.__barWidth = barWidth;
    group.add(el);
    setLargeStyle(el, seriesModel, data);

    // Enable tooltip and user mouse/touch event handlers.
    getECData(el).seriesIndex = seriesModel.seriesIndex;

    if (!seriesModel.get('silent')) {
        el.on('mousedown', largePathUpdateDataIndex);
        el.on('mousemove', largePathUpdateDataIndex);
    }
}

// Use throttle to avoid frequently traverse to find dataIndex.
const largePathUpdateDataIndex = throttle(function (this: LargePath, event: ZRElementEvent) {
    const largePath = this;
    const dataIndex = largePathFindDataIndex(largePath, event.offsetX, event.offsetY);
    getECData(largePath).dataIndex = dataIndex >= 0 ? dataIndex : null;
}, 30, false);

function largePathFindDataIndex(largePath: LargePath, x: number, y: number) {
    const baseDimIdx = largePath.__baseDimIdx;
    const valueDimIdx = 1 - baseDimIdx;
    const points = largePath.shape.points;
    const largeDataIndices = largePath.__largeDataIndices;
    const barWidthHalf = Math.abs(largePath.__barWidth / 2);
    const startValueVal = largePath.__startPoint[valueDimIdx];

    _eventPos[0] = x;
    _eventPos[1] = y;
    const pointerBaseVal = _eventPos[baseDimIdx];
    const pointerValueVal = _eventPos[1 - baseDimIdx];
    const baseLowerBound = pointerBaseVal - barWidthHalf;
    const baseUpperBound = pointerBaseVal + barWidthHalf;

    for (let i = 0, len = points.length / 2; i < len; i++) {
        const ii = i * 2;
        const barBaseVal = points[ii + baseDimIdx];
        const barValueVal = points[ii + valueDimIdx];
        if (
            barBaseVal >= baseLowerBound && barBaseVal <= baseUpperBound
            && (
                startValueVal <= barValueVal
                    ? (pointerValueVal >= startValueVal && pointerValueVal <= barValueVal)
                    : (pointerValueVal >= barValueVal && pointerValueVal <= startValueVal)
            )
        ) {
            return largeDataIndices[i];
        }
    }

    return -1;
}

function setLargeStyle(
    el: LargePath,
    seriesModel: BarSeriesModel,
    data: List
) {
    const globalStyle = data.getVisual('style');

    el.useStyle(extend({}, globalStyle));
    // Use stroke instead of fill.
    el.style.fill = null;
    el.style.stroke = globalStyle.fill;
    el.style.lineWidth = data.getLayout('barWidth');
}

function setLargeBackgroundStyle(
    el: LargePath,
    backgroundModel: Model<BarSeriesOption['backgroundStyle']>,
    data: List
) {
    const borderColor = backgroundModel.get('borderColor') || backgroundModel.get('color');
    const itemStyle = backgroundModel.getItemStyle();

    el.useStyle(itemStyle);
    el.style.fill = null;
    el.style.stroke = borderColor;
    el.style.lineWidth = data.getLayout('barWidth') as number;
}

function createBackgroundShape(
    isHorizontalOrRadial: boolean,
    layout: SectorLayout | RectLayout,
    coord: CoordSysOfBar
): SectorShape | RectShape {
    if (isCoordinateSystemType<Cartesian2D>(coord, 'cartesian2d')) {
        const rectShape = layout as RectShape;
        const coordLayout = coord.getArea();
        return {
            x: isHorizontalOrRadial ? rectShape.x : coordLayout.x,
            y: isHorizontalOrRadial ? coordLayout.y : rectShape.y,
            width: isHorizontalOrRadial ? rectShape.width : coordLayout.width,
            height: isHorizontalOrRadial ? coordLayout.height : rectShape.height
        } as RectShape;
    }
    else {
        const coordLayout = coord.getArea();
        const sectorShape = layout as SectorShape;
        return {
            cx: coordLayout.cx,
            cy: coordLayout.cy,
            r0: isHorizontalOrRadial ? coordLayout.r0 : sectorShape.r0,
            r: isHorizontalOrRadial ? coordLayout.r : sectorShape.r,
            startAngle: isHorizontalOrRadial ? sectorShape.startAngle : 0,
            endAngle: isHorizontalOrRadial ? sectorShape.endAngle : Math.PI * 2
        } as SectorShape;
    }
}

function createBackgroundEl(
    coord: CoordSysOfBar,
    isHorizontalOrRadial: boolean,
    layout: SectorLayout | RectLayout
): Rect | Sector {
    const ElementClz = coord.type === 'polar' ? Sector : Rect;
    return new ElementClz({
        shape: createBackgroundShape(isHorizontalOrRadial, layout, coord) as any,
        silent: true,
        z2: 0
    });
}

ChartView.registerClass(BarView);

export default BarView;