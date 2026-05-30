var Alexa = require('ask-sdk-core');
var https = require('https');
var querystring = require('querystring');

// ══════════════════════════════════════════════════════════════
// !! FILL THESE IN from Developer Console → Build → Permissions
// !! (scroll to bottom to find "Alexa Client Id" and "Alexa Client Secret")
// ══════════════════════════════════════════════════════════════
var SKILL_CLIENT_ID     = 'PASTE_YOUR_CLIENT_ID_HERE';
var SKILL_CLIENT_SECRET = 'PASTE_YOUR_CLIENT_SECRET_HERE';

// ── Logging ──
var RequestLogInterceptor = {
    process: function(handlerInput) {
        console.log('REQUEST: ' + Alexa.getRequestType(handlerInput.requestEnvelope));
    }
};

// ── Get LWA token with alexa::datastore scope ──
function getLwaToken() {
    var postData = querystring.stringify({
        grant_type: 'client_credentials',
        client_id: SKILL_CLIENT_ID,
        client_secret: SKILL_CLIENT_SECRET,
        scope: 'alexa::datastore'
    });

    var options = {
        hostname: 'api.amazon.com',
        path: '/auth/o2/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise(function(resolve, reject) {
        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                console.log('LWA response: ' + res.statusCode);
                if (res.statusCode === 200) {
                    var data = JSON.parse(body);
                    resolve(data.access_token);
                } else {
                    console.log('LWA error body: ' + body);
                    resolve(null);
                }
            });
        });
        req.on('error', function(err) {
            console.log('LWA error: ' + err.message);
            resolve(null);
        });
        req.write(postData);
        req.end();
    });
}

// ── DataStore REST API helper ──
function updateDataStore(deviceId, showBell) {
    return getLwaToken().then(function(token) {
        if (!token) {
            console.log('No LWA token, cannot update DataStore');
            return 401;
        }

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

        var options = {
            hostname: 'api.amazonalexa.com',
            path: '/v1/datastore/commands',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        return new Promise(function(resolve) {
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
                resolve(500);
            });
            req.write(payload);
            req.end();
        });
    });
}

// ── Track alert state in memory (survives within Lambda container) ──
var alertState = false;

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
            appName: 'Quick Stickies',
            alertOn: alertState
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
            alertState = showBell;  // remember for next launch
            console.log('Setting alert bell to: ' + showBell);

            var sys = handlerInput.requestEnvelope.context.System;
            var deviceId = sys.device && sys.device.deviceId;

            if (!deviceId) {
                console.log('Missing deviceId');
                return handlerInput.responseBuilder
                    .addDirective({
                        type: 'Alexa.Presentation.HTML.HandleMessage',
                        message: { status: 'error', reason: 'no-device-id' }
                    })
                    .withShouldEndSession(undefined)
                    .getResponse();
            }

            return updateDataStore(deviceId, showBell)
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

        var deviceId = handlerInput.requestEnvelope.context.System.device.deviceId;

        return updateDataStore(deviceId, false)
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
