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
        console.log('Received Widget UserEvent with args:', args);
        const eventName = args[0];

        // STEP 2: The "Loading Screen" has mounted and sent us the INTERNAL signal.
        if (eventName === 'INTERNAL_LAUNCH_CMD') {
            console.log('Step 2: Transitioning from Loading Screen to Web App');
            return startWebApp(handlerInput);
        }

        // STEP 1: Handle Initial Widget Taps.
        console.log('Step 1: Rendering Loading Screen to bridge Modality...');
        return handlerInput.responseBuilder
            .addDirective({
                type: 'Alexa.Presentation.APL.RenderDocument',
                token: 'LOADING_SCREEN',
                document: {
                    type: 'APL',
                    version: '2023.2',
                    onMount: [
                        {
                            type: 'SendEvent',
                            arguments: ['INTERNAL_LAUNCH_CMD']
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
                                        text: 'Loading Stickies...',
                                        fontSize: '40dp',
                                        color: '#00ff00'
                                    }
                                ]
                            }
                        ]
                    }
                }
            })
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
                uri: 'https://jjgithu.github.io/sticky-notes/web/blank.html',
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
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(
        RequestLogInterceptor
    )
    .addErrorHandlers(
        ErrorHandler
    )
    .lambda();
