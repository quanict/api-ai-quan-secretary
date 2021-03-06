'use strict';

const apiai = require("apiai");
const express = require("express");
const bodyParser = require("body-parser");
const uuid = require("uuid");
const axios = require('axios');

//Import Config file
const config = require("./config");

const app = express();
//setting Port
app.set("port", process.env.PORT || 3000);

//serve static files in the public directory
app.use(express.static("public"));

// Process application/x-www-form-urlencoded
app.use(
    bodyParser.urlencoded({
        extended: false
    })
);

// Process application/json
app.use(bodyParser.json());

// Index route
app.get("/", function (req, res) {
    res.send("Hello world, I am a chat bot");
});

// for Facebook verification
app.get("/webhook/", function (req, res) {
    console.log("request");
    if (
        req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === config.FB_VERIFY_TOKEN
    ) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});

// Spin up the server
app.listen(app.get("port"), function () {
    console.log("Magic Started on port", app.get("port"));
});

const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
    language: "en",
    requestSource: "fb"
});
const sessionIds = new Map();

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post("/api-ai/", function (req, res) {
    var data = req.body;
    // Make sure this is a page subscription
    console.log('debug webhook',data);
    if (data.object === "page") {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ",messagingEvent);
                }
            });
        });
        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});

function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;

    if (messageText) {
        //send message to api.ai
        sendToApiAi(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}

function sendToApiAi(sender, text) {
    sendTypingOn(sender);
    let apiaiRequest = apiAiService.textRequest(text, {
        sessionId: sessionIds.get(sender)
    });

    apiaiRequest.on("response", response => {
        if (isDefined(response.result)) {
            handleApiAiResponse(sender, response);
        }
    });

    apiaiRequest.on("error", error => console.error(error));
    apiaiRequest.end();
}

/*
 * Turn typing indicator on
 *
 */
const sendTypingOn = (recipientId) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };
    callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
const callSendAPI = async (messageData) => {

    const url = "https://graph.facebook.com/v3.0/me/messages?access_token=" + config.FB_PAGE_TOKEN;
    await axios.post(url, messageData)
        .then(function (response) {
            if (response.status === 200) {
                var recipientId = response.data.recipient_id;
                var messageId = response.data.message_id;
                if (messageId) {
                    console.log(
                        "Successfully sent message with id %s to recipient %s",
                        messageId,
                        recipientId
                    );
                } else {
                    console.log( "Successfully called Send API for recipient %s", recipientId );
                }
            }
        })
        .catch(function (error) {
            console.log(error.response.headers);
        })
};

function handleApiAiResponse(sender, response) {
    let responseText = response.result.fulfillment.speech;
    let responseData = response.result.fulfillment.data;
    let messages = response.result.fulfillment.messages;
    let action = response.result.action;
    let contexts = response.result.contexts;
    let parameters = response.result.parameters;

    sendTypingOff(sender);

    if (responseText == "" && !isDefined(action)) {
        //api ai could not evaluate input.
        console.log("Unknown query" + response.result.resolvedQuery);
        sendTextMessage(
            sender,
            "I'm not sure what you want. Can you be more specific?"
        );
    } else if (isDefined(action)) {
        handleApiAiAction(sender, action, responseText, contexts, parameters);
    } else if (isDefined(responseData) && isDefined(responseData.facebook)) {
        try {
            console.log("Response as formatted message" + responseData.facebook);
            sendTextMessage(sender, responseData.facebook);
        } catch (err) {
            sendTextMessage(sender, err.message);
        }
    } else if (isDefined(responseText)) {
        sendTextMessage(sender, responseText);
    }
}

/*
 * Turn typing indicator off
 *
 */
const sendTypingOff = (recipientId) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

