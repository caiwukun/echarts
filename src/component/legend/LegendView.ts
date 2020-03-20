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
import * as zrUtil from 'zrender/src/core/util';
import {createSymbol} from '../../util/symbol';
import * as graphic from '../../util/graphic';
import {makeBackground} from '../helper/listComponent';
import * as layoutUtil from '../../util/layout';
import ComponentView from '../../view/Component';
import LegendModel, { LegendOption, LegendSelectorButtonOption, LegendTooltipFormatterParams } from './LegendModel';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../ExtensionAPI';
import {
    ColorString,
    ZRTextAlign,
    ZRColor,
    ItemStyleOption,
    ZRRectLike,
    ECElement,
    CommonTooltipOption
} from '../../util/types';
import Model from '../../model/Model';

var curry = zrUtil.curry;
var each = zrUtil.each;
var Group = graphic.Group;

class LegendView extends ComponentView {
    static type = 'legend.plain';
    type = LegendView.type;

    newlineDisabled = false;

    private _contentGroup: graphic.Group;

    private _backgroundEl: graphic.Rect;

    private _selectorGroup: graphic.Group;

    /**
     * If first rendering, `contentGroup.position` is [0, 0], which
     * does not make sense and may cause unexepcted animation if adopted.
     */
    private _isFirstRender: boolean;

    init() {

        this.group.add(this._contentGroup = new Group());
        this.group.add(this._selectorGroup = new Group());

        this._isFirstRender = true;
    }

    /**
     * @protected
     */
    getContentGroup() {
        return this._contentGroup;
    }

    /**
     * @protected
     */
    getSelectorGroup() {
        return this._selectorGroup;
    }

    /**
     * @override
     */
    render(
        legendModel: LegendModel,
        ecModel: GlobalModel,
        api: ExtensionAPI
    ) {
        var isFirstRender = this._isFirstRender;
        this._isFirstRender = false;

        this.resetInner();

        if (!legendModel.get('show', true)) {
            return;
        }

        var itemAlign = legendModel.get('align');
        var orient = legendModel.get('orient');
        if (!itemAlign || itemAlign === 'auto') {
            itemAlign = (
                legendModel.get('left') === 'right'
                && orient === 'vertical'
            ) ? 'right' : 'left';
        }

        // selector has been normalized to an array in model
        var selector = legendModel.get('selector', true) as LegendSelectorButtonOption[];
        var selectorPosition = legendModel.get('selectorPosition', true);
        if (selector && (!selectorPosition || selectorPosition === 'auto')) {
            selectorPosition = orient === 'horizontal' ? 'end' : 'start';
        }

        this.renderInner(itemAlign, legendModel, ecModel, api, selector, orient, selectorPosition);

        // Perform layout.
        var positionInfo = legendModel.getBoxLayoutParams();
        var viewportSize = {width: api.getWidth(), height: api.getHeight()};
        var padding = legendModel.get('padding');

        var maxSize = layoutUtil.getLayoutRect(positionInfo, viewportSize, padding);

        var mainRect = this.layoutInner(legendModel, itemAlign, maxSize, isFirstRender, selector, selectorPosition);

        // Place mainGroup, based on the calculated `mainRect`.
        var layoutRect = layoutUtil.getLayoutRect(
            zrUtil.defaults({
                width: mainRect.width,
                height: mainRect.height
            }, positionInfo),
            viewportSize,
            padding
        );
        this.group.attr('position', [layoutRect.x - mainRect.x, layoutRect.y - mainRect.y]);

        // Render background after group is layout.
        this.group.add(
            this._backgroundEl = makeBackground(mainRect, legendModel)
        );
    }

    protected resetInner() {
        this.getContentGroup().removeAll();
        this._backgroundEl && this.group.remove(this._backgroundEl);
        this.getSelectorGroup().removeAll();
    }

