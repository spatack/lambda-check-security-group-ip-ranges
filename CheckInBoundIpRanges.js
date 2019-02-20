'use strict';

const aws = require('aws-sdk');

const config = new aws.ConfigService();


// Helper function used to validate input
function checkDefined(reference, referenceName) {
    if (!reference) {
        throw new Error(`Error: ${referenceName} is not defined`);
    }
    return reference;
}

// Based on the type of message get the configuration item either from configurationItem in the invoking event or using the getResourceConfigHistiry API in getConfiguration function.
function getConfigurationItem(invokingEvent, callback) {
    checkDefined(invokingEvent, 'invokingEvent');
    checkDefined(invokingEvent.configurationItem, 'configurationItem');
    callback(null, invokingEvent.configurationItem);
}

// Check whether the resource has been deleted. If it has, then the evaluation is unnecessary.
function isApplicable(configurationItem, event) {
    checkDefined(configurationItem, 'configurationItem');
    checkDefined(event, 'event');
    const status = configurationItem.configurationItemStatus;
    const eventLeftScope = event.eventLeftScope;
    return (status === 'OK' || status === 'ResourceDiscovered') && eventLeftScope === false;
}

// This is where it's determined whether the resource is compliant or not.
// In this example, we simply decide that the resource is compliant if it is an instance and its type matches the type specified as the desired type.
// If the resource is not an instance, then we deem this resource to be not applicable. (If the scope of the rule is specified to include only
// instances, this rule would never have been invoked.)
function evaluateChangeNotificationCompliance(configurationItem, ruleParameters) {
    checkDefined(configurationItem, 'configurationItem');
    checkDefined(configurationItem.configuration, 'configurationItem.configuration');
    checkDefined(ruleParameters, 'ruleParameters');

    if (configurationItem.resourceType !== 'AWS::EC2::SecurityGroup') {
        return 'NOT_APPLICABLE';
    } else if (getIpPermissions(configurationItem.configuration, ruleParameters)) {
        return 'COMPLIANT';
    }
    return 'NON_COMPLIANT';
}

// 获取IpPermissions内容
function getIpPermissions(configuration, ruleParameters) {
    //获取ip列表
    const ipPermissions = configuration.ipPermissions;
    for (let i = 0; i < ipPermissions.length; i++) {
        //获取ipRanges
        let ipRanges = ipPermissions[i].ipRanges;
        for (let j = 0; j < ipRanges.length; j++) {
            if (ipRanges[j] === ruleParameters.ipRanges)
                return false;
        }
    }
    return true;
}

// This is the handler that's invoked by Lambda
// Most of this code is boilerplate; use as is
exports.handler = (event, context, callback) => {
    checkDefined(event, 'event');
    const invokingEvent = JSON.parse(event.invokingEvent);
    const ruleParameters = JSON.parse(event.ruleParameters);
    getConfigurationItem(invokingEvent, (err, configurationItem) => {
        if (err) {
            callback(err);
        }
        let compliance = 'NOT_APPLICABLE';
        const putEvaluationsRequest = {};
        if (isApplicable(configurationItem, event)) {
            // Invoke the compliance checking function.
            compliance = evaluateChangeNotificationCompliance(configurationItem, ruleParameters);
        }
        // Put together the request that reports the evaluation status
        putEvaluationsRequest.Evaluations = [
            {
                ComplianceResourceType: configurationItem.resourceType,
                ComplianceResourceId: configurationItem.resourceId,
                ComplianceType: compliance,
                OrderingTimestamp: configurationItem.configurationItemCaptureTime,
            },
        ];
        putEvaluationsRequest.ResultToken = event.resultToken;

        // Invoke the Config API to report the result of the evaluation
        config.putEvaluations(putEvaluationsRequest, (error, data) => {
            if (error) {
                callback(error, null);
            } else if (data.FailedEvaluations.length > 0) {
                // Ends the function execution if any evaluation results are not successfully reported.
                callback(JSON.stringify(data), null);
            } else {
                callback(null, data);
            }
        });
    });
};
