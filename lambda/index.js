var Alexa = require('ask-sdk-core');
var https = require('https');

// ── Logging ──
var RequestLogInterceptor = {
    process: function(handlerInput) {
        console.log('REQUEST: ' + Alexa.getRequestType(handlerInput.requestEnvelope));
    }
};

// ── DataStore REST API helper ──
function updateDataStore(apiEndpoint, apiAccessToken, deviceId, showBell) {
    var payload = JSON.stringify({
        commands: [{
            type: 'PUT_OBJECT',
            namespace: 'quickStickies',
            key: 'alertState',
            content: { showBell: showBell }
        }],
        target: {
            type: 'DEVICES',
            items: [deviceId]
        }
    });

    // Extract hostname from apiEndpoint (e.g. "https://api.amazonalexa.com")
    var hostname = apiEndpoint.replace('https://', '').replace('http://', '');

    var options = {
        hostname: hostname,
        path: '/v1/datastore/commands',
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + apiAccessToken,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise(function(resolve, reject) {
        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                console.log('DataStore response: ' + res.statusCode + ' ' + body);
                resolve(res.statusCode);
            });
        });
        req.on('error', function(err) {
            console.log('DataStore error: ' + err.message);
            resolve(500); // don't crash on network error
        });
        req.write(payload);
        req.end();
    });
}

// ── Start the HTML Web App ──
function startWebApp(handlerInput) {
    console.log('Launching Quick Stickies Web App...');

    // Check if device supports HTML
    var htmlSupported = Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.HTML'];
    if (!htmlSupported) {
        console.log('Device does not support HTML');
        return handlerInput.responseBuilder
            .speak('Sorry, Quick Stickies requires a screen device with web support.')
            .getResponse();
    }

    var startDirective = {
        type: 'Alexa.Presentation.HTML.Start',
        data: {
            appName: 'Quick Stickies'
        },
        request: {
            uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=3',
            method: 'GET'
        },
        configuration: {
            timeoutInSeconds: 300
        }
    };

    return handlerInput.responseBuilder
        .addDirective(startDirective)
        .withShouldEndSession(undefined)
        .getResponse();
}

// ── Voice launch → go straight to HTML app ──
var LaunchRequestHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle: function(handlerInput) {
        console.log('Voice Launch → HTML App');
        return startWebApp(handlerInput);
    }
};

// ── Widget tap → go straight to HTML app (no lobby) ──
var UserEventHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    handle: function(handlerInput) {
        console.log('Widget Tap → HTML App (direct)');
        return startWebApp(handlerInput);
    }
};

// ── Handle messages from HTML web app ──
var HtmlMessageHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.HTML.Message';
    },
    handle: function(handlerInput) {
        var msg = handlerInput.requestEnvelope.request.message || {};
        console.log('HTML Message: ' + JSON.stringify(msg));

        if (msg.type === 'setAlert') {
            var showBell = !!msg.value;
            console.log('Setting alert bell to: ' + showBell);

            var sys = handlerInput.requestEnvelope.context.System;
            var apiEndpoint = sys.apiEndpoint || 'https://api.amazonalexa.com';
            var apiAccessToken = sys.apiAccessToken;
            var deviceId = sys.device && sys.device.deviceId;

            if (!apiAccessToken || !deviceId) {
                console.log('Missing token or deviceId');
                return handlerInput.responseBuilder
                    .addDirective({
                        type: 'Alexa.Presentation.HTML.HandleMessage',
                        message: { status: 'error', reason: 'no-token-or-device', hasToken: !!apiAccessToken, hasDevice: !!deviceId }
                    })
                    .withShouldEndSession(undefined)
                    .getResponse();
            }

            return updateDataStore(apiEndpoint, apiAccessToken, deviceId, showBell)
                .then(function(statusCode) {
                    return handlerInput.responseBuilder
                        .addDirective({
                            type: 'Alexa.Presentation.HTML.HandleMessage',
                            message: { status: statusCode === 200 ? 'ok' : 'fail', code: statusCode, bell: showBell }
                        })
                        .withShouldEndSession(undefined)
                        .getResponse();
                });
        }

        return handlerInput.responseBuilder
            .withShouldEndSession(undefined)
            .getResponse();
    }
};

// ── Widget installed → initialize DataStore with bell OFF ──
var UsagesInstalledHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesInstalled';
    },
    handle: function(handlerInput) {
        console.log('Widget installed → initializing DataStore');

        var apiEndpoint = handlerInput.requestEnvelope.context.System.apiEndpoint;
        var apiAccessToken = handlerInput.requestEnvelope.context.System.apiAccessToken;
        var deviceId = handlerInput.requestEnvelope.context.System.device.deviceId;

        return updateDataStore(apiEndpoint, apiAccessToken, deviceId, false)
            .then(function() {
                return handlerInput.responseBuilder.getResponse();
            });
    }
};

// ── Widget removed → clean up DataStore ──
var UsagesRemovedHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesRemoved';
    },
    handle: function(handlerInput) {
        console.log('Widget removed → cleaning up');
        return handlerInput.responseBuilder.getResponse();
    }
};

// ── Session end ──
var SessionEndedRequestHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle: function(handlerInput) {
        console.log('Session ended: ' + handlerInput.requestEnvelope.request.reason);
        return handlerInput.responseBuilder.getResponse();
    }
};

// ── Error fallback ──
var ErrorHandler = {
    canHandle: function() { return true; },
    handle: function(handlerInput, error) {
        console.log('Error: ' + error.stack);
        return handlerInput.responseBuilder
            .speak('Sorry, something went wrong with Quick Stickies.')
            .getResponse();
    }
};

// ── Build ──
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        UserEventHandler,
        HtmlMessageHandler,
        UsagesInstalledHandler,
        UsagesRemovedHandler,
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(RequestLogInterceptor)
    .addErrorHandlers(ErrorHandler)
    .lambda();
