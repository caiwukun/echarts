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

/**
 * Substitute `completeDimensions`.
 * `completeDimensions` is to be deprecated.
 */
import completeDimensions from './completeDimensions';
import { DimensionDefinitionLoose, OptionEncode, OptionEncodeValue, EncodeDefaulter } from '../../util/types';
import Source from '../Source';
import List from '../List';
import DataDimensionInfo from '../DataDimensionInfo';
import { HashMap } from 'zrender/src/core/util';

export type CreateDimensionsParams = {
    coordDimensions?: DimensionDefinitionLoose[],
    dimensionsDefine?: DimensionDefinitionLoose[],
    encodeDefine?: HashMap<OptionEncodeValue> | OptionEncode,
    dimensionsCount?: number,
    encodeDefaulter?: EncodeDefaulter,
    generateCoord?: string,
    generateCoordCount?: number
};

/**
 * @param opt.coordDimensions
 * @param opt.dimensionsDefine By default `source.dimensionsDefine` Overwrite source define.
 * @param opt.encodeDefine By default `source.encodeDefine` Overwrite source define.
 * @param opt.encodeDefaulter Make default encode if user not specified.
 */
export default function (
    // TODO: TYPE completeDimensions type
    source: Source | List | any[],
    opt?: CreateDimensionsParams
): DataDimensionInfo[] {
    opt = opt || {};
    return completeDimensions(opt.coordDimensions || [], source, {
        // FIXME:TS detect whether source then call `.dimensionsDefine` and `.encodeDefine`?
        dimsDef: opt.dimensionsDefine || (source as Source).dimensionsDefine,
        encodeDef: opt.encodeDefine || (source as Source).encodeDefine,
        dimCount: opt.dimensionsCount,
        encodeDefaulter: opt.encodeDefaulter,
        generateCoord: opt.generateCoord,
        generateCoordCount: opt.generateCoordCount
    });
}
