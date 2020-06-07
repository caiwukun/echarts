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

import ZRText from 'zrender/src/graphic/Text';
import { LabelLayoutOption } from '../util/types';
import { BoundingRect, OrientedBoundingRect, Polyline } from '../util/graphic';

interface LabelLayoutListPrepareInput {
    label: ZRText
    labelLine: Polyline
    computedLayoutOption: LabelLayoutOption
    priority: number
    defaultAttr: {
        ignore: boolean
        labelGuideIgnore: boolean
    }
}

export interface LabelLayoutInfo {
    label: ZRText
    labelLine: Polyline
    priority: number
    rect: BoundingRect // Global rect
    localRect: BoundingRect
    obb?: OrientedBoundingRect  // Only available when axisAligned is true
    axisAligned: boolean
    layoutOption: LabelLayoutOption
    defaultAttr: {
        ignore: boolean
        labelGuideIgnore: boolean
    }
    transform: number[]
}

export function prepareLayoutList(input: LabelLayoutListPrepareInput[]): LabelLayoutInfo[] {
    const list: LabelLayoutInfo[] = [];

    for (let i = 0; i < input.length; i++) {
        const rawItem = input[i];
        if (rawItem.defaultAttr.ignore) {
            continue;
        }

        const layoutOption = rawItem.computedLayoutOption;
        const label = rawItem.label;
        const transform = label.getComputedTransform();
        // NOTE: Get bounding rect after getComputedTransform, or label may not been updated by the host el.
        const localRect = label.getBoundingRect();
        const isAxisAligned = !transform || (transform[1] < 1e-5 && transform[2] < 1e-5);

        const minMargin = layoutOption.minMargin || 0;
        const globalRect = localRect.clone();
        globalRect.applyTransform(transform);
        globalRect.x -= minMargin / 2;
        globalRect.y -= minMargin / 2;
        globalRect.width += minMargin;
        globalRect.height += minMargin;

        const obb = isAxisAligned ? new OrientedBoundingRect(localRect, transform) : null;

        list.push({
            label,
            labelLine: rawItem.labelLine,
            rect: globalRect,
            localRect,
            obb,
            priority: rawItem.priority,
            defaultAttr: rawItem.defaultAttr,
            layoutOption: rawItem.computedLayoutOption,
            axisAligned: isAxisAligned,
            transform
        });
    }
    return list;
}

function shiftLayout(
    list: LabelLayoutInfo[],
    xyDim: 'x' | 'y',
    sizeDim: 'width' | 'height',
    minBound: number,
    maxBound: number
) {
    const len = list.length;

    if (len < 2) {
        return;
    }

    list.sort(function (a, b) {
        return a.rect[xyDim] - b.rect[xyDim];
    });

    let lastPos = 0;
    let delta;
    const shifts = [];
    let totalShifts = 0;
    for (let i = 0; i < len; i++) {
        const item = list[i];
        const rect = item.rect;
        delta = rect[xyDim] - lastPos;
        if (delta < 0) {
            // shiftForward(i, len, -delta);
            rect[xyDim] -= delta;
            item.label[xyDim] -= delta;
        }
        const shift = Math.max(-delta, 0);
        shifts.push(shift);
        totalShifts += shift;

        lastPos = rect[xyDim] + rect[sizeDim];
    }
    if (totalShifts > 0) {
        // Shift back to make the distribution more equally.
        shiftList(-totalShifts / len, 0, len);
    }

    // TODO bleedMargin?
    const minGap = list[0].rect[xyDim] - minBound;
    const last = list[len - 1];
    const maxGap = maxBound - last.rect[xyDim] - last.rect[sizeDim];

    // If ends exceed two bounds
    handleBoundsGap(minGap, maxGap, 1);
    handleBoundsGap(maxGap, minGap, -1);

    function handleBoundsGap(gapThisBound: number, gapOtherBound: number, moveDir: 1 | -1) {
        if (gapThisBound < 0) {
            // Move from other gap if can.
            const moveFromMaxGap = Math.min(gapOtherBound, -gapThisBound);
            if (moveFromMaxGap > 0) {
                shiftList(moveFromMaxGap * moveDir, 0, len);
                const remained = moveFromMaxGap + gapThisBound;
                if (remained < 0) {
                    squeezeGaps(-remained * moveDir);
                }
            }
            else {
                squeezeGaps(-gapThisBound * moveDir);
            }
        }
    }

    function shiftList(delta: number, start: number, end: number) {
        for (let i = start; i < end; i++) {
            const item = list[i];
            const rect = item.rect;
            rect[xyDim] += delta;
            item.label[xyDim] += delta;
        }
    }

    // Squeeze gaps if the labels exceed margin.
    function squeezeGaps(delta: number) {
        const gaps: number[] = [];
        let totalGaps = 0;
        for (let i = 1; i < len; i++) {
            const prevItemRect = list[i - 1].rect;
            const gap = Math.max(list[i].rect[xyDim] - prevItemRect[xyDim] - prevItemRect[sizeDim], 0);
            gaps.push(gap);
            totalGaps += gap;
        }
        if (!totalGaps) {
            return;
        }

        for (let i = 0; i < len - 1; i++) {
            // Distribute the shift delta to all gaps.
            // NOTE:
            // it may overlap if remained gap is not enough for the total movements.
            // aka totalGaps / delta is < 1. In this situation the label may move too much and cause overlap again.
            // This is by design. Let the hideOverlap do the job instead of keep exceeding the bounds.
            shiftList(gaps[i] / totalGaps * delta, 0, i + 1);
        }
    }
}

