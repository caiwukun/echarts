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
 * This module is imported by echarts directly.
 *
 * Notice:
 * Always keep this file exists for backward compatibility.
 * Because before 4.1.0, dataset is an optional component,
 * some users may import this module manually.
 */

import ComponentModel from '../model/Component';
import ComponentView from '../view/Component';
import {detectSourceFormat} from '../data/helper/sourceHelper';
import {
    SERIES_LAYOUT_BY_COLUMN, ComponentOption, SeriesEncodeOptionMixin, OptionSourceData, SeriesLayoutBy
} from '../util/types';


interface DatasetOption extends
        Pick<ComponentOption, 'type' | 'id' | 'name'>,
        Pick<SeriesEncodeOptionMixin, 'dimensions'> {
    seriesLayoutBy?: SeriesLayoutBy;
    // null/undefined/'auto': auto detect header, see "src/data/helper/sourceHelper".
    sourceHeader?: boolean | 'auto';
    data?: OptionSourceData;
}

class DatasetModel extends ComponentModel {

    type = 'dataset';
    static type = 'dataset';

    static defaultOption: DatasetOption = {
        seriesLayoutBy: SERIES_LAYOUT_BY_COLUMN
    };

    optionUpdated() {
        detectSourceFormat(this);
    }
}

ComponentModel.registerClass(DatasetModel);


class DatasetView extends ComponentView {
    static type = 'dataset';
    type = 'dataset';
}

ComponentView.registerClass(DatasetView);

