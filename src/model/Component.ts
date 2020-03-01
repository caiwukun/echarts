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
import Model from './Model';
import * as componentUtil from '../util/component';
import {
    enableClassManagement,
    parseClassType,
    isExtendedClass,
    ExtendableConstructor,
    ClassManager,
    mountExtend
} from '../util/clazz';
import {makeInner} from '../util/model';
import * as layout from '../util/layout';
import GlobalModel from './Global';
import {
    ComponentOption,
    ComponentMainType,
    ComponentSubType,
    ComponentFullType,
    ComponentLayoutMode,
    BoxLayoutOptionMixin
} from '../util/types';

var inner = makeInner<{
    defaultOption: ComponentOption
}>();

class ComponentModel<Opt extends ComponentOption = ComponentOption> extends Model<Opt> {

    // [Caution]: for compat the previous "class extend"
    // publich and protected fields must be initialized on
    // prototype rather than in constructor. Otherwise the
    // subclass overrided filed will be overwritten by this
    // class. That is, they should not be initialized here.

    /**
     * @readonly
     */
    type: ComponentFullType;

    /**
     * @readonly
     */
    id: string;

    /**
     * Because simplified concept is probably better, series.name (or component.name)
     * has been having too many resposibilities:
     * (1) Generating id (which requires name in option should not be modified).
     * (2) As an index to mapping series when merging option or calling API (a name
     * can refer to more then one components, which is convinient is some case).
     * (3) Display.
     * @readOnly But injected
     */
    name: string;

    /**
     * @readOnly
     */
    mainType: ComponentMainType;

    /**
     * @readOnly
     */
    subType: ComponentSubType;

    /**
     * @readOnly
     */
    componentIndex: number;

    /**
     * @readOnly
     */
    protected defaultOption: ComponentOption;

    /**
     * @readOnly
     */
    ecModel: GlobalModel;

    /**
     * @readOnly
     */
    static dependencies: string[];

    /**
     * key: componentType
     * value: Component model list, can not be null.
     * @readOnly
     */
    dependentModels: {[componentType: string]: ComponentModel[]} = {};

    readonly uid: string;

    // // No common coordinateSystem needed. Each sub class implement
    // // `CoordinateSystemHostModel` itself.
    // coordinateSystem: CoordinateSystemMaster | CoordinateSystemExecutive;

    /**
     * Support merge layout params.
     * Only support 'box' now (left/right/top/bottom/width/height).
     */
    static layoutMode: ComponentLayoutMode | ComponentLayoutMode['type'];

    // Injectable properties:
    __viewId: string;

    static protoInitialize = (function () {
        var proto = ComponentModel.prototype;
        proto.type = 'component';
        proto.id = '';
        proto.name = '';
        proto.mainType = '';
        proto.subType = '';
        proto.componentIndex = 0;
    })();


    constructor(option: Opt, parentModel: Model, ecModel: GlobalModel) {
        super(option, parentModel, ecModel);
        this.uid = componentUtil.getUID('ec_cpt_model');
    }

    init(option: Opt, parentModel: Model, ecModel: GlobalModel): void {
        this.mergeDefaultAndTheme(option, ecModel);
    }

    mergeDefaultAndTheme(option: Opt, ecModel: GlobalModel): void {
        var layoutMode = layout.fetchLayoutMode(this);
        var inputPositionParams = layoutMode
            ? layout.getLayoutParams(option as BoxLayoutOptionMixin) : {};

        var themeModel = ecModel.getTheme();
        zrUtil.merge(option, themeModel.get(this.mainType));
        zrUtil.merge(option, this.getDefaultOption());

        if (layoutMode) {
            layout.mergeLayoutParam(option as BoxLayoutOptionMixin, inputPositionParams, layoutMode);
        }
    }

    mergeOption(option: ComponentOption, ecModel: GlobalModel): void {
        zrUtil.merge(this.option, option, true);

        var layoutMode = layout.fetchLayoutMode(this);
        if (layoutMode) {
            layout.mergeLayoutParam(
                this.option as BoxLayoutOptionMixin,
                option as BoxLayoutOptionMixin,
                layoutMode
            );
        }
    }

    // Hooker after init or mergeOption
    optionUpdated(newCptOption: ComponentOption, isInit: boolean): void {}

