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

import PointerPath from './PointerPath';
import * as graphic from '../../util/graphic';
import { setStatesStylesFromModel, enableHoverEmphasis } from '../../util/states';
import {createTextStyle} from '../../label/labelStyle';
import ChartView from '../../view/Chart';
import {parsePercent, round, linearMap} from '../../util/number';
import GaugeSeriesModel, { GaugeDataItemOption } from './GaugeSeries';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../ExtensionAPI';
import { ColorString, ECElement } from '../../util/types';
import List from '../../data/List';
import Sausage from '../../util/shape/sausage';
import {createSymbol} from '../../util/symbol';

interface PosInfo {
    cx: number
    cy: number
    r: number
}

function parsePosition(seriesModel: GaugeSeriesModel, api: ExtensionAPI): PosInfo {
    const center = seriesModel.get('center');
    const width = api.getWidth();
    const height = api.getHeight();
    const size = Math.min(width, height);
    const cx = parsePercent(center[0], api.getWidth());
    const cy = parsePercent(center[1], api.getHeight());
    const r = parsePercent(seriesModel.get('radius'), size / 2);

    return {
        cx: cx,
        cy: cy,
        r: r
    };
}

function formatLabel(value: number, labelFormatter: string | ((value: number) => string)): string {
    let label = value == null ? '' : (value + '');
    if (labelFormatter) {
        if (typeof labelFormatter === 'string') {
            label = labelFormatter.replace('{value}', label);
        }
        else if (typeof labelFormatter === 'function') {
            label = labelFormatter(value);
        }
    }

    return label;
}

const PI2 = Math.PI * 2;

class GaugeView extends ChartView {
    static type = 'gauge' as const;
    type = GaugeView.type;

    private _data: List;
    private _progressData: graphic.Path[];

    render(seriesModel: GaugeSeriesModel, ecModel: GlobalModel, api: ExtensionAPI) {

        this.group.removeAll();

        const colorList = seriesModel.get(['axisLine', 'lineStyle', 'color']);
        const posInfo = parsePosition(seriesModel, api);

        this._renderMain(
            seriesModel, ecModel, api, colorList, posInfo
        );
    }

    dispose() {}

    _renderMain(
        seriesModel: GaugeSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        colorList: [number, ColorString][],
        posInfo: PosInfo
    ) {
        const group = this.group;
        const clockwise = seriesModel.get('clockwise');
        let startAngle = -seriesModel.get('startAngle') / 180 * Math.PI;
        let endAngle = -seriesModel.get('endAngle') / 180 * Math.PI;
        const axisLineModel = seriesModel.getModel('axisLine');

        const roundCap = axisLineModel.get('roundCap');
        const MainPath = roundCap ? Sausage : graphic.Sector;

        const showAxis = axisLineModel.get('show');
        const lineStyleModel = axisLineModel.getModel('lineStyle');
        const axisLineWidth = lineStyleModel.get('width');
        const angleRangeSpan = !((endAngle - startAngle) % PI2) && endAngle !== startAngle
            ? PI2 : (endAngle - startAngle) % PI2;

        let prevEndAngle = startAngle;

        for (let i = 0; showAxis && i < colorList.length; i++) {
            // Clamp
            const percent = Math.min(Math.max(colorList[i][0], 0), 1);
            endAngle = startAngle + angleRangeSpan * percent;
            const sector = new MainPath({
                shape: {
                    startAngle: prevEndAngle,
                    endAngle: endAngle,
                    cx: posInfo.cx,
                    cy: posInfo.cy,
                    clockwise: clockwise,
                    r0: posInfo.r - axisLineWidth,
                    r: posInfo.r
                },
                silent: true
            });

            sector.setStyle({
                fill: colorList[i][1]
            });

            sector.setStyle(lineStyleModel.getLineStyle(
                // Because we use sector to simulate arc
                // so the properties for stroking are useless
                ['color', 'width']
            ));

            group.add(sector);

            prevEndAngle = endAngle;
        }

        const getColor = function (percent: number) {
            // Less than 0
            if (percent <= 0) {
                return colorList[0][1];
            }
            let i;
            for (i = 0; i < colorList.length; i++) {
                if (colorList[i][0] >= percent
                    && (i === 0 ? 0 : colorList[i - 1][0]) < percent
                ) {
                    return colorList[i][1];
                }
            }
            // More than 1
            return colorList[i - 1][1];
        };

        if (!clockwise) {
            const tmp = startAngle;
            startAngle = endAngle;
            endAngle = tmp;
        }

        this._renderTicks(
            seriesModel, ecModel, api, getColor, posInfo,
            startAngle, endAngle, clockwise, axisLineWidth
        );

        this._renderTitleAndDetail(
            seriesModel, ecModel, api, getColor, posInfo
        )

        this._renderAnchor(seriesModel, posInfo);

        this._renderPointer(
            seriesModel, ecModel, api, getColor, posInfo,
            startAngle, endAngle, clockwise, axisLineWidth
        );
    }