const sendTextMessage = async (recipientId, text) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    };
    await callSendAPI(messageData);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
    switch (action) {
        case "send-text":
            var responseText = "This is example of Text message."
            sendTextMessage(sender, responseText);
            break;


        case "fb-send-image":
            var imgUrl = "https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/881e6651881085.58fd911b65d88.png";
            sendImageMessage(sender, imgUrl);
            break;

        case "send-video":
            const messageData = [
                {
                    "media_type": "video",
                    "url": "https://www.facebook.com/FacebookIndia/videos/1772075119516020/",
                    "buttons": [
                        {
                            "type": "web_url",
                            "url": "https://f1948e04.ngrok.io",
                            "title": "View Website",
                        }
                    ]
                }
            ];
            sendVideoMessage(sender, messageData);
            break;

        case "send-quick-reply":
            var responseText = "Choose the options"
            var replies = [{
                "content_type": "text",
                "title": "Example 1",
                "payload": "Example 1",
            },
                {
                    "content_type": "text",
                    "title": "Example 2",
                    "payload": "Example 2",
                },
                {
                    "content_type": "text",
                    "title": "Example 3",
                    "payload": "Example 3",
                }];
            sendQuickReply(sender, responseText, replies)
            break;
        case "send-carousel" :
            const elements = [{
                "title": "Welcome!",
                "subtitle": "We have the right hat for everyone.We have the right hat for everyone.We have the right hat for everyone.",
                "imageUrl": "https://www.stepforwardmichigan.org/wp-content/uploads/2017/03/step-foward-fb-1200x628-house.jpg",
                "buttons": [
                    {
                        "postback": "https://f1948e04.ngrok.io",
                        "text": "View Website"
                    }, {
                        "text": "Start Chatting",
                        "postback": "PAYLOAD EXAMPLE"
                    }
                ]
            }, {
                "title": "Welcome!",
                "imageUrl": "https://www.stepforwardmichigan.org/wp-content/uploads/2017/03/step-foward-fb-1200x628-house.jpg",
                "subtitle": "We have the right hat for everyone.We have the right hat for everyone.We have the right hat for everyone.",
                "buttons": [
                    {
                        "postback": "https://f1948e04.ngrok.io",
                        "text": "View Website"
                    }, {
                        "text": "Start Chatting",
                        "postback": "PAYLOAD EXAMPLE"
                    }
                ]
            },{
                "title": "Welcome!",
                "imageUrl": "https://www.stepforwardmichigan.org/wp-content/uploads/2017/03/step-foward-fb-1200x628-house.jpg",
                "subtitle": "We have the right hat for everyone.We have the right hat for everyone.We have the right hat for everyone.",
                "buttons": [
                    {
                        "postback": "https://f1948e04.ngrok.io",
                        "text": "View Website"
                    }, {
                        "text": "Start Chatting",
                        "postback": "PAYLOAD EXAMPLE"
                    }
                ]
            }];
            handleCardMessages(elements, sender)
            break;
        default:
            //unhandled action, just send back the text
            sendTextMessage(sender, responseText);
    }
}
const sendImageMessage = async (recipientId, imageUrl) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };
    await callSendAPI(messageData);
};

const sendVideoMessage = async (recipientId, elements) => {
    const messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "media",
                    elements: elements
                }
            }
        }
    };
    await callSendAPI(messageData)
};

const sendQuickReply = async (recipientId, text, replies, metadata) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata) ? metadata : "",
            quick_replies: replies
        }
    };
    await callSendAPI(messageData);
};

async function handleCardMessages(messages, sender) {
    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.buttons.length; b++) {
            let isLink = message.buttons[b].postback.substring(0, 4) === "http";
            let button;
            if (isLink) {
                button = {
                    type: "web_url",
                    title: message.buttons[b].text,
                    url: message.buttons[b].postback
                };
            } else {
                button = {
                    type: "postback",
                    title: message.buttons[b].text,
                    payload: message.buttons[b].postback
                };
            }
            buttons.push(button);
        }
        let element = {
            title: message.title,
            image_url: message.imageUrl,
            subtitle: message.subtitle,
            buttons: buttons
        };
        elements.push(element);
    }
    await sendGenericMessage(sender, elements);
}

const sendGenericMessage = async (recipientId, elements) => {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };
    await callSendAPI(messageData);
}