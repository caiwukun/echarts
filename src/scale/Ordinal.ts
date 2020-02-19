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
 * Linear continuous scale
 * http://en.wikipedia.org/wiki/Level_of_measurement
 */

// FIXME only one data

import * as zrUtil from 'zrender/src/core/util';
import Scale from './Scale';
import OrdinalMeta from '../data/OrdinalMeta';
import List from '../data/List';
import { OrdinalRawValue, OrdinalNumber, DimensionLoose } from '../util/types';


class OrdinalScale extends Scale {

    static type: 'ordinal';

    private _ordinalMeta: OrdinalMeta;


    constructor(setting?: {
        ordinalMeta?: OrdinalMeta | OrdinalRawValue[],
        extent?: [number, number]
    }) {
        super(setting);

        var ordinalMeta = this.getSetting('ordinalMeta');
        // Caution: Should not use instanceof, consider ec-extensions using
        // import approach to get OrdinalMeta class.
        if (!ordinalMeta || zrUtil.isArray(ordinalMeta)) {
            ordinalMeta = new OrdinalMeta({categories: ordinalMeta});
        }
        this._ordinalMeta = ordinalMeta;
        this._extent = this.getSetting('extent') || [0, ordinalMeta.categories.length - 1];
    }

    parse(val: OrdinalRawValue | OrdinalNumber): OrdinalNumber {
        return typeof val === 'string'
            ? this._ordinalMeta.getOrdinal(val)
            // val might be float.
            : Math.round(val);
    }

    contain(rank: OrdinalRawValue | OrdinalNumber): boolean {
        rank = this.parse(rank);
        return super.contain(rank)
            && this._ordinalMeta.categories[rank] != null;
    }

    /**
     * Normalize given rank or name to linear [0, 1]
     */
    normalize(val: OrdinalRawValue | OrdinalNumber): number {
        return super.normalize(this.parse(val));
    }

    scale(val: number): OrdinalNumber {
        return Math.round(super.scale(val));
    }

    getTicks(): OrdinalNumber[] {
        var ticks = [];
        var extent = this._extent;
        var rank = extent[0];

        while (rank <= extent[1]) {
            ticks.push(rank);
            rank++;
        }

        return ticks;
    }

    getMinorTicks(splitNumber: number): number[][] {
        // Not support.
        return;
    }

    /**
     * Get item on rank n
     */
    getLabel(n: OrdinalNumber): string {
        if (!this.isBlank()) {
            // Note that if no data, ordinalMeta.categories is an empty array.
            return this._ordinalMeta.categories[n] + '';
        }
    }

    count(): number {
        return this._extent[1] - this._extent[0] + 1;
    }

    unionExtentFromData(data: List, dim: DimensionLoose) {
        this.unionExtent(data.getApproximateExtent(dim));
    }

    getOrdinalMeta(): OrdinalMeta {
        return this._ordinalMeta;
    }

    niceTicks() {}

    niceExtent() {}

}

Scale.registerClass(OrdinalScale);

export default OrdinalScale;
