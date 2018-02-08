import {createHashMap, each} from 'zrender/src/core/util';

// (1) [Caution]: the logic is correct based on the premises:
//     data processing stage is blocked in stream.
//     See <module:echarts/stream/Scheduler#performDataProcessorTasks>
// (2) Only register once when import repeatly.
//     Should be executed before after series filtered and before stack calculation.
export default function (ecModel) {
    var stackInfoMap = createHashMap();
    ecModel.eachSeries(function (seriesModel) {
        var stack = seriesModel.get('stack');
        // Compatibal: when `stack` is set as '', do not stack.
        if (stack) {
            var stackInfoList = stackInfoMap.get(stack) || stackInfoMap.set(stack, []);
            var data = seriesModel.getData();

            stackInfoList.length && data.setCalculationInfo(
                'stackedOnSeries', stackInfoList[stackInfoList.length - 1].seriesModel
            );

            stackInfoList.push({
                // Used for calculate axis extent automatically.
                stackResultDimension: data.getCalculationInfo('stackResultDimension'),
                stackedOverDimension: data.getCalculationInfo('stackedOverDimension'),
                stackedDimension: data.getCalculationInfo('stackedDimension'),
                stackedByDimension: data.getCalculationInfo('stackedByDimension'),
                data: data,
                seriesModel: seriesModel
            });
        }
    });

    stackInfoMap.each(calculateStack);
}

function calculateStack(stackInfoList) {
    each(stackInfoList, function (targetStackInfo, idxInStack) {
        var resultVal = [];
        var resultNaN = [NaN, NaN];
        var dims = [targetStackInfo.stackResultDimension, targetStackInfo.stackedOverDimension];
        var targetData = targetStackInfo.data;

        // Should not write on raw data, because stack series model list changes
        // depending on legend selection.
        var newData = targetData.map(dims, function (v0, v1, dataIndex) {
            var sum = targetData.get(targetStackInfo.stackedDimension, dataIndex);

            // Consider `connectNulls` of line area, if value is NaN, stackedOver
            // should also be NaN, to draw a appropriate belt area.
            if (isNaN(sum)) {
                return resultNaN;
            }

            var byValue = targetData.get(targetStackInfo.stackedByDimension, dataIndex);
            var stackedOver = 0;

            for (var j = idxInStack - 1; j >= 0; j--) {
                var stackInfo = stackInfoList[j];

                // Has been optimized by inverted indices on `stackedByDimension`.
                var stackedDataRawIndex = stackInfo.data.rawIndexOf(stackInfo.stackedByDimension, byValue);
                if (stackedDataRawIndex >= 0) {
                    var val = stackInfo.data.getByRawIndex(stackInfo.stackResultDimension, stackedDataRawIndex);

                    // Considering positive stack, negative stack and empty data
                    if ((sum >= 0 && val > 0) // Positive stack
                        || (sum <= 0 && val < 0) // Negative stack
                    ) {
                        sum += val;
                        stackedOver = val;
                        break;
                    }
                }
            }

            resultVal[0] = sum;
            resultVal[1] = stackedOver;

            return resultVal;
        });

        targetData.hostModel.setData(newData);
        // Update for consequent calculation
        targetStackInfo.data = newData;
    });
}