    _renderTicks(
        seriesModel: GaugeSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        getColor: (percent: number) => ColorString,
        posInfo: PosInfo,
        startAngle: number,
        endAngle: number,
        clockwise: boolean,
        axisLineWidth: number
    ) {
        const group = this.group;
        const cx = posInfo.cx;
        const cy = posInfo.cy;
        const r = posInfo.r;

        const minVal = +seriesModel.get('min');
        const maxVal = +seriesModel.get('max');

        const splitLineModel = seriesModel.getModel('splitLine');
        const tickModel = seriesModel.getModel('axisTick');
        const labelModel = seriesModel.getModel('axisLabel');

        const splitNumber = seriesModel.get('splitNumber');
        const subSplitNumber = tickModel.get('splitNumber');

        const splitLineLen = parsePercent(
            splitLineModel.get('length'), r
        );
        const tickLen = parsePercent(
            tickModel.get('length'), r
        );

        let angle = startAngle;
        const step = (endAngle - startAngle) / splitNumber;
        const subStep = step / subSplitNumber;

        const splitLineStyle = splitLineModel.getModel('lineStyle').getLineStyle();
        const tickLineStyle = tickModel.getModel('lineStyle').getLineStyle();

        const splitLineDistance = splitLineModel.get('distance');

        let unitX;
        let unitY;

        for (let i = 0; i <= splitNumber; i++) {
            unitX = Math.cos(angle);
            unitY = Math.sin(angle);
            // Split line
            if (splitLineModel.get('show')) {
                const distance = splitLineDistance ? splitLineDistance + axisLineWidth : axisLineWidth;
                const splitLine = new graphic.Line({
                    shape: {
                        x1: unitX * (r - distance) + cx,
                        y1: unitY * (r - distance) + cy,
                        x2: unitX * (r - splitLineLen - distance) + cx,
                        y2: unitY * (r - splitLineLen - distance) + cy
                    },
                    style: splitLineStyle,
                    silent: true
                });
                if (splitLineStyle.stroke === 'auto') {
                    splitLine.setStyle({
                        stroke: getColor(i / splitNumber)
                    });
                }

                group.add(splitLine);
            }

            // Label
            if (labelModel.get('show')) {
                const distance = labelModel.get('distance') + splitLineDistance;

                const label = formatLabel(
                    round(i / splitNumber * (maxVal - minVal) + minVal),
                    labelModel.get('formatter')
                );
                const autoColor = getColor(i / splitNumber);

                group.add(new graphic.Text({
                    style: createTextStyle(labelModel, {
                        text: label,
                        x: unitX * (r - splitLineLen - distance) + cx,
                        y: unitY * (r - splitLineLen - distance) + cy,
                        verticalAlign: unitY < -0.8 ? 'top' : (unitY > 0.8 ? 'bottom' : 'middle'),
                        align: unitX < -0.4 ? 'left' : (unitX > 0.4 ? 'right' : 'center')
                    }, {
                        inheritColor: autoColor
                    }),
                    silent: true
                }));
            }

            // Axis tick
            if (tickModel.get('show') && i !== splitNumber) {
                let distance = tickModel.get('distance');
                distance = distance ? distance + axisLineWidth : axisLineWidth;

                for (let j = 0; j <= subSplitNumber; j++) {
                    unitX = Math.cos(angle);
                    unitY = Math.sin(angle);
                    const tickLine = new graphic.Line({
                        shape: {
                            x1: unitX * (r - distance) + cx,
                            y1: unitY * (r - distance) + cy,
                            x2: unitX * (r - tickLen - distance) + cx,
                            y2: unitY * (r - tickLen - distance) + cy
                        },
                        silent: true,
                        style: tickLineStyle
                    });

                    if (tickLineStyle.stroke === 'auto') {
                        tickLine.setStyle({
                            stroke: getColor((i + j / subSplitNumber) / splitNumber)
                        });
                    }

                    group.add(tickLine);
                    angle += subStep;
                }
                angle -= subStep;
            }
            else {
                angle += step;
            }
        }
    }