    protected renderInner(
        itemAlign: LegendOption['align'],
        legendModel: LegendModel,
        ecModel: GlobalModel,
        api: ExtensionAPI,
        selector: LegendSelectorButtonOption[],
        orient: LegendOption['orient'],
        selectorPosition: LegendOption['selectorPosition']
    ) {
        var contentGroup = this.getContentGroup();
        var legendDrawnMap = zrUtil.createHashMap();
        var selectMode = legendModel.get('selectedMode');

        var excludeSeriesId: string[] = [];
        ecModel.eachRawSeries(function (seriesModel) {
            !seriesModel.get('legendHoverLink') && excludeSeriesId.push(seriesModel.id);
        });

        each(legendModel.getData(), function (itemModel, dataIndex) {
            var name = itemModel.get('name');

            // Use empty string or \n as a newline string
            if (!this.newlineDisabled && (name === '' || name === '\n')) {
                const g = new Group();
                // @ts-ignore
                g.newline = true;
                contentGroup.add(g);
                return;
            }

            // Representitive series.
            var seriesModel = ecModel.getSeriesByName(name)[0];

            if (legendDrawnMap.get(name)) {
                // Have been drawed
                return;
            }

            // Legend to control series.
            if (seriesModel) {
                var data = seriesModel.getData();
                var color = data.getVisual('color');
                var borderColor = data.getVisual('borderColor');

                // If color is a callback function
                if (typeof color === 'function') {
                    // Use the first data
                    color = color(seriesModel.getDataParams(0));
                }

                 // If borderColor is a callback function
                if (typeof borderColor === 'function') {
                    // Use the first data
                    borderColor = borderColor(seriesModel.getDataParams(0));
                }

                // Using rect symbol defaultly
                var legendSymbolType = data.getVisual('legendSymbol') || 'roundRect';
                var symbolType = data.getVisual('symbol');

                var itemGroup = this._createItem(
                    name, dataIndex, itemModel, legendModel,
                    legendSymbolType, symbolType,
                    itemAlign, color, borderColor,
                    selectMode
                );

                itemGroup.on('click', curry(dispatchSelectAction, name, null, api, excludeSeriesId))
                    .on('mouseover', curry(dispatchHighlightAction, seriesModel.name, null, api, excludeSeriesId))
                    .on('mouseout', curry(dispatchDownplayAction, seriesModel.name, null, api, excludeSeriesId));

                legendDrawnMap.set(name, true);
            }
            else {
                // Legend to control data. In pie and funnel.
                ecModel.eachRawSeries(function (seriesModel) {

                    // In case multiple series has same data name
                    if (legendDrawnMap.get(name)) {
                        return;
                    }

                    if (seriesModel.legendVisualProvider) {
                        var provider = seriesModel.legendVisualProvider;
                        if (!provider.containName(name)) {
                            return;
                        }

                        var idx = provider.indexOfName(name);

                        var color = provider.getItemVisual(idx, 'color');
                        var borderColor = provider.getItemVisual(idx, 'borderColor');

                        var legendSymbolType = 'roundRect';

                        var itemGroup = this._createItem(
                            name, dataIndex, itemModel, legendModel,
                            legendSymbolType, null,
                            itemAlign, color, borderColor,
                            selectMode
                        );

                        // FIXME: consider different series has items with the same name.
                        itemGroup.on('click', curry(dispatchSelectAction, null, name, api, excludeSeriesId))
                            // Should not specify the series name, consider legend controls
                            // more than one pie series.
                            .on('mouseover', curry(dispatchHighlightAction, null, name, api, excludeSeriesId))
                            .on('mouseout', curry(dispatchDownplayAction, null, name, api, excludeSeriesId));

                        legendDrawnMap.set(name, true);
                    }

                }, this);
            }

            if (__DEV__) {
                if (!legendDrawnMap.get(name)) {
                    console.warn(
                        name + ' series not exists. Legend data should be same with series name or data name.'
                    );
                }
            }
        }, this);

        if (selector) {
            this._createSelector(selector, legendModel, api, orient, selectorPosition);
        }
    }

    private _createSelector(
        selector: LegendSelectorButtonOption[],
        legendModel: LegendModel,
        api: ExtensionAPI,
        orient: LegendOption['orient'],
        selectorPosition: LegendOption['selectorPosition']
    ) {
        var selectorGroup = this.getSelectorGroup();

        each(selector, function createSelectorButton(selectorItem) {
            var type = selectorItem.type;

            var labelText = new graphic.Text({
                style: {
                    x: 0,
                    y: 0,
                    textAlign: 'center',
                    textVerticalAlign: 'middle'
                },
                onclick() {
                    api.dispatchAction({
                        type: type === 'all' ? 'legendAllSelect' : 'legendInverseSelect'
                    });
                }
            });

            selectorGroup.add(labelText);

            var labelModel = legendModel.getModel('selectorLabel');
            var emphasisLabelModel = legendModel.getModel(['emphasis', 'selectorLabel']);

            graphic.setLabelStyle(
                labelText.style, labelText.hoverStyle = {}, labelModel, emphasisLabelModel,
                {
                    defaultText: selectorItem.title,
                    isRectText: false
                }
            );
            graphic.setHoverStyle(labelText);
        });
    }

