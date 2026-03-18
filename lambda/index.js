const Alexa = require('ask-sdk-core');

// 1. INTERCEPTOR: Log everything for debugging
const RequestLogInterceptor = {
    process(handlerInput) {
        console.log(`INPUT REQUEST TYPE: ${Alexa.getRequestType(handlerInput.requestEnvelope)}`);
        console.log(`INPUT REQUEST JSON: ${JSON.stringify(handlerInput.requestEnvelope.request, null, 2)}`);
    }
};

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        console.log('Voice Launch Request');
        return startWebApp(handlerInput);
    }
};

const WidgetUserEventHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    handle(handlerInput) {
        const args = handlerInput.requestEnvelope.request.arguments || [];
        const eventName = args[0];

        if (eventName === 'START_WEB_APP') {
            console.log('Lobby Button Tapped! Proceeding to Web App.');
            return startWebApp(handlerInput);
        }

        console.log('Widget Tapped! Rendering Interactive Lobby Screen.');
        return handlerInput.responseBuilder
            .addDirective({
                type: 'Alexa.Presentation.APL.RenderDocument',
                token: 'LOBBY_SCREEN',
                document: {
                    type: 'APL',
                    version: '2023.2',
                    import: [
                        {
                            name: 'alexa-layouts',
                            version: '1.7.0'
                        }
                    ],
                    mainTemplate: {
                        items: [
                            {
                                type: 'Container',
                                width: '100%',
                                height: '100%',
                                backgroundColor: '#202020',
                                alignItems: 'center',
                                justifyContent: 'center',
                                items: [
                                    {
                                        type: 'Text',
                                        text: 'Welcome to Sticky Notes',
                                        fontSize: '40dp',
                                        color: '#FFF2AB',
                                        paddingBottom: '30dp'
                                    },
                                    {
                                        type: 'AlexaButton',
                                        buttonText: 'Enter Editor',
                                        buttonStyle: 'contained',
                                        primaryAction: [
                                            {
                                                type: 'SendEvent',
                                                arguments: ['START_WEB_APP']
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                }
            })
            .withShouldEndSession(undefined)
            .speak('Welcome to Sticky notes. Tap enter to start drawing.')
            .getResponse();
    }
};

function startWebApp(handlerInput) {
    console.log('Sending Alexa.Presentation.HTML.Start directive...');
    return handlerInput.responseBuilder
        .speak('Launching blank test.')
        .addDirective({
            type: 'Alexa.Presentation.HTML.Start',
            request: {
                uri: `https://jjgithu.github.io/sticky-notes/web/editor.html?t=${Date.now()}`,
                method: 'GET'
            }
        })
        .withShouldEndSession(undefined)
        .getResponse();
}

const CreateNoteIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'CreateNoteIntent';
    },
    handle(handlerInput) {
        return startWebApp(handlerInput);
    }
};

const HtmlMessageHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.HTML.Message';
    },
    handle(handlerInput) {
        const message = handlerInput.requestEnvelope.request.message;
        console.log(`Received HTML message: ${JSON.stringify(message)}`);

        if (message && message.action === 'syncData' && message.noteCount !== undefined) {
            console.log(`Updating DataStore with note count: ${message.noteCount}`);
            
            const updateToken = `update-token-${Date.now()}`;
            
            let displayString = `${message.noteCount} open notes`;
            if (message.noteCount === 1) displayString = `1 open note`;
            if (message.noteCount === 0) displayString = `Tap to create a note...`;

            return handlerInput.responseBuilder
                .addDirective({
                    type: 'Alexa.DataStore.PackageManager.UpdateRequest',
                    token: updateToken,
                    payload: {
                        packages: [
                            {
                                packageId: 'widget_data',
                                type: 'COMMAND',
                                commands: [
                                    {
                                        type: 'PUT_NAMESPACE',
                                        namespace: 'quick_stickies'
                                    },
                                    {
                                        type: 'PUT_OBJECT',
                                        namespace: 'quick_stickies',
                                        key: 'open_notes_count',
                                        content: {
                                            displayString: displayString
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                })
                .getResponse();
        }

        return handlerInput.responseBuilder.getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended reason: ${handlerInput.requestEnvelope.request.reason}`);
        return handlerInput.responseBuilder.getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.stack}`);
        console.log(`~~~~ UNHANDLED REQUEST JSON: ${JSON.stringify(handlerInput.requestEnvelope.request, null, 2)}`);

        return handlerInput.responseBuilder
            .speak('Sorry, I had trouble doing what you asked.')
            .getResponse();
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        WidgetUserEventHandler,
        CreateNoteIntentHandler,
        HtmlMessageHandler,
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(
        RequestLogInterceptor
    )
    .addErrorHandlers(
        ErrorHandler
    )
    .lambda();
