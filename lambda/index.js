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

// ── Widget tap & lobby button ──
var UserEventHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    handle: function(handlerInput) {
        var args = handlerInput.requestEnvelope.request.arguments || [];
        var eventName = args[0];

        // Lobby button → launch HTML app
        if (eventName === 'START_WEB_APP') {
            console.log('Lobby Button → HTML App');
            return startWebApp(handlerInput);
        }

        // Widget tap → show APL lobby screen
        console.log('Widget Tap → APL Lobby');
        return handlerInput.responseBuilder
            .addDirective({
                type: 'Alexa.Presentation.APL.RenderDocument',
                token: 'LOBBY',
                document: {
                    type: 'APL',
                    version: '2023.2',
                    import: [{ name: 'alexa-layouts', version: '1.7.0' }],
                    mainTemplate: {
                        items: [{
                            type: 'Container',
                            width: '100%',
                            height: '100%',
                            backgroundColor: '#1a1a2e',
                            alignItems: 'center',
                            justifyContent: 'center',
                            items: [
                                {
                                    type: 'Text',
                                    text: 'Quick Stickies',
                                    fontSize: '42dp',
                                    color: '#FFF2AB',
                                    fontWeight: 'bold',
                                    paddingBottom: '24dp'
                                },
                                {
                                    type: 'AlexaButton',
                                    buttonText: 'Open Quick Stickies',
                                    buttonStyle: 'contained',
                                    primaryAction: [{
                                        type: 'SendEvent',
                                        arguments: ['START_WEB_APP']
                                    }]
                                }
                            ]
                        }]
                    }
                }
            })
            .speak('Quick Stickies. Tap to open.')
            .reprompt('Tap the button to open Quick Stickies.')
            .withShouldEndSession(false)
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
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(RequestLogInterceptor)
    .addErrorHandlers(ErrorHandler)
    .lambda();
