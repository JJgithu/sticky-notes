const Alexa = require('ask-sdk-core');

// ── APL Document ──
const appDocument = require('./app.json');

// ── Logging ──
const RequestLogInterceptor = {
    process(handlerInput) {
        const type = Alexa.getRequestType(handlerInput.requestEnvelope);
        console.log(`REQUEST: ${type}`);
    }
};

// ── Helper: Render the full-screen APL notes app ──
function renderApp(handlerInput, speechText) {
    const rb = handlerInput.responseBuilder
        .addDirective({
            type: 'Alexa.Presentation.APL.RenderDocument',
            token: 'STICKY_NOTES_APP',
            document: appDocument
        })
        .withShouldEndSession(undefined);

    if (speechText) {
        rb.speak(speechText);
    }

    return rb.getResponse();
}

// ── Handlers ──

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        console.log('Voice Launch → Rendering APL App');
        return renderApp(handlerInput, 'Sticky Notes is ready.');
    }
};

const UserEventHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    handle(handlerInput) {
        const args = handlerInput.requestEnvelope.request.arguments || [];
        const eventName = args[0];

        // Widget tap → open the full app
        if (eventName === 'OpenWidget') {
            console.log('Widget Tap → Rendering APL App');
            return renderApp(handlerInput, 'Sticky Notes is ready.');
        }

        // Keep-alive ping from the APL document's onMount timer
        if (eventName === 'keepAlive') {
            return handlerInput.responseBuilder
                .withShouldEndSession(undefined)
                .getResponse();
        }

        // Unknown event — respond silently
        console.log('Unknown UserEvent:', eventName);
        return handlerInput.responseBuilder.getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended: ${handlerInput.requestEnvelope.request.reason}`);
        return handlerInput.responseBuilder.getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error: ${error.stack}`);
        return handlerInput.responseBuilder
            .speak('Sorry, something went wrong with Sticky Notes.')
            .getResponse();
    }
};

// ── Skill Builder ──
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        UserEventHandler,
        SessionEndedRequestHandler
    )
    .addRequestInterceptors(
        RequestLogInterceptor
    )
    .addErrorHandlers(
        ErrorHandler
    )
    .lambda();
