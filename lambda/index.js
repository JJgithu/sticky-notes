var Alexa = require('ask-sdk-core');
var https = require('https');
var querystring = require('querystring');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();
var S3_BUCKET = process.env.S3_PERSISTENCE_BUCKET || '';

// ══════════════════════════════════════════════════════════════
// !! FILL THESE IN from Developer Console → Build → Permissions
// ══════════════════════════════════════════════════════════════
var SKILL_CLIENT_ID     = process.env.SKILL_CLIENT_ID || 'PASTE_IN_ALEXA_CONSOLE';
var SKILL_CLIENT_SECRET = process.env.SKILL_CLIENT_SECRET || 'PASTE_IN_ALEXA_CONSOLE';

// ── Logging ──
var RequestLogInterceptor = {
    process: function(handlerInput) {
        console.log('REQUEST: ' + Alexa.getRequestType(handlerInput.requestEnvelope));
    }
};

// ══════════════════════════════════════════════
// ── S3 Note Persistence ──
// ══════════════════════════════════════════════
function getUserId(handlerInput) {
    try {
        return handlerInput.requestEnvelope.context.System.user.userId;
    } catch(e) { return 'default'; }
}

function saveNotesToS3(userId, notes) {
    if (!S3_BUCKET) {
        console.log('No S3 bucket configured');
        return Promise.resolve();
    }
    return s3.putObject({
        Bucket: S3_BUCKET,
        Key: 'notes/' + userId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json',
        Body: JSON.stringify(notes),
        ContentType: 'application/json'
    }).promise().then(function() {
        console.log('Notes saved to S3 (' + notes.length + ' notes)');
    }).catch(function(err) {
        console.log('S3 save error: ' + err.message);
    });
}

function loadNotesFromS3(userId) {
    if (!S3_BUCKET) return Promise.resolve([]);
    var safeId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return s3.getObject({
        Bucket: S3_BUCKET,
        Key: 'notes/' + safeId + '.json'
    }).promise().then(function(data) {
        var notes = JSON.parse(data.Body.toString());
        console.log('Notes loaded from S3 (' + notes.length + ' notes)');
        return notes;
    }).catch(function(err) {
        console.log('S3 load: ' + err.message);
        return [];
    });
}

// ── Canvas S3 persistence ──
function safeUserId(userId) {
    return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function saveCanvasToS3(userId, noteId, base64Data) {
    if (!S3_BUCKET || !base64Data) return Promise.resolve();
    // Strip the data:image/...;base64, prefix
    var raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
    return s3.putObject({
        Bucket: S3_BUCKET,
        Key: 'canvas/' + safeUserId(userId) + '/' + noteId + '.png',
        Body: Buffer.from(raw, 'base64'),
        ContentType: 'image/png'
    }).promise().then(function() {
        console.log('Canvas saved: ' + noteId);
    }).catch(function(err) {
        console.log('Canvas save error: ' + err.message);
    });
}

function loadCanvasData(userId, notes) {
    if (!S3_BUCKET || !notes || !notes.length) return Promise.resolve(notes);
    var safe = safeUserId(userId);
    var promises = notes.map(function(note) {
        if (!note.id) return Promise.resolve();
        return s3.getObject({
            Bucket: S3_BUCKET,
            Key: 'canvas/' + safe + '/' + note.id + '.png'
        }).promise().then(function(data) {
            note.canvasData = 'data:image/png;base64,' + data.Body.toString('base64');
            console.log('Canvas loaded: ' + note.id + ' (' + note.canvasData.length + ' chars)');
        }).catch(function() {
            /* no canvas saved yet for this note */
        });
    });
    return Promise.all(promises).then(function() {
        /* If total data is too large for the response, strip canvas data */
        var total = JSON.stringify(notes).length;
        console.log('Total notes data size: ' + total);
        if (total > 20000) {
            console.log('Data too large, stripping canvas data');
            notes.forEach(function(n) { delete n.canvasData; });
        }
        return notes;
    });
}

// ══════════════════════════════════════════════
// ── LWA Token for DataStore ──
// ══════════════════════════════════════════════
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

    return new Promise(function(resolve) {
        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(body).access_token);
                } else {
                    console.log('LWA error: ' + res.statusCode + ' ' + body);
                    resolve(null);
                }
            });
        });
        req.on('error', function(err) { console.log('LWA error: ' + err.message); resolve(null); });
        req.write(postData);
        req.end();
    });
}

