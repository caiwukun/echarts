import WeakMap from 'zrender/src/core/WeakMap';
import {DecalObject, DecalDashArrayX, DecalDashArrayY} from 'zrender/src/graphic/Decal';
import { PatternObject } from 'zrender/src/graphic/Pattern';
import LRU from 'zrender/src/core/LRU';
import {defaults, createCanvas, map, isArray} from 'zrender/src/core/util';
import {getLeastCommonMultiple} from './number';
import {createSymbol} from './symbol';
import {util} from 'zrender/src/export';
import ExtensionAPI from '../ExtensionAPI';
import type SVGPainter from 'zrender/src/svg/Painter';
import type CanvasPainter from 'zrender/src/canvas/Painter';
import { brushSingle } from 'zrender/src/canvas/graphic';

const decalMap = new WeakMap<DecalObject, PatternObject>();

const decalCache = new LRU<HTMLCanvasElement | SVGElement>(100);

const decalKeys = [
    'symbol', 'symbolSize', 'symbolKeepAspect',
    'color', 'backgroundColor',
    'dashArrayX', 'dashArrayY', 'dashLineOffset',
    'maxTileWidth', 'maxTileHeight'
];

/**
 * Create or update pattern image from decal options
 *
 * @param {DecalObject} decalObject decal options
 * @return {Pattern} pattern with generated image
 */
