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

// @ts-nocheck

import * as echarts from '../echarts';
// import * as zrUtil from 'zrender/src/core/util';

import './scatter/ScatterSeries';
import './scatter/ScatterView';

import visualSymbol from '../visual/symbol';
import layoutPoints from '../layout/points';

// In case developer forget to include grid component
import '../component/gridSimple';

echarts.registerVisual(visualSymbol('scatter', 'circle'));
echarts.registerLayout(layoutPoints('scatter'));

// echarts.registerProcessor(function (ecModel, api) {
//     ecModel.eachSeriesByType('scatter', function (seriesModel) {
//         var data = seriesModel.getData();
//         var coordSys = seriesModel.coordinateSystem;
//         if (coordSys.type !== 'geo') {
//             return;
//         }
//         var startPt = coordSys.pointToData([0, 0]);
//         var endPt = coordSys.pointToData([api.getWidth(), api.getHeight()]);

//         var dims = zrUtil.map(coordSys.dimensions, function (dim) {
//             return data.mapDimension(dim);
//         });
//         var range = {};
//         range[dims[0]] = [Math.min(startPt[0], endPt[0]), Math.max(startPt[0], endPt[0])];
//         range[dims[1]] = [Math.min(startPt[1], endPt[1]), Math.max(startPt[1], endPt[1])];

//         data.selectRange(range);
//     });
// });