function updateDataStore(deviceId, showBell) {
    return getLwaToken().then(function(token) {
        if (!token) return 401;

        var payload = JSON.stringify({
            commands: [{ type: 'PUT_OBJECT', namespace: 'quickStickies', key: 'alertState', content: { showBell: showBell } }],
            target: { type: 'DEVICES', items: [deviceId] }
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
                    console.log('DataStore: ' + res.statusCode + ' ' + body);
                    resolve(res.statusCode);
                });
            });
            req.on('error', function(err) { console.log('DataStore error: ' + err.message); resolve(500); });
            req.write(payload);
            req.end();
        });
    });
}

// ── Track alert state ──
var alertState = false;

// ══════════════════════════════════════════════
// ── Start the HTML Web App ──
// ══════════════════════════════════════════════
function startWebApp(handlerInput) {
    console.log('Launching Quick Stickies Web App...');

    var htmlSupported = Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.HTML'];
    if (!htmlSupported) {
        return handlerInput.responseBuilder
            .speak('Sorry, Quick Stickies requires a screen device with web support.')
            .getResponse();
    }

    var userId = getUserId(handlerInput);

    return loadNotesFromS3(userId).then(function(savedNotes) {
        return loadCanvasData(userId, savedNotes);
    }).then(function(notesWithCanvas) {
        var startDirective = {
            type: 'Alexa.Presentation.HTML.Start',
            data: {
                appName: 'Quick Stickies',
                alertOn: alertState,
                notes: notesWithCanvas
            },
            request: {
                uri: 'https://jjgithu.github.io/sticky-notes/web/index.html?v=5',
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
    });
}

// ── Voice launch ──
var LaunchRequestHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle: function(handlerInput) {
        console.log('Voice Launch → HTML App');
        return startWebApp(handlerInput);
    }
};

// ── Widget tap ──
var UserEventHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    handle: function(handlerInput) {
        console.log('Widget Tap → HTML App');
        return startWebApp(handlerInput);
    }
};

// ══════════════════════════════════════════════
// ── Handle messages from HTML web app ──
// ══════════════════════════════════════════════
var HtmlMessageHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.HTML.Message';
    },
    handle: function(handlerInput) {
        var msg = handlerInput.requestEnvelope.request.message || {};
        console.log('HTML Message type: ' + msg.type);

        // ── Save notes ──
        if (msg.type === 'saveNotes') {
            var userId = getUserId(handlerInput);
            var notes = msg.notes || [];
            return saveNotesToS3(userId, notes).then(function() {
                return handlerInput.responseBuilder
                    .addDirective({
                        type: 'Alexa.Presentation.HTML.HandleMessage',
                        message: { type: 'saveResult', status: 'ok', count: notes.length }
                    })
                    .withShouldEndSession(undefined)
                    .getResponse();
            });
        }

        // ── Save canvas drawing ──
        if (msg.type === 'saveCanvas') {
            var userId = getUserId(handlerInput);
            return saveCanvasToS3(userId, msg.noteId, msg.data).then(function() {
                return handlerInput.responseBuilder
                    .addDirective({
                        type: 'Alexa.Presentation.HTML.HandleMessage',
                        message: { type: 'canvasSaved', noteId: msg.noteId }
                    })
                    .withShouldEndSession(undefined)
                    .getResponse();
            });
        }

        // ── Set alert ──
        if (msg.type === 'setAlert') {
            var showBell = !!msg.value;
            alertState = showBell;
            console.log('Setting alert to: ' + showBell);

            var sys = handlerInput.requestEnvelope.context.System;
            var deviceId = sys.device && sys.device.deviceId;

            if (!deviceId) {
                return handlerInput.responseBuilder
                    .addDirective({
                        type: 'Alexa.Presentation.HTML.HandleMessage',
                        message: { status: 'error', reason: 'no-device-id' }
                    })
                    .withShouldEndSession(undefined)
                    .getResponse();
            }

            return updateDataStore(deviceId, showBell).then(function(statusCode) {
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

// ── Widget lifecycle ──
var UsagesInstalledHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesInstalled';
    },
    handle: function(handlerInput) {
        console.log('Widget installed');
        var deviceId = handlerInput.requestEnvelope.context.System.device.deviceId;
        return updateDataStore(deviceId, false).then(function() {
            return handlerInput.responseBuilder.getResponse();
        });
    }
};

var UsagesRemovedHandler = {
    canHandle: function(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesRemoved';
    },
    handle: function(handlerInput) {
        console.log('Widget removed');
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
