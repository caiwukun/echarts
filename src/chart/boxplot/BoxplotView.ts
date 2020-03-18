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

import * as zrUtil from 'zrender/src/core/util';
import ChartView from '../../view/Chart';
import * as graphic from '../../util/graphic';
import Path, { PathProps } from 'zrender/src/graphic/Path';
import BoxplotSeriesModel, { BoxplotDataItemOption } from './BoxplotSeries';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../ExtensionAPI';
import List from '../../data/List';
import { BoxplotItemLayout } from './boxplotLayout';
import { StyleProps } from 'zrender/src/graphic/Style';

// Update common properties
var EMPHASIS_ITEM_STYLE_PATH = ['emphasis', 'itemStyle'] as const;

class BoxplotView extends ChartView {
    static type = 'boxplot'
    type = BoxplotView.type

    private _data: List

    render(seriesModel: BoxplotSeriesModel, ecModel: GlobalModel, api: ExtensionAPI) {
        var data = seriesModel.getData();
        var group = this.group;
        var oldData = this._data;

        // There is no old data only when first rendering or switching from
        // stream mode to normal mode, where previous elements should be removed.
        if (!this._data) {
            group.removeAll();
        }

        var constDim = seriesModel.get('layout') === 'horizontal' ? 1 : 0;

        data.diff(oldData)
            .add(function (newIdx) {
                if (data.hasValue(newIdx)) {
                    var itemLayout = data.getItemLayout(newIdx) as BoxplotItemLayout;
                    var symbolEl = createNormalBox(itemLayout, data, newIdx, constDim, true);
                    data.setItemGraphicEl(newIdx, symbolEl);
                    group.add(symbolEl);
                }
            })
            .update(function (newIdx, oldIdx) {
                var symbolEl = oldData.getItemGraphicEl(oldIdx) as BoxPath;

                // Empty data
                if (!data.hasValue(newIdx)) {
                    group.remove(symbolEl);
                    return;
                }

                var itemLayout = data.getItemLayout(newIdx) as BoxplotItemLayout;
                if (!symbolEl) {
                    symbolEl = createNormalBox(itemLayout, data, newIdx, constDim);
                }
                else {
                    updateNormalBoxData(itemLayout, symbolEl, data, newIdx);
                }

                group.add(symbolEl);

                data.setItemGraphicEl(newIdx, symbolEl);
            })
            .remove(function (oldIdx) {
                var el = oldData.getItemGraphicEl(oldIdx);
                el && group.remove(el);
            })
            .execute();

        this._data = data;
    }

    remove(ecModel: GlobalModel) {
        var group = this.group;
        var data = this._data;
        this._data = null;
        data && data.eachItemGraphicEl(function (el) {
            el && group.remove(el);
        });
    }
}

class BoxPathShape {
    points: number[][]
}

interface BoxPathProps extends PathProps {
    shape?: Partial<BoxPathShape>
}

class BoxPath extends Path<BoxPathProps> {

    readonly type = 'boxplotBoxPath'
    shape: BoxPathShape

    constructor(opts?: BoxPathProps) {
        super(opts, null, new BoxPathShape());
    }

    buildPath(ctx: CanvasRenderingContext2D, shape: BoxPathShape) {
        var ends = shape.points;

        var i = 0;
        ctx.moveTo(ends[i][0], ends[i][1]);
        i++;
        for (; i < 4; i++) {
            ctx.lineTo(ends[i][0], ends[i][1]);
        }
        ctx.closePath();

        for (; i < ends.length; i++) {
            ctx.moveTo(ends[i][0], ends[i][1]);
            i++;
            ctx.lineTo(ends[i][0], ends[i][1]);
        }
    }

}

function createNormalBox(
    itemLayout: BoxplotItemLayout,
    data: List,
    dataIndex: number,
    constDim: number,
    isInit?: boolean
) {
    var ends = itemLayout.ends;

    var el = new BoxPath({
        shape: {
            points: isInit
                ? transInit(ends, constDim, itemLayout)
                : ends
        }
    });

    updateNormalBoxData(itemLayout, el, data, dataIndex, isInit);

    return el;
}

function updateNormalBoxData(
    itemLayout: BoxplotItemLayout,
    el: BoxPath,
    data: List,
    dataIndex: number,
    isInit?: boolean
) {
    var seriesModel = data.hostModel;
    var updateMethod = graphic[isInit ? 'initProps' : 'updateProps'];

    updateMethod(
        el,
        {shape: {points: itemLayout.ends}},
        seriesModel,
        dataIndex
    );

    var itemModel = data.getItemModel<BoxplotDataItemOption>(dataIndex);
    var normalItemStyleModel = itemModel.getModel('itemStyle');
    var borderColor = data.getItemVisual(dataIndex, 'color');

    // Exclude borderColor.
    var itemStyle = normalItemStyleModel.getItemStyle(['borderColor']) as StyleProps;
    itemStyle.stroke = borderColor;
    itemStyle.strokeNoScale = true;
    el.useStyle(itemStyle);

    el.z2 = 100;

    var hoverStyle = itemModel.getModel(EMPHASIS_ITEM_STYLE_PATH).getItemStyle();
    graphic.setHoverStyle(el, hoverStyle);
}

function transInit(points: number[][], dim: number, itemLayout: BoxplotItemLayout) {
    return zrUtil.map(points, function (point) {
        point = point.slice();
        point[dim] = itemLayout.initBaseline;
        return point;
    });
}

ChartView.registerClass(BoxplotView);

export default BoxplotView;
