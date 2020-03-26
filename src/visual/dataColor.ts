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

// Pick color from palette for each data item.
// Applicable for charts that require applying color palette
// in data level (like pie, funnel, chord).
import {createHashMap} from 'zrender/src/core/util';
import { StageHandler, ItemStyleOption } from '../util/types';
import SeriesModel from '../model/Series';

interface SeriesModelWithPaletteScope extends SeriesModel {
    __paletteScope: any
}

export default function (seriesType: string): StageHandler {
    return {
        getTargetSeries: function (ecModel) {
            // Pie and funnel may use diferrent scope
            const paletteScope = {};
            const seiresModelMap = createHashMap<SeriesModel>();

            ecModel.eachSeriesByType(seriesType, function (seriesModel) {
                (seriesModel as SeriesModelWithPaletteScope).__paletteScope = paletteScope;
                seiresModelMap.set(seriesModel.uid, seriesModel);
            });

            return seiresModelMap;
        },
        reset: function (seriesModel) {
            const dataAll = seriesModel.getRawData();
            const idxMap: {[key: number]: number} = {};
            const data = seriesModel.getData();

            data.each(function (idx) {
                const rawIdx = data.getRawIndex(idx);
                idxMap[rawIdx] = idx;
            });

            dataAll.each(function (rawIdx) {
                const filteredIdx = idxMap[rawIdx];

                // If series.itemStyle.normal.color is a function. itemVisual may be encoded
                const singleDataColor = filteredIdx != null
                    && data.getItemVisual(filteredIdx, 'color', true);

                const singleDataBorderColor = filteredIdx != null
                    && data.getItemVisual(filteredIdx, 'borderColor', true);

                let itemModel;
                if (!singleDataColor || !singleDataBorderColor) {
                    // FIXME Performance
                    itemModel = dataAll.getItemModel<{itemStyle: ItemStyleOption}>(rawIdx);
                }

                if (!singleDataColor) {
                    const color = itemModel.get(['itemStyle', 'color'])
                        || seriesModel.getColorFromPalette(
                            dataAll.getName(rawIdx) || (rawIdx + ''),
                            (seriesModel as SeriesModelWithPaletteScope).__paletteScope,
                            dataAll.count()
                        );
                    // Data is not filtered
                    if (filteredIdx != null) {
                        data.setItemVisual(filteredIdx, 'color', color);
                    }
                }

                if (!singleDataBorderColor) {
                    const borderColor = itemModel.get(['itemStyle', 'borderColor']);

                    // Data is not filtered
                    if (filteredIdx != null) {
                        data.setItemVisual(filteredIdx, 'borderColor', borderColor);
                    }
                }
            });
        }
    };
}