    private _createItem(
        name: string,
        dataIndex: number,
        itemModel: LegendModel['_data'][number],
        legendModel: LegendModel,
        legendSymbolType: string,
        symbolType: string,
        itemAlign: LegendOption['align'],
        color: ColorString,
        borderColor: ColorString,
        selectMode: LegendOption['selectedMode']
    ) {
        var itemWidth = legendModel.get('itemWidth');
        var itemHeight = legendModel.get('itemHeight');
        var inactiveColor = legendModel.get('inactiveColor');
        var inactiveBorderColor = legendModel.get('inactiveBorderColor');
        var symbolKeepAspect = legendModel.get('symbolKeepAspect');
        var legendModelItemStyle = legendModel.getModel('itemStyle');

        var isSelected = legendModel.isSelected(name);
        var itemGroup = new Group();

        var textStyleModel = itemModel.getModel('textStyle');

        var itemIcon = itemModel.get('icon');

        var tooltipModel = itemModel.getModel('tooltip') as Model<CommonTooltipOption<LegendTooltipFormatterParams>>;
        var legendGlobalTooltipModel = tooltipModel.parentModel;

        // Use user given icon first
        legendSymbolType = itemIcon || legendSymbolType;
        var legendSymbol = createSymbol(
            legendSymbolType,
            0,
            0,
            itemWidth,
            itemHeight,
            isSelected ? color : inactiveColor,
            // symbolKeepAspect default true for legend
            symbolKeepAspect == null ? true : symbolKeepAspect
        );
        itemGroup.add(
            setSymbolStyle(
                legendSymbol, legendSymbolType, legendModelItemStyle,
                borderColor, inactiveBorderColor, isSelected
            )
        );

        // Compose symbols
        // PENDING
        if (!itemIcon && symbolType
            // At least show one symbol, can't be all none
            && ((symbolType !== legendSymbolType) || symbolType === 'none')
        ) {
            var size = itemHeight * 0.8;
            if (symbolType === 'none') {
                symbolType = 'circle';
            }
            var legendSymbolCenter = createSymbol(
                symbolType,
                (itemWidth - size) / 2,
                (itemHeight - size) / 2,
                size,
                size,
                isSelected ? color : inactiveColor,
                // symbolKeepAspect default true for legend
                symbolKeepAspect == null ? true : symbolKeepAspect
            );
            // Put symbol in the center
            itemGroup.add(
                setSymbolStyle(
                    legendSymbolCenter, symbolType, legendModelItemStyle,
                    borderColor, inactiveBorderColor, isSelected
                )
            );
        }

        var textX = itemAlign === 'left' ? itemWidth + 5 : -5;
        var textAlign = itemAlign as ZRTextAlign;

        var formatter = legendModel.get('formatter');
        var content = name;
        if (typeof formatter === 'string' && formatter) {
            content = formatter.replace('{name}', name != null ? name : '');
        }
        else if (typeof formatter === 'function') {
            content = formatter(name);
        }

        itemGroup.add(new graphic.Text({
            style: graphic.setTextStyle({}, textStyleModel, {
                text: content,
                x: textX,
                y: itemHeight / 2,
                textFill: isSelected ? textStyleModel.getTextColor() : inactiveColor,
                textAlign: textAlign,
                textVerticalAlign: 'middle'
            })
        }));

        // Add a invisible rect to increase the area of mouse hover
        var hitRect = new graphic.Rect({
            shape: itemGroup.getBoundingRect(),
            invisible: true
        });
        if (tooltipModel.get('show')) {
            const formatterParams: LegendTooltipFormatterParams = {
                componentType: 'legend',
                legendIndex: legendModel.componentIndex,
                name: name,
                $vars: ['name']
            };
            (hitRect as ECElement).tooltip = zrUtil.extend({
                content: name,
                // Defaul formatter
                formatter: legendGlobalTooltipModel.get('formatter', true)
                    || function (params: LegendTooltipFormatterParams) {
                        return params.name;
                    },
                formatterParams: formatterParams
            }, tooltipModel.option);
        }
        itemGroup.add(hitRect);

        itemGroup.eachChild(function (child) {
            child.silent = true;
        });

        hitRect.silent = !selectMode;

        this.getContentGroup().add(itemGroup);

        graphic.setHoverStyle(itemGroup);

        // @ts-ignore
        itemGroup.__legendDataIndex = dataIndex;

        return itemGroup;
    }