export function createOrUpdatePatternFromDecal(
    decalObject: DecalObject,
    api: ExtensionAPI
): PatternObject {
    const dpr = api.getDevicePixelRatio();
    const zr = api.getZr();
    const isSVG = zr.painter.type === 'svg';

    if (decalObject.dirty) {
        decalMap.delete(decalObject);
    }

    const oldPattern = decalMap.get(decalObject);
    if (oldPattern) {
        return oldPattern;
    }

    const decalOpt = defaults(decalObject, {
        symbol: 'rect',
        symbolSize: 1,
        symbolKeepAspect: true,
        color: 'rgba(0, 0, 0, 0.2)',
        backgroundColor: null,
        dashArrayX: 5,
        dashArrayY: 5,
        dashLineOffset: 0,
        rotation: 0,
        maxTileWidth: 512,
        maxTileHeight: 512
    } as DecalObject);
    if (decalOpt.backgroundColor === 'none') {
        decalOpt.backgroundColor = null;
    }

    const pattern: PatternObject = { repeat: 'repeat' } as PatternObject;
    setPatternnSource(pattern);
    pattern.rotation = decalOpt.rotation;
    pattern.scaleX = pattern.scaleY = isSVG ? 1 : 1 / dpr;

    decalMap.set(decalObject, pattern);

    decalObject.dirty = false;

    return pattern;

    function setPatternnSource(pattern: PatternObject) {
        const keys = [dpr];
        let isValidKey = true;
        for (let i = 0; i < decalKeys.length; ++i) {
            const value = (decalOpt as any)[decalKeys[i]];
            const valueType = typeof value;
            if (value != null
                && !isArray(value)
                && valueType !== 'string'
                && valueType !== 'number'
                && valueType !== 'boolean'
            ) {
                isValidKey = false;
                break;
            }
            keys.push(value);
        }

        let cacheKey;
        if (isValidKey) {
            cacheKey = keys.join(',') + (isSVG ? '-svg' : '');
            const cache = decalCache.get(cacheKey);
            if (cache) {
                isSVG ? pattern.svgElement = cache as SVGElement
                    : pattern.image = cache as HTMLCanvasElement;
            }
        }

        const dashArrayX = normalizeDashArrayX(decalOpt.dashArrayX);
        const dashArrayY = normalizeDashArrayY(decalOpt.dashArrayY);
        const lineBlockLengthsX = getLineBlockLengthX(dashArrayX);
        const lineBlockLengthY = getLineBlockLengthY(dashArrayY);

        const canvas = !isSVG && createCanvas();
        const svgRoot = isSVG && (zr.painter as SVGPainter).createSVGElement('g');
        const pSize = getPatternSize();
        let ctx: CanvasRenderingContext2D;
        if (canvas) {
            canvas.width = pSize.width * dpr;
            canvas.height = pSize.height * dpr;
            ctx = canvas.getContext('2d');
        }
        brushDecal();

        if (isValidKey) {
            decalCache.put(cacheKey, canvas || svgRoot);
        }

        pattern.image = canvas;
        pattern.svgElement = svgRoot;
        pattern.svgWidth = pSize.width;
        pattern.svgHeight = pSize.height;

        /**
         * Get minumum length that can make a repeatable pattern.
         *
         * @return {Object} pattern width and height
         */
        function getPatternSize(): {
            width: number,
            height: number,
            lines: number
        } {
            /**
             * For example, if dash is [[3, 2], [2, 1]] for X, it looks like
             * |---  ---  ---  ---  --- ...
             * |-- -- -- -- -- -- -- -- ...
             * |---  ---  ---  ---  --- ...
             * |-- -- -- -- -- -- -- -- ...
             * So the minumum length of X is 15,
             * which is the least common multiple of `3 + 2` and `2 + 1`
             * |---  ---  ---  |---  --- ...
             * |-- -- -- -- -- |-- -- -- ...
             *
             * When consider with dashLineOffset, it means the `n`th line has the offset
             * of `n * dashLineOffset`.
             * For example, if dash is [[3, 1], [1, 1]] and dashLineOffset is 3,
             * and use `=` for the start to make it clear, it looks like
             * |=-- --- --- --- --- -...
             * | - = - - - - - - - - ...
             * |- --- =-- --- --- -- ...
             * | - - - - = - - - - - ...
             * |--- --- --- =-- --- -...
             * | - - - - - - - = - - ...
             * In this case, the minumum length is 12, which is the least common
             * multiple of `3 + 1`, `1 + 1` and `3 * 2` where `2` is xlen
             * |=-- --- --- |--- --- -...
             * | - = - - - -| - - - - ...
             * |- --- =-- --|- --- -- ...
             * | - - - - = -| - - - - ...
             */
            const offsetMultipleX = decalOpt.dashLineOffset || 1;
            let width = 1;
            for (let i = 0, xlen = lineBlockLengthsX.length; i < xlen; ++i) {
                const x = getLeastCommonMultiple(offsetMultipleX * xlen, lineBlockLengthsX[i]);
                width = getLeastCommonMultiple(width, x);
            }
            const columns = decalOpt.dashLineOffset
                ? width / offsetMultipleX
                : 2;
            const height = lineBlockLengthY * columns;

            if (__DEV__) {
                const warn = (attrName: string) => {
                    /* eslint-disable-next-line */
                    console.warn(`Calculated decal size is greater than ${attrName} due to decal option settings so ${attrName} is used for the decal size. Please consider changing the decal option to make a smaller decal or set ${attrName} to be larger to avoid incontinuity.`);
                };
                if (width > decalOpt.maxTileWidth) {
                    warn('maxTileWidth');
                }
                if (height > decalOpt.maxTileHeight) {
                    warn('maxTileHeight');
                }
            }

            return {
                width: Math.max(1, Math.min(width, decalOpt.maxTileWidth)),
                height: Math.max(1, Math.min(height, decalOpt.maxTileHeight)),
                lines: columns
            };
        }

        function brushDecal() {
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (decalOpt.backgroundColor) {
                    ctx.fillStyle = decalOpt.backgroundColor;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }

            let ySum = 0;
            for (let i = 0; i < dashArrayY.length; ++i) {
                ySum += dashArrayY[i];
            }
            if (ySum <= 0) {
                // dashArrayY is 0, draw nothing
                return;
            }

            let yCnt = 0;
            let y = -pSize.lines * lineBlockLengthY;
            let yId = 0;
            let xId0 = 0;
            while (y < pSize.height) {
                if (yId % 2 === 0) {
                    let x = fixStartPosition(
                        decalOpt.dashLineOffset * (yCnt - pSize.lines) / 2,
                        lineBlockLengthsX[0]
                    );
                    let xId1 = 0;
                    while (x < pSize.width * 2) {
                        let xSum = 0;
                        for (let i = 0; i < dashArrayX[xId0].length; ++i) {
                            xSum += dashArrayX[xId0][i];
                        }
                        if (xSum <= 0) {
                            // Skip empty line
                            break;
                        }

                        // E.g., [15, 5, 20, 5] draws only for 15 and 20
                        if (xId1 % 2 === 0) {
                            const size = (1 - decalOpt.symbolSize) * 0.5;
                            const left = x + dashArrayX[xId0][xId1] * size;
                            const top = y + dashArrayY[yId] * size;
                            const width = dashArrayX[xId0][xId1] * decalOpt.symbolSize;
                            const height = dashArrayY[yId] * decalOpt.symbolSize;
                            brushSymbol(left, top, width, height);
                        }

                        x += dashArrayX[xId0][xId1];
                        ++xId1;
                        if (xId1 === dashArrayX[xId0].length) {
                            xId1 = 0;
                        }
                    }

                    ++xId0;
                    if (xId0 === dashArrayX.length) {
                        xId0 = 0;
                    }
                }

                ++yCnt;
                y += dashArrayY[yId];

                ++yId;
                if (yId === dashArrayY.length) {
                    yId = 0;
                }
            }

            function brushSymbol(x: number, y: number, width: number, height: number) {
                const scale = isSVG ? 1 : dpr;
                const symbol = createSymbol(
                    decalOpt.symbol,
                    x * scale,
                    y * scale,
                    width * scale,
                    height * scale
                );
                symbol.style.fill = decalOpt.color;
                if (isSVG) {
                    svgRoot.appendChild((zr.painter as SVGPainter).paintOne(symbol));
                }
                else {
                    // Paint to canvas for all other renderers.
                    brushSingle(ctx, symbol);
                }
            }
        }
    }

}

