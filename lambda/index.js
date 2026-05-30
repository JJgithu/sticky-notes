var Alexa = require('ask-sdk-core');

// ── Logging ──
var RequestLogInterceptor = {
    process: function(handlerInput) {
        console.log('REQUEST: ' + Alexa.getRequestType(handlerInput.requestEnvelope));
    }
};

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
            uri: 'https://jjgithu.github.io/sticky-notes/web/index.html',
            method: 'GET'
        },
        configuration: {
            timeoutInSeconds: 300
        }
    };

    return handlerInput.responseBuilder
        .addDirective(startDirective)
        .speak('Loading Quick Stickies.')
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
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.HTML.HandleMessage';
    },
    handle: function(handlerInput) {
        var msg = handlerInput.requestEnvelope.request.message || {};
        console.log('HTML Message: ' + JSON.stringify(msg));

        if (msg.type === 'setAlert') {
            console.log('Alert set to: ' + msg.value);
            // TODO: persist alert state via DataStore for widget bell icon
        }

        return handlerInput.responseBuilder
            .withShouldEndSession(undefined)
            .getResponse();
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
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(RequestLogInterceptor)
    .addErrorHandlers(ErrorHandler)
    .lambda();