    /**
     * [How to declare defaultOption]:
     *
     * (A) If using class declaration in typescript (since echarts 5):
     * ```ts
     * import {ComponentOption} from '../model/option';
     * export interface XxxOption extends ComponentOption {
     *     aaa: number
     * }
     * export class XxxModel extends Component {
     *     static type = 'xxx';
     *     static defaultOption: XxxOption = {
     *         aaa: 123
     *     }
     * }
     * Component.registerClass(XxxModel);
     * ```
     * ```ts
     * import {mergeOption} from '../model/util';
     * import {XxxModel, XxxOption} from './XxxModel';
     * export interface XxxSubOption extends XxxOption {
     *     bbb: number
     * }
     * class XxxSubModel extends XxxModel {
     *     readonly defaultOption: XxxSubOption = mergeOption({
     *         bbb: 456
     *     }, XxxModel.prototype.defaultOption)
     *     fn() {
     *         var opt = this.getDefaultOption();
     *         // opt is {aaa: 123, bbb: 456}
     *     }
     * }
     * ```
     *
     * (B) If using class extend (previous approach in echarts 3 & 4):
     * ```js
     * var XxxComponent = Component.extend({
     *     defaultOption: {
     *         xx: 123
     *     }
     * })
     * ```
     * ```js
     * var XxxSubComponent = XxxComponent.extend({
     *     defaultOption: {
     *         yy: 456
     *     },
     *     fn: function () {
     *         var opt = this.getDefaultOption();
     *         // opt is {xx: 123, yy: 456}
     *     }
     * })
     * ```
     */
    getDefaultOption(): ComponentOption {
        var ctor = this.constructor;

        // If using class declaration, it is different to travel super class
        // in legacy env and auto merge defaultOption. So if using class
        // declaration, defaultOption should be merged manually.
        if (!isExtendedClass(ctor)) {
            // When using ts class, defaultOption must be declared as static.
            return (ctor as any).defaultOption;
        }

        // FIXME: remove this approach?
        var fields = inner(this);
        if (!fields.defaultOption) {
            var optList = [];
            var clz = ctor as ExtendableConstructor;
            while (clz) {
                var opt = clz.prototype.defaultOption;
                opt && optList.push(opt);
                clz = clz.superClass;
            }

            var defaultOption = {};
            for (var i = optList.length - 1; i >= 0; i--) {
                defaultOption = zrUtil.merge(defaultOption, optList[i], true);
            }
            fields.defaultOption = defaultOption;
        }
        return fields.defaultOption;
    }

    getReferringComponents(mainType: ComponentMainType): ComponentModel[] {
        const indexKey = (mainType + 'Index') as keyof Opt;
        const idKey = (mainType + 'Id') as keyof Opt;
        return this.ecModel.queryComponents({
            mainType: mainType,
            index: this.get(indexKey, true) as unknown as number,
            id: this.get(idKey, true) as unknown as string
        });
    }

    getBoxLayoutParams() {
        // Consider itself having box layout configs.
        const boxLayoutModel = this as Model<ComponentOption & BoxLayoutOptionMixin>;
        return {
            left: boxLayoutModel.get('left'),
            top: boxLayoutModel.get('top'),
            right: boxLayoutModel.get('right'),
            bottom: boxLayoutModel.get('bottom'),
            width: boxLayoutModel.get('width'),
            height: boxLayoutModel.get('height')
        };
    }

    static registerClass: ClassManager['registerClass'];

    static registerSubTypeDefaulter: componentUtil.SubTypeDefaulterManager['registerSubTypeDefaulter'];
}

// Reset ComponentModel.extend, add preConstruct.
// clazzUtil.enableClassExtend(
//     ComponentModel,
//     function (option, parentModel, ecModel, extraOpt) {
//         // Set dependentModels, componentIndex, name, id, mainType, subType.
//         zrUtil.extend(this, extraOpt);

//         this.uid = componentUtil.getUID('componentModel');

//         // this.setReadOnly([
//         //     'type', 'id', 'uid', 'name', 'mainType', 'subType',
//         //     'dependentModels', 'componentIndex'
//         // ]);
//     }
// );

export type ComponentModelConstructor = typeof ComponentModel
    & ClassManager
    & componentUtil.SubTypeDefaulterManager
    & ExtendableConstructor
    & componentUtil.TopologicalTravelable<object>;

mountExtend(ComponentModel, Model);
enableClassManagement(ComponentModel as ComponentModelConstructor, {registerWhenExtend: true});
componentUtil.enableSubTypeDefaulter(ComponentModel as ComponentModelConstructor);
componentUtil.enableTopologicalTravel(ComponentModel as ComponentModelConstructor, getDependencies);


function getDependencies(componentType: string): string[] {
    var deps: string[] = [];
    zrUtil.each((ComponentModel as ComponentModelConstructor).getClassesByMainType(componentType), function (clz) {
        deps = deps.concat((clz as any).dependencies || (clz as any).prototype.dependencies || []);
    });

    // Ensure main type.
    deps = zrUtil.map(deps, function (type) {
        return parseClassType(type).main;
    });

    // Hack dataset for convenience.
    if (componentType !== 'dataset' && zrUtil.indexOf(deps, 'dataset') <= 0) {
        deps.unshift('dataset');
    }

    return deps;
}

export default ComponentModel;