/**
 * Convert dash input into dashArray
 *
 * @param {DecalDashArrayX} dash dash input
 * @return {number[][]} normolized dash array
 */
function normalizeDashArrayX(dash: DecalDashArrayX): number[][] {
    if (!dash || (dash as number[]).length === 0) {
        return [[0, 0]];
    }
    if (typeof dash === 'number') {
        const dashValue = Math.ceil(dash);
        return [[dashValue, dashValue]];
    }

    /**
     * [20, 5] should be normalized into [[20, 5]],
     * while [20, [5, 10]] should be normalized into [[20, 20], [5, 10]]
     */
    let isAllNumber = true;
    for (let i = 0; i < dash.length; ++i) {
        if (typeof dash[i] !== 'number') {
            isAllNumber = false;
            break;
        }
    }
    if (isAllNumber) {
        return normalizeDashArrayX([dash as number[]]);
    }

    const result: number[][] = [];
    for (let i = 0; i < dash.length; ++i) {
        if (typeof dash[i] === 'number') {
            const dashValue = Math.ceil(dash[i] as number);
            result.push([dashValue, dashValue]);
        }
        else {
            const dashValue = util.map(dash[i] as number[], n => Math.ceil(n));
            if (dashValue.length % 2 === 1) {
                // [4, 2, 1] means |----  -    -- |----  -    -- |
                // so normalize it to be [4, 2, 1, 4, 2, 1]
                result.push(dashValue.concat(dashValue));
            }
            else {
                result.push(dashValue);
            }
        }
    }
    return result;
}

/**
 * Convert dash input into dashArray
 *
 * @param {DecalDashArrayY} dash dash input
 * @return {number[]} normolized dash array
 */
function normalizeDashArrayY(dash: DecalDashArrayY): number[] {
    if (!dash || typeof dash === 'object' && dash.length === 0) {
        return [0, 0];
    }
    if (typeof dash === 'number') {
        const dashValue = Math.ceil(dash);
        return [dashValue, dashValue];
    }

    const dashValue = util.map(dash as number[], n => Math.ceil(n));
    return dash.length % 2 ? dashValue.concat(dashValue) : dashValue;
}

/**
 * Get block length of each line. A block is the length of dash line and space.
 * For example, a line with [4, 1] has a dash line of 4 and a space of 1 after
 * that, so the block length of this line is 5.
 *
 * @param {number[][]} dash dash arrary of X or Y
 * @return {number[]} block length of each line
 */
function getLineBlockLengthX(dash: number[][]): number[] {
    return map(dash, function (line) {
        return getLineBlockLengthY(line);
    });
}

function getLineBlockLengthY(dash: number[]): number {
    let blockLength = 0;
    for (let i = 0; i < dash.length; ++i) {
        blockLength += dash[i];
    }
    if (dash.length % 2 === 1) {
        // [4, 2, 1] means |----  -    -- |----  -    -- |
        // So total length is (4 + 2 + 1) * 2
        return blockLength * 2;
    }
    return blockLength;
}

function fixStartPosition(lineOffset: number, blockLength: number) {
    let start = lineOffset || 0;
    while (start > 0) {
        start -= blockLength;
    }
    return start;
}
