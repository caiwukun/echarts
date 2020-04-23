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

import Scale from './Scale';
import OrdinalMeta from '../data/OrdinalMeta';
import List from '../data/List';
import * as scaleHelper from './helper';
import { OrdinalRawValue, OrdinalNumber, DimensionLoose } from '../util/types';
import { AxisBaseOption } from '../coord/axisCommonTypes';
import { isArray } from 'zrender/src/core/util';


class OrdinalScale extends Scale {

    static type = 'ordinal';
    readonly type = 'ordinal';

    private _ordinalMeta: OrdinalMeta;
    private _sortedDataIndices: number[];


    constructor(setting?: {
        ordinalMeta?: OrdinalMeta | AxisBaseOption['data'],
        extent?: [number, number]
    }) {
        super(setting);

        let ordinalMeta = this.getSetting('ordinalMeta');
        // Caution: Should not use instanceof, consider ec-extensions using
        // import approach to get OrdinalMeta class.
        if (!ordinalMeta || isArray(ordinalMeta)) {
            ordinalMeta = new OrdinalMeta({categories: ordinalMeta});
        }
        this._ordinalMeta = ordinalMeta;
        this._sortedDataIndices = [];
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
        return scaleHelper.contain(rank, this._extent)
            && this._ordinalMeta.categories[rank] != null;
    }

    /**
     * Normalize given rank or name to linear [0, 1]
     */
    normalize(val: OrdinalRawValue | OrdinalNumber): number {
        val = this.getSortedDataIndex(this.parse(val));
        return scaleHelper.normalize(val, this._extent);
    }

    scale(val: number): OrdinalNumber {
        val = this.getSortedDataIndex(val);
        return Math.round(scaleHelper.scale(val, this._extent));
    }

    getTicks(): OrdinalNumber[] {
        const ticks = [];
        const extent = this._extent;
        let rank = extent[0];

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

    getSortedDataIndex(n: OrdinalNumber): OrdinalNumber {
        if (this._sortedDataIndices.length) {
            return this._sortedDataIndices[n];
        }
        else {
            return n;
        }
    }

    /**
     * Get item on rank n
     */
    getLabel(n: OrdinalNumber): string {
        if (!this.isBlank()) {
            const cateogry = this._ordinalMeta.categories[n];
            // Note that if no data, ordinalMeta.categories is an empty array.
            // Return empty if it's not exist.
            return cateogry == null ? '' : cateogry + '';
        }
    }

    setSortedDataIndices(index: number[]): void {
        this._sortedDataIndices = index;
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
