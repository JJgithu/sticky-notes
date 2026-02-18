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

        // STEP 2: The "Loading Screen" has mounted and sent us the SPECIAL Internal Signal.
        // NOW we are successfully in the Foreground, so we can launch the HTML App.
        if (eventName === 'INTERNAL_LAUNCH_CMD') {
            console.log('Step 2: Transitioning from Loading Screen to Web App');
            return startWebApp(handlerInput);
        }

        // STEP 1: Handle Initial Widget Taps.
        // We catch BOTH 'OpenWidget' (New Code) and 'LaunchWebApp' (Old Code/Cached)
        // This ensures it works even if the Widget on the device is outdated.
        console.log('Step 1: Rendering Loading Screen to bridge Modality...');
        return handlerInput.responseBuilder
            .speak('Loading.') // Short speech to confirm receipt and active session
            .addDirective({
                type: 'Alexa.Presentation.APL.RenderDocument',
                token: 'LOADING_SCREEN',
                document: {
                    type: 'APL',
                    version: '2023.2',
                    import: [{ name: 'alexa-layouts', version: '1.7.0' }],
                    onMount: [
                        {
                            type: 'SendEvent',
                            arguments: ['INTERNAL_LAUNCH_CMD'], // Unique signal for Step 2
                            interactionMode: 'STANDARD'
                        }
                    ],
                    mainTemplate: {
                        items: [
                            {
                                type: 'Container',
                                width: '100%',
                                height: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                items: [
                                    {
                                        type: 'Text',
                                        text: 'Loading Sticky Notes...',
                                        fontSize: '40dp',
                                        color: 'white'
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
    const htmlInterface = Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.HTML'];

    if (htmlInterface) {
        console.log('Sending Alexa.Presentation.HTML.Start directive...');
        return handlerInput.responseBuilder
            .speak('Opening Sticky Notes')
            .addDirective({
                type: 'Alexa.Presentation.HTML.Start',
                data: {
                    initialData: {
                        mode: 'create'
                    }
                },
                request: {
                    uri: 'https://jjgithu.github.io/sticky-notes/editor.html',
                    method: 'GET'
                }
            })
            .getResponse();
    }

    return handlerInput.responseBuilder
        .speak('This device does not support the interactive sticky notes.')
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