/**
 * Adjust labels on x direction to avoid overlap.
 */
export function shiftLayoutOnX(
    list: LabelLayoutInfo[],
    leftBound: number,
    rightBound: number
) {
    shiftLayout(list, 'x', 'width', leftBound, rightBound);
}

/**
 * Adjust labels on y direction to avoid overlap.
 */
export function shiftLayoutOnY(
    list: LabelLayoutInfo[],
    topBound: number,
    bottomBound: number
) {
    shiftLayout(list, 'y', 'height', topBound, bottomBound);
}

export function hideOverlap(labelList: LabelLayoutInfo[]) {
    const displayedLabels: LabelLayoutInfo[] = [];

    // TODO, render overflow visible first, put in the displayedLabels.
    labelList.sort(function (a, b) {
        return b.priority - a.priority;
    });

    const globalRect = new BoundingRect(0, 0, 0, 0);

    for (let i = 0; i < labelList.length; i++) {
        const labelItem = labelList[i];
        const isAxisAligned = labelItem.axisAligned;
        const localRect = labelItem.localRect;
        const transform = labelItem.transform;
        const label = labelItem.label;
        const labelLine = labelItem.labelLine;
        globalRect.copy(labelItem.rect);
        // Add a threshold because layout may be aligned precisely.
        globalRect.width -= 0.1;
        globalRect.height -= 0.1;
        globalRect.x += 0.05;
        globalRect.y += 0.05;

        let obb = labelItem.obb;
        let overlapped = false;
        for (let j = 0; j < displayedLabels.length; j++) {
            const existsTextCfg = displayedLabels[j];
            // Fast rejection.
            if (!globalRect.intersect(existsTextCfg.rect)) {
                continue;
            }

            if (isAxisAligned && existsTextCfg.axisAligned) {   // Is overlapped
                overlapped = true;
                break;
            }

            if (!existsTextCfg.obb) { // If self is not axis aligned. But other is.
                existsTextCfg.obb = new OrientedBoundingRect(existsTextCfg.localRect, existsTextCfg.transform);
            }

            if (!obb) { // If self is axis aligned. But other is not.
                obb = new OrientedBoundingRect(localRect, transform);
            }

            if (obb.intersect(existsTextCfg.obb)) {
                overlapped = true;
                break;
            }
        }

        // TODO Callback to determine if this overlap should be handled?
        if (overlapped) {
            label.hide();
            labelLine && labelLine.hide();
        }
        else {
            label.attr('ignore', labelItem.defaultAttr.ignore);
            labelLine && labelLine.attr('ignore', labelItem.defaultAttr.labelGuideIgnore);

            displayedLabels.push(labelItem);
        }
    }
}