    _renderPointer(
        seriesModel: GaugeSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        getColor: (percent: number) => ColorString,
        posInfo: PosInfo,
        startAngle: number,
        endAngle: number,
        clockwise: boolean,
        axisLineWidth: number
    ) {

        const group = this.group;
        const oldData = this._data;
        const oldProgressData = this._progressData;
        const progressList = [] as graphic.Path[];

        const showPointer = seriesModel.get(['pointer', 'show']);
        const progressModel = seriesModel.getModel('progress');
        const showProgress = progressModel.get('show');

        const data = seriesModel.getData();
        const valueDim = data.mapDimension('value');
        const minVal = +seriesModel.get('min');
        const maxVal = +seriesModel.get('max');
        const valueExtent = [minVal, maxVal];
        const angleExtent = [startAngle, endAngle];

        function createPointer(idx: number, angle: number) {
            const itemModel = data.getItemModel<GaugeDataItemOption>(idx);
            const pointerModel = itemModel.getModel('pointer');
            const pointerWidth = parsePercent(pointerModel.get('width'), posInfo.r);
            const pointerLength = parsePercent(pointerModel.get('length'), posInfo.r);
            
            const pointerStr = seriesModel.get(['pointer', 'icon']);
            const pointerOffset = pointerModel.get('offsetCenter');
            const pointerKeepAspect = pointerModel.get('keepAspect');
            let pointer;
            if (pointerStr.indexOf('path://') === 0) {
                pointer = createSymbol(
                    pointerStr,
                    parsePercent(pointerOffset[0], posInfo.r) - pointerWidth / 2,
                    parsePercent(pointerOffset[1], posInfo.r) - pointerLength,
                    pointerWidth,
                    pointerLength,
                    null,
                    pointerKeepAspect
                ) as graphic.Path;
            }
            else {
                pointer = new PointerPath({
                    shape: {
                        angle: -Math.PI / 2,
                        width: parsePercent(pointerModel.get('width'), posInfo.r),
                        r: parsePercent(pointerModel.get('length'), posInfo.r)
                    }
                })
            }
            pointer.rotation = -(angle + Math.PI / 2);
            pointer.x = posInfo.cx;
            pointer.y = posInfo.cy;
            return pointer;
        }

        function createProgress(idx: number, endAngle: number) {
            const roundCap = progressModel.get('roundCap');
            const ProgressPath = roundCap ? Sausage : graphic.Sector;

            const isOverlap = progressModel.get('overlap');
            const progressWidth = isOverlap ? progressModel.get('width') : axisLineWidth / data.count();
            const r0 = isOverlap ? posInfo.r - progressWidth : posInfo.r - (idx + 1) * progressWidth;
            const r = isOverlap ? posInfo.r : posInfo.r - idx * progressWidth;
            const progressSilent = progressModel.get('silent');
            const progress = new ProgressPath({
                shape: {
                    startAngle: startAngle,
                    endAngle: endAngle,
                    cx: posInfo.cx,
                    cy: posInfo.cy,
                    clockwise: clockwise,
                    r0: r0,
                    r: r
                },
                // 是否相应鼠标事件
                silent: progressSilent
            });
            isOverlap && (progress.z2 = maxVal - (data.get(valueDim, idx) as number) % maxVal);
            return progress;
        }

        if (showProgress || showPointer) {
            data.diff(oldData)
                .add(function (idx) {
                    if (showPointer) {
                        const pointer = createPointer(idx, startAngle);
                        graphic.initProps(pointer, {
                            rotation: -(linearMap(data.get(valueDim, idx) as number, valueExtent, angleExtent, true) + Math.PI / 2)
                        }, seriesModel);
                        group.add(pointer);
                        data.setItemGraphicEl(idx, pointer);
                    }

                    if (showProgress) {
                        const progress = createProgress(idx, startAngle) as graphic.Sector;
                        const isClip = progressModel.get('clip');
                        graphic.initProps(progress, {
                            shape: {
                                endAngle: linearMap(data.get(valueDim, idx) as number, valueExtent, angleExtent, isClip)
                            }
                        }, seriesModel);
                        group.add(progress);
                        progressList[idx] = progress;
                    }
                })
                .update(function (newIdx, oldIdx) {
                    if (showPointer) {
                        const previousPointer = oldData.getItemGraphicEl(oldIdx) as PointerPath;
                        const previousRotate = previousPointer.rotation;
                        group.remove(previousPointer);
                        const pointer = createPointer(newIdx, previousRotate);
                        pointer.rotation = previousRotate;
                        graphic.updateProps(pointer, {
                            rotation: -(linearMap(data.get(valueDim, newIdx) as number, valueExtent, angleExtent, true) + Math.PI / 2)
                        }, seriesModel);
                        group.add(pointer);
                        data.setItemGraphicEl(newIdx, pointer);
                    }

                    if (showProgress) {
                        const previousProgress = oldProgressData[oldIdx];
                        const previousEndAngle = previousProgress.shape.endAngle;
                        group.remove(previousProgress);
                        const progress = createProgress(newIdx, previousEndAngle) as graphic.Sector;
                        const isClip = progressModel.get('clip');
                        graphic.updateProps(progress, {
                            shape: {
                                endAngle: linearMap(data.get(valueDim, newIdx) as number, valueExtent, angleExtent, isClip)
                            }
                        }, seriesModel);
                        group.add(progress);
                        progressList[newIdx] = progress;
                    }
                })
                .remove(function (idx) {
                    if (showPointer) {
                        const pointer = oldData.getItemGraphicEl(idx);
                        group.remove(pointer);
                    }

                    if (showProgress) {
                        const progress = oldProgressData[idx];
                        group.remove(progress);
                    }
                })
                .execute();

            data.each(function (idx) {
                const itemModel = data.getItemModel<GaugeDataItemOption>(idx);
                const emphasisModel = itemModel.getModel('emphasis');
                if (showPointer) {
                    const pointer = data.getItemGraphicEl(idx) as PointerPath;
                    pointer.useStyle(data.getItemVisual(idx, 'style'));
                    pointer.setStyle(itemModel.getModel(['pointer', 'itemStyle']).getItemStyle());
                    if (pointer.style.fill === 'auto') {
                        pointer.setStyle('fill', getColor(
                            linearMap(data.get(valueDim, idx) as number, valueExtent, [0, 1], true)
                        ));
                    }
    
                    (pointer as ECElement).z2EmphasisLift = 0
                    setStatesStylesFromModel(pointer, itemModel);
                    enableHoverEmphasis(pointer, emphasisModel.get('focus'), emphasisModel.get('blurScope'));
                }

                if (showProgress) {
                    const progress = progressList[idx];
                    progress.useStyle(data.getItemVisual(idx, 'style'));
                    progress.setStyle(itemModel.getModel(['progress', 'itemStyle']).getItemStyle());
                    setStatesStylesFromModel(progress, itemModel);
                    enableHoverEmphasis(progress, emphasisModel.get('focus'), emphasisModel.get('blurScope'));
                }
            });

            this._data = data;
            this._progressData = progressList;
        }
        else {
            if (!showPointer) {
                // Remove old element
                oldData && oldData.eachItemGraphicEl(function (el) {
                    group.remove(el);
                });
            }

            if (!showProgress) {
                // Remove old element
                oldProgressData && oldProgressData.forEach(function (el) {
                    group.remove(el);
                });
            }
        }
    }

