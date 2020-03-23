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

import Group from 'zrender/src/graphic/Group';
import * as componentUtil from '../util/component';
import * as clazzUtil from '../util/clazz';
import ComponentModel from '../model/Component';
import GlobalModel from '../model/Global';
import ExtensionAPI from '../ExtensionAPI';
import {Payload, ViewRootGroup, ECEvent, EventQueryItem} from '../util/types';
import Element from 'zrender/src/Element';

interface ComponentView {
    /**
     * Implement it if needed.
     */
    updateTransform?(
        seriesModel: ComponentModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload
    ): void | {update: true};

    /**
     * Pass only when return `true`.
     * Implement it if needed.
     */
    filterForExposedEvent(
        eventType: string, query: EventQueryItem, targetEl: Element, packedEvent: ECEvent
    ): boolean;
}

class ComponentView {

    // [Caution]: for compat the previous "class extend"
    // publich and protected fields must be initialized on
    // prototype rather than in constructor. Otherwise the
    // subclass overrided filed will be overwritten by this
    // class. That is, they should not be initialized here.

    readonly group: ViewRootGroup;

    readonly uid: string;

    // ----------------------
    // Injectable properties
    // ----------------------
    __model: ComponentModel;
    __alive: boolean;
    __id: string;

    constructor() {
        this.group = new Group();
        this.uid = componentUtil.getUID('viewComponent');
    }

    init(ecModel: GlobalModel, api: ExtensionAPI): void {}

    render(model: ComponentModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload): void {}

    dispose(ecModel: GlobalModel, api: ExtensionAPI): void {}

    updateView(model: ComponentModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload): void {
        // Do nothing;
    }

    updateLayout(model: ComponentModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload): void {
        // Do nothing;
    }

    updateVisual(model: ComponentModel, ecModel: GlobalModel, api: ExtensionAPI, payload: Payload): void {
        // Do nothing;
    }

    static registerClass: clazzUtil.ClassManager['registerClass'];
};


export type ComponentViewConstructor = typeof ComponentView
    & clazzUtil.ExtendableConstructor
    & clazzUtil.ClassManager;

clazzUtil.enableClassExtend(ComponentView as ComponentViewConstructor);
clazzUtil.enableClassManagement(ComponentView as ComponentViewConstructor, {registerWhenExtend: true});

export default ComponentView;