    protected layoutInner(
        legendModel: LegendModel,
        itemAlign: LegendOption['align'],
        maxSize: { width: number, height: number },
        isFirstRender: boolean,
        selector: LegendOption['selector'],
        selectorPosition: LegendOption['selectorPosition']
    ): ZRRectLike {
        var contentGroup = this.getContentGroup();
        var selectorGroup = this.getSelectorGroup();

        // Place items in contentGroup.
        layoutUtil.box(
            legendModel.get('orient'),
            contentGroup,
            legendModel.get('itemGap'),
            maxSize.width,
            maxSize.height
        );

        var contentRect = contentGroup.getBoundingRect();
        var contentPos = [-contentRect.x, -contentRect.y];

        if (selector) {
            // Place buttons in selectorGroup
            layoutUtil.box(
                // Buttons in selectorGroup always layout horizontally
                'horizontal',
                selectorGroup,
                legendModel.get('selectorItemGap', true)
            );

            var selectorRect = selectorGroup.getBoundingRect();
            var selectorPos = [-selectorRect.x, -selectorRect.y];
            var selectorButtonGap = legendModel.get('selectorButtonGap', true);

            var orientIdx = legendModel.getOrient().index;
            var wh: 'width' | 'height' = orientIdx === 0 ? 'width' : 'height';
            var hw: 'width' | 'height' = orientIdx === 0 ? 'height' : 'width';
            var yx: 'x' | 'y' = orientIdx === 0 ? 'y' : 'x';

            if (selectorPosition === 'end') {
                selectorPos[orientIdx] += contentRect[wh] + selectorButtonGap;
            }
            else {
                contentPos[orientIdx] += selectorRect[wh] + selectorButtonGap;
            }

            //Always align selector to content as 'middle'
            selectorPos[1 - orientIdx] += contentRect[hw] / 2 - selectorRect[hw] / 2;
            selectorGroup.attr('position', selectorPos);
            contentGroup.attr('position', contentPos);

            var mainRect = {x: 0, y: 0} as ZRRectLike;
            mainRect[wh] = contentRect[wh] + selectorButtonGap + selectorRect[wh];
            mainRect[hw] = Math.max(contentRect[hw], selectorRect[hw]);
            mainRect[yx] = Math.min(0, selectorRect[yx] + selectorPos[1 - orientIdx]);
            return mainRect;
        }
        else {
            contentGroup.attr('position', contentPos);
            return this.group.getBoundingRect();
        }
    }

    /**
     * @protected
     */
    remove() {
        this.getContentGroup().removeAll();
        this._isFirstRender = true;
    }

}

function setSymbolStyle(
    symbol: graphic.Path | graphic.Image,
    symbolType: string,
    legendModelItemStyle: Model<ItemStyleOption>,
    borderColor: ZRColor,
    inactiveBorderColor: ZRColor,
    isSelected: boolean
) {
    var itemStyle;
    if (symbolType !== 'line' && symbolType.indexOf('empty') < 0) {
        itemStyle = legendModelItemStyle.getItemStyle();
        symbol.style.stroke = borderColor;
        if (!isSelected) {
            itemStyle.stroke = inactiveBorderColor;
        }
    }
    else {
        itemStyle = legendModelItemStyle.getItemStyle(['borderWidth', 'borderColor']);
    }
    return symbol.setStyle(itemStyle);
}

function dispatchSelectAction(
    seriesName: string,
    dataName: string,
    api: ExtensionAPI,
    excludeSeriesId: string[]
) {
    // downplay before unselect
    dispatchDownplayAction(seriesName, dataName, api, excludeSeriesId);
    api.dispatchAction({
        type: 'legendToggleSelect',
        name: seriesName != null ? seriesName : dataName
    });
    // highlight after select
    dispatchHighlightAction(seriesName, dataName, api, excludeSeriesId);
}

function dispatchHighlightAction(
    seriesName: string,
    dataName: string,
    api: ExtensionAPI,
    excludeSeriesId: string[]
) {
    // If element hover will move to a hoverLayer.
    var el = api.getZr().storage.getDisplayList()[0];
    if (!(el && el.useHoverLayer)) {
        api.dispatchAction({
            type: 'highlight',
            seriesName: seriesName,
            name: dataName,
            excludeSeriesId: excludeSeriesId
        });
    }
}

function dispatchDownplayAction(
    seriesName: string,
    dataName: string,
    api: ExtensionAPI,
    excludeSeriesId: string[]
) {
    // If element hover will move to a hoverLayer.
    var el = api.getZr().storage.getDisplayList()[0];
    if (!(el && el.useHoverLayer)) {
        api.dispatchAction({
            type: 'downplay',
            seriesName: seriesName,
            name: dataName,
            excludeSeriesId: excludeSeriesId
        });
    }
}


ComponentView.registerClass(LegendView);

export default LegendView;