    _renderAnchor(
        seriesModel: GaugeSeriesModel,
        posInfo: PosInfo
    ) {
        const anchorModel = seriesModel.getModel('anchor');
        const showAnchor = anchorModel.get('show');
        if (showAnchor) {
            const anchorSize = anchorModel.get('anchorSize');
            const anchorType = anchorModel.get('icon');
            const offsetCenter = anchorModel.get('offsetCenter');
            const anchorKeepAspect = anchorModel.get('keepAspect');
            const anchor = createSymbol(
                anchorType,
                posInfo.cx - anchorSize / 2 + parsePercent(offsetCenter[0], posInfo.r),
                posInfo.cy - anchorSize / 2 + parsePercent(offsetCenter[1], posInfo.r),
                anchorSize,
                anchorSize,
                null,
                anchorKeepAspect
            ) as graphic.Path;
            anchor.z2 = anchorModel.get('showAbove') ? 1 : 0;
            anchor.setStyle(anchorModel.getModel('itemStyle').getItemStyle());
            this.group.add(anchor);
        }
    }

    _renderTitleAndDetail(
        seriesModel: GaugeSeriesModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        getColor: (percent: number) => ColorString,
        posInfo: PosInfo
    ) {
        const data = seriesModel.getData();
        const valueDim = data.mapDimension('value');
        const minVal = +seriesModel.get('min');
        const maxVal = +seriesModel.get('max');

        const contentGroup = new graphic.Group;

        data.each(function(idx) {
            const itemModel = data.getItemModel<GaugeDataItemOption>(idx);
            const value = data.get(valueDim, idx) as number;
            const itemGroup = new graphic.Group;
            const autoColor = getColor(
                linearMap(value, [minVal, maxVal], [0, 1], true)
            );

            const itemTitleModel = itemModel.getModel('title');
            if (itemTitleModel.get('show')) {
                const titleOffsetCenter = itemTitleModel.get('offsetCenter');
                const titleX = posInfo.cx + parsePercent(titleOffsetCenter[0], posInfo.r);
                const titleY = posInfo.cy + parsePercent(titleOffsetCenter[1], posInfo.r);
                itemGroup.add(new graphic.Text({
                    silent: true,
                    style: createTextStyle(itemTitleModel, {
                        x: titleX,
                        y: titleY,
                        text: data.getName(idx),
                        align: 'center',
                        verticalAlign: 'middle'
                    }, {inheritColor: autoColor})
                }));
            }

            const itemDetailModel = itemModel.getModel('detail');
            if (itemDetailModel.get('show')) {
                const detailOffsetCenter = itemDetailModel.get('offsetCenter');
                const detailX = posInfo.cx + parsePercent(detailOffsetCenter[0], posInfo.r);
                const detailY = posInfo.cy + parsePercent(detailOffsetCenter[1], posInfo.r);
                const width = parsePercent(itemDetailModel.get('width'), posInfo.r);
                const height = parsePercent(itemDetailModel.get('height'), posInfo.r);
                const detailColor = (
                    seriesModel.get(['progress', 'show']) ? data.getItemVisual(idx, 'style').fill : autoColor
                ) as string;
                itemGroup.add(new graphic.Text({
                    silent: true,
                    style: createTextStyle(itemDetailModel, {
                        x: detailX,
                        y: detailY,
                        text: formatLabel(
                            value, itemDetailModel.get('formatter')
                        ),
                        width: isNaN(width) ? null : width,
                        height: isNaN(height) ? null : height,
                        align: 'center',
                        verticalAlign: 'middle'
                    }, {inheritColor: detailColor})
                }));
            }

            contentGroup.add(itemGroup);
        });
        this.group.add(contentGroup);

    }
}

ChartView.registerClass(GaugeView);

export default GaugeView;
