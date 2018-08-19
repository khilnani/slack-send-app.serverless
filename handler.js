'use strict';

// ----------------------------------------------------------
// Libs
// ----------------------------------------------------------

/*
   id=ymd
   _id=id
   message_id=date_id
   */

const request = require('request');
const rp = require('request-promise');
const querystring = require('querystring');
const moment = require('moment');
const moment_tz = require('moment-timezone');
// keep name as Promise for aws-cli
// https://aws.amazon.com/blogs/developer/support-for-promises-in-the-sdk/
//const Promise = require('bluebird');
const chrono = require('chrono-node');
const shortid = require('shortid');

const ddb_tokens = process.env.DDB_TOKENS;
const ddb_messages = process.env.DDB_MESSAGES;

const config = require('./config.json');
console.log('config.json', config);

const slack = require('./slack.json');
console.log('slack.json', slack);

// ----------------------------------------------------------
// Globals
// ----------------------------------------------------------

const message_err = 'Oops, We hit an expected error. Please try again.';
const message_err_validation = 'The message token could not be validated.';

const message_err_missing_text = 'Hmm... Did you forget to type a message?\n\nYou could also try:\n\n- */slist [inline]* or */send list [inline]*\nList unsent messages.\n_inline_ prints in the channel for everyone to see.\n\n- */sdelete ID* or */send delete ID*\nDelete a message';
const message_err_missing_id = 'Hmm... I don\'t think you sent an ID.';
const message_err_no_message = 'Oops, We found a date but no message: ';
const message_err_no_date = 'Hmm... I couldn\'t find a date in your message: ';
const message_err_missing_token = 'You might need to authorize the app to post messages on your behalf. Please visit ' + slack.install_url;

const message_ack = 'Got it. Scheduled the message: ';
const message_ack_delim = '" on ';

const date_format_log = 'ddd, MMM Do YYYY h:mma z';
const date_format_iso = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
const date_format_ymdh = 'YYYY-MM-DD[T]HH:';
const date_format_ymd = 'YYYY-MM-DD';

const tz = 'America/New_York';

// ----------------------------------------------------------
// Init stuff
// ----------------------------------------------------------

shortid.characters('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-.');

const aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
const ddb = new aws.DynamoDB();

const { WebClient } = require('@slack/client');



// ----------------------------------------------------------
// Utils
// ----------------------------------------------------------

const new_id = () => {
    const ts = new Date().getTime();
    shortid.seed(ts);
    const id = shortid.generate()
        console.log('new_id', id);
    return id;
}



/*
   e.g. 'America/New_York'
   e.g. 'Asia/Kolkata'
   */
const get_tz_offset = (name) => {
    const zone = moment_tz.tz.zone(name);
    const offset = -1 * zone.utcOffset(new Date().getTime());
    return offset;
};



const send_response = (body, callback) => {
    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': "application/json",
        },
        body: JSON.stringify(body),
    };
    console.log('Response: ', response);
    callback(null, response);
};



const redirect_response = (url, callback) => {
    const response = {
        statusCode: 301,
        headers: {
            Location: url
        },
        body: '',
    };
    console.log('Response: ', response);
    callback(null, response);
};



const get_date_formatted = (date) => {
    let formatted_date = moment_tz.tz(date, tz).format(date_format_log);
    return formatted_date;
};



const get_date_iso = (date) => {
    const tz_offset = get_tz_offset(tz);
    const date_moment = moment(date).utcOffset(tz_offset);
    console.log('Date (iso moment): ' + date_moment.calendar());

    const d1 = date_moment.toISOString();
    console.log('Date (iso1): ' + d1);

    const d2 = moment.utc(date_moment).format(date_format_iso);
    console.log('Date (iso2): ' + d2);

    return d1;
};



const get_date_ymd = (date) => {
    const tz_offset = get_tz_offset(tz);
    const date_moment = moment(date).utcOffset(tz_offset);
    console.log('Date (ymd moment): ' + date_moment.calendar());

    const d = moment.utc(date_moment).format(date_format_ymd);
    console.log('Date (ymd): ' + d);

    return d;
};



const get_date_ymdh = (date) => {
    const tz_offset = get_tz_offset(tz);
    const date_moment = moment(date).utcOffset(tz_offset);
    console.log('Date (ymdh moment): ' + date_moment.calendar());

    const d = moment.utc(date_moment).format(date_format_ymdh);
    console.log('Date (ymdh): ' + d);

    return d;
};



const parse_date = (text) => {
    const tz_offset = get_tz_offset(tz);
    const dates = chrono.parse(text, moment().utcOffset(tz_offset));

    if(dates.length > 0) {
        const last_date = dates[dates.length-1];

        const clean_text = text.substring(0,last_date.index).trim();

        const last_date_start = last_date.start;
        last_date_start.assign('timezoneOffset', tz_offset);
        const date = last_date_start.date();
        // console.log(date);
        // const offset = new Date().getTimezoneOffset();
        // console.log(offset);
        // console.log(moment.tz.guess());
        get_date_iso(date);
        console.log('Date (formatted): ' + get_date_formatted(date));

        return [date, clean_text];
    }

    return [undefined, undefined];
};



// ----------------------------------------------------------
// Slack Utils
// ----------------------------------------------------------

/*
   Example event payload from slack slash command
   Could be url encoded, or json

   - token
   - team_id
   - team_domain
   - channel_id
   - channel_name
   - user_id
   - user_name
   - command
   - text
   */

const get_payload = (event) => {
    let payload = undefined;
    const body = event.body;
    if(event.headers) {
        const ct = event.headers['Content-Type'];
        if(ct == 'application/x-www-form-urlencoded') {
            console.log('form-urlencoded');
            payload = querystring.parse(body);
        } else if(ct == 'application/json') {
            console.log('json');
            payload = JSON.parse(body);
        } else {
            console.log('No Content-Type specified.');
        }
    } else {
        console.log('No Headers specified.');
        console.log(event)
    }
    console.log(payload);
    return payload;
};



/*
   _id: -1 if validating a command
   */
const validate_payload = (id, payload, callback) => {
    if(payload && slack.token == payload.token) {
        console.log('Payload Token Validation Success', id);
        return true;
    } else {
        console.log('Payload Token Validation Error', id);
        if(callback) {
            let body = {};
            body.text = message_err_validation;
            send_response(body, callback);
        }
    }
    return false;
};



// ----------------------------------------------------------
// Data
// ----------------------------------------------------------




const query_token = (team_id, user_id) => {

    if(ddb_tokens) {
        var params = {
            TableName: ddb_tokens,
            ExpressionAttributeValues: {
                ':team_id' : {S: team_id},
                ':user_id' : {S: user_id},
            },
            KeyConditionExpression: 'team_id = :team_id AND user_id = :user_id',
        };

        //    console.log(params);

        let p = ddb.query(params).promise();
        return p;
    }

    return new Promise((resolve, reject) => {
        console.log('WARNING: Skipping token validation: ddb_tokens undefined');
        resolve();
    });
};



const check_token = (team_id, user_id) => {
    console.log('Check Token', team_id, user_id);

    return new Promise((resolve, reject) => {
        const p = query_token(team_id, user_id);
        p.then((data) => {
            const items = data['Items'];

            if(items.length > 0) {
                const item = items[0];

                const tid = Number(item.id['S']);
                const state = Number(item.state['N']);

                if(state == -1) {
                    const access_token = item.access_token['S'];
                    resolve(access_token);
                } else {
                    console.log('Check Token Inactive', team_id, user_id);
                    resolve();
                }
            } else {
                console.log('Check Token Missing', team_id, user_id);
                resolve();
            }
        }).catch((err) => {
            console.log('Check Token Error', team_id, user_id, err);
            reject();
        });
    });
}



const persist_scheduled_message = (date, payload) => {
    const team_id =     payload.team_id;
    const user_id =     payload.user_id;

    const id =          new_id();
    const created =     new Date().getTime();
    const updated =     new Date().getTime();
    const state =       -1;

    const ymd =         get_date_ymd(date);
    const date_id =     get_date_iso(date) + ',' + id;
    const iso_date =    get_date_iso(date);
    const channel_id =  payload.channel_id;
    const p_str =       JSON.stringify(payload);

    let params = {
        TableName: ddb_messages,
        Key: {
            'ymd' :         {S: String(ymd)},
            'date_id' :     {S: String(date_id)},
        },
        ExpressionAttributeNames: {
            '#s' :          'state',
        },
        ExpressionAttributeValues: {
            ':iso_date' :    {S: String(iso_date)},
            ':team_id' :     {S: String(team_id)},
            ':user_id' :     {S: String(user_id)},
            ':channel_id' :  {S: String(channel_id)},
            ':payload' :     {S: String(p_str)},
            ':id' :          {S: String(id)},
            ':created' :     {N: String(created)},
            ':updated' :     {N: String(updated)},
            ':state' :       {N: String(state)},
        },
        UpdateExpression: 'set iso_date = :iso_date, team_id = :team_id, user_id = :user_id, channel_id = :channel_id, payload = :payload, id = :id, created = :created, updated = :updated, #s = :state',
        ReturnValues: 'UPDATED_NEW',
    };

    console.log('persist_scheduled_message', params);

    let p = ddb.updateItem(params).promise();
    return p;
}



const update_scheduled_message = (id, ymd, date_id) => {
    const updated =    new Date().getTime();
    const state =      0;

    let params = {
        TableName: ddb_messages,
        Key: {
            'ymd' :         {S: String(ymd)},
            'date_id' :     {S: String(date_id)},
        },
        ExpressionAttributeNames: {
            '#i' :          'id',
            '#s' :          'state',
            '#u' :          'updated',
        },
        ExpressionAttributeValues: {
            ':id' :          {S: String(id)},
            ':updated' :     {N: String(updated)},
            ':state' :       {N: String(state)},
        },
        UpdateExpression: 'set #s = :state, #u = :updated',
        ReturnValues: 'UPDATED_NEW',
    };

    console.log('update_scheduled_message', params);

    let p = ddb.updateItem(params).promise();
    return p;
}



const delete_scheduled_message = (ymd, date_id) => {

    let params = {
        TableName: ddb_messages,
        Key: {
            'ymd' :          {S: String(ymd)},
            'date_id' :      {S: String(date_id)},
        },
        ReturnValues: 'ALL_OLD',
    };

    //    console.log(params);

    let p = ddb.deleteItem(params).promise();
    return p;
}


const query_scheduled_messages_by_id = (team_id, user_id, id) => {
    var params = {
        TableName: ddb_messages,
        IndexName: 'team_id_index',
        ExpressionAttributeValues: {
            ':team_id':     {S: team_id},
            ':id':         {S: id},
            ':user_id':     {S: user_id},
        },
        ExpressionAttributeNames: {
            '#id' :          'id',
        },
        KeyConditionExpression: 'team_id = :team_id AND #id = :id',
        FilterExpression: 'user_id = :user_id'
    };

    //    console.log(params);

    let p = ddb.query(params).promise();
    return p;
};



const query_scheduled_messages_by_user = (team_id, user_id) => {
    var params = {
        TableName: ddb_messages,
        IndexName: 'team_user_index',
        ExpressionAttributeValues: {
            ':team_id':     {S: team_id},
            ':user_id':     {S: user_id},
        },
        KeyConditionExpression: 'team_id = :team_id AND user_id = :user_id',
    };

    //    console.log(params);

    let p = ddb.query(params).promise();
    return p;
};



const query_scheduled_messages_by_date = (date) => {
    const ymd =        get_date_ymd(date);
    const state =      '-1';

    var params = {
        TableName: ddb_messages,
        ExpressionAttributeValues: {
            ':ymd':     {S: ymd},
        },
        KeyConditionExpression: 'ymd = :ymd AND begins_with(date_id, :ymd)',
    };

    //    console.log(params);

    let p = ddb.query(params).promise();
    return p;
};



// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

const send_message_helper = (team_id, user_id, payload, text, body, callback) => {
    console.log('send_message_helper()')
    console.log(team_id, user_id, text)
    body.response_type = 'ephemeral';

    const [d, clean_text] = parse_date(text);

    if(d != undefined) {
        const d_str = get_date_formatted(d);
        payload.clean_text = clean_text;

        if(clean_text.length > 0) {
            if(validate_payload(-1, payload, callback)) {
                const p = check_token(team_id, user_id);
                p.then((access_token) => {
                    if(access_token) {
                        let p2 = persist_scheduled_message(d, payload);
                        p2.then((data) => {
                            console.log('Command Send Success', data);
                            body.text = message_ack;
                            let a = {
                                'pretext': undefined,
                                'author_name':  'Channel: ' + payload.channel_name,
                                'title': d_str,
                                'text': payload.clean_text,
                                'footer': 'Message ID: ' + data['Attributes'].id['S'],
                                'mrkdwn_in': ['text', 'pretext'],
                            }
                            console.log(a);
                            body.attachments.push(a);
                            send_response(body, callback);
                        }).catch((err) => {
                            console.log('Command Send Persist Error', err);
                            body.text = message_err;
                            send_response(body, callback);
                        });
                    } else {
                        console.log('Command Send Token Missing', team_id, user_id);
                        body.text = message_err_missing_token;
                        send_response(body, callback);
                    }
                }).catch((err) => {
                    console.log('Command Send Token Error', err);
                    body.text = message_err;
                    send_response(body, callback);
                });
            }
        } else {
            console.log('Command Send No Message');
            body.text = message_err_no_message + text;
            send_response(body, callback);
        }
    } else {
        console.log('Command Send No date found');
        body.text = message_err_no_date;
        let a = {
            'pretext': undefined,
            'author_name':  'Channel: ' + payload.channel_name,
            'title': undefined,
            'text': payload.text,
            'footer': undefined,
            'mrkdwn_in': ['text', 'pretext'],
        }
        console.log(a);
        body.attachments.push(a);
        send_response(body, callback);
    }
};



const list_messages_helper = (team_id, user_id, body, callback) => {
    const p = query_scheduled_messages_by_user(team_id, user_id);
    p.then((data) => {
        //console.log(data);
        const items = data['Items'];
        if(items.length > 0) {
            body.text = 'Your messages:\n';
            body.attachments = [];
            for(var ea in items) {
                let item = items[ea];

                const date_id = item.date_id['S'];
                const iso_date = item.iso_date['S'];
                const state = Number(item.state['N']);
                const d = new Date(iso_date);
                const d_str = get_date_formatted(d);
                const id = item.id['S'];

                if( state == -1) {
                    let _payload = item.payload['S'];
                    let payload = JSON.parse(_payload);
                    if(validate_payload(id, payload)) {
                        let a = {
                            'pretext': undefined,
                            'author_name':  'Channel: ' + payload.channel_name,
                            'title': d_str,
                            'text': payload.clean_text,
                            'footer': 'Message ID: ' + id,
                            'mrkdwn_in': ['text', 'pretext'],
                            'callback_id': id,
                            'actions': [
                            {
                                'type': 'button',
                                'name': 'delete',
                                'text': 'Delete',
                                'confirm': {
                                    'title': 'Are you sure?',
                                    'text': "Click 'Okay' to delete message " + id,
                                },
                            },
                            ],
                        }
                        console.log(a);
                        body.attachments.push(a);
                    } else {
                        console.log('Command List Invalid Message', date_id);
                        body.text = 'Some of your messages did not have valid tokens.'
                    }
                } else {
                    console.log('Command List Skipped Message ', date_id, state);
                }

            }
        } else {
            body.text = 'You do not have any messages scheduled.';
        }
        send_response(body, callback);
    }).catch((err) => {
        body.text = 'Unable to get your scheduled messages.';
        console.log(body.text, err);
        send_response(body, callback);
    });
};



const delete_message_helper = (team_id, user_id, id_to_delete, body, callback) => {
    query_scheduled_messages_by_id(team_id, user_id, id_to_delete)
        .then((data) => {
            const items = data['Items'];
            if(items.length > 0) {
                const item = items[0];
                const ymd = item.ymd['S'];
                const date_id = item.date_id['S'];
                delete_scheduled_message(ymd, date_id)
            .then((data) => {
                console.log('Command Delete Success', data);
                body.text = 'Deleted message with ID: ' + id_to_delete;
                send_response(body, callback);
            })
        .catch((err) => {
            console.log('Command Delete Error', err);
            body.text = 'Unable to deleted message with ID: ' + id_to_delete;
            send_response(body, callback);
        });
            } else {
                console.log('Command Delete Query No Results', data);
                body.text = 'Unable to find message with ID: ' + id_to_delete;
                send_response(body, callback);
            }
        }).catch((err) => {
            console.log('Command Delete Query Error', err);
            body.text = 'We encountered an error while looking for message with ID: ' + id_to_delete;
            send_response(body, callback);
        });
};




// ----------------------------------------------------------
// Slack Interactions
// ----------------------------------------------------------

const slack_delete_message_callback = (url, text) => {

    let options = {
        method: 'POST',
        uri: url,
        body: {
            'response_type': 'ephemeral',
            'replace_original': false,
            'text': text,
        },
        json: true,
    }

    console.log(options);

    rp(options)
        .then((data) => {
            if(data.ok) {
                console.log('Slack Delete Message OK');
                console.log(data);
            } else {
                console.log('Slack Delete Message Not OK');
                console.log(data);
            }
        })
    .catch((err) => {
        console.log('Slack Delete Message Error');
        console.log(err);
    });

};



const slack_post_message = (id, ymd, date_id, payload) => {
    const team_id = payload.team_id;
    const user_id = payload.user_id;
    const channel_id = payload.channel_id;

    const p = check_token(team_id, user_id);
    p.then((access_token) => {
        if(access_token) {
            const slack_web = new WebClient(access_token);
            const clean_text = payload.clean_text;

            let params = {
                channel: channel_id,
                text: clean_text,
                as_user: true,
                link_names: true,
                parse: 'full',
                reply_broadcast: true,
                thread_ts: undefined,
            };

            slack_web.chat.postMessage(params)
        .then((data) => {
            if(data.ok) {
                console.log('Post Message OK: ', id, data.ts);
                delete_scheduled_message(ymd, date_id)
            .then((data) => {
                console.log('Post Message Delete Success', data);
            })
        .catch((err) => {
            console.log('Post Message Delete Error', err);
        });
            } else {
                console.log('Post Message Not OK', id, data);
            }
        })
    .catch((err) => {
        console.log('Post Message Slack Error', id, err);
    });
        } else {
            console.log('Post Message Query Token Missing', team_id, user_id);
        }
    })
    .catch((err) => {
        console.log('Post Message Query Token Error', id, err);
    });
};



// ----------------------------------------------------------
// Lambda Handlers
// ----------------------------------------------------------

module.exports.scheduled_event = (event, context, callback) => {
    const body = {};

    const now =new Date();
    let p = query_scheduled_messages_by_date(now);

    p.then((data) => {
        const items = data['Items'];
        console.log('Query Payload  Success', items.length);
        for(var ea in items) {
            const item = items[ea];

            const ymd = item.ymd['S'];
            const date_id = item.date_id['S'];
            const iso_date = item.iso_date['S'];
            const state = Number(item.state['N']);
            const id = item.id['S'];

            const now = new Date();
            const iso = new Date(iso_date);

            console.log(id, state, 'iso', iso, '<=', 'now', now);

            if( state == -1 && iso.getTime() <= now.getTime()) {
                let _payload = item.payload['S'];
                let payload = JSON.parse(_payload);
                console.log(payload);
                if(validate_payload(id, payload)) {
                    slack_post_message(id, ymd, date_id, payload);
                }
            } else {
                console.log('Query Payload Skipped Message ', id, state);
            }
        }
        send_response(body, callback);
    }).catch((err) => {
        console.log('Query Payload Error', err);
        send_response(body, callback);
    });

};



/*
   Example event payload from slack slash command
   Could be url encoded, or json

{
    token: '',
    team_id: 'T...',
    team_domain: '',
    channel_id: 'G...',
    channel_name: 'privategroup',
    user_id: 'U...',
    user_name: 'handle',
    command: '/send',
    text: '...',
    response_url: 'https://hooks.slack.com/commands/T.../419428273693/nTYEYEIIgshshebsnsjhrxNp',
    trigger_id: '420647602022.2371913449.70dhshshshsdbshwhshansh329ef62e'
}


   */

module.exports.slack_command = (event, context, callback) => {
    const payload = get_payload(event);
    let body = {};
    body.response_type = 'ephemeral';

    if(payload) {

        body.attachments = [];
        //body.response_type = 'in_channel';
        body.response_type = 'ephemeral';

        let date_id = undefined;
        let text = (payload.text) ? payload.text.trim() : '';

        const command = payload.command;
        let _tokens = text.split(' ');
        const command2 = (_tokens.length >= 1) ? _tokens[0].toLowerCase() : '';
        const command3 = (_tokens.length >= 2) ? _tokens[1] : undefined;

        const team_id = payload.team_id;
        const user_id = payload.user_id;

        console.log('Slack Command: ', command, command2, command3);

        // command, command2, command3
        // team_id, user_id, payload, text, body, callback

        if(command == '/slist' || (command == '/send' && command2 == 'list')) {
            // list
            // check if inline
            if(text == 'inline' || (command2 == 'list' && command3 && command3.toLowerCase() == 'inline')) {
                body.response_type = 'in_channel';
            }
            list_messages_helper(team_id, user_id, body, callback);
        } else if(command == '/sdelete' || (command == '/send' && command2 == 'delete')) {
            // delete
            // check if an ID is sent
            if(text.trim().length == 0) {
                console.log('Command Delete Missing ID');
                body.text = message_err_missing_id;
                send_response(body, callback);
            } else {
                let id_to_delete = text;
                // support /send delete id
                if(command2 == 'delete' && command3) {
                    id_to_delete = command3;
                }
                delete_message_helper(team_id, user_id, id_to_delete, body, callback);
            }
        } else if(command == '/send') {
            // if no text or no 'help' text
            if(text.length == 0 || command2 == 'help') {
                console.log('Command Send Missing text');
                body.text = message_err_missing_text;
                send_response(body, callback);
            } else {
                send_message_helper(team_id, user_id, payload, text, body, callback);
            }
        }
    } else {
        send_response(body, callback);
    }
};



module.exports.slack_actions = (event, context, callback) => {
    let body = {};
    if( get_payload(event) ) {
        const payload = JSON.parse(get_payload(event).payload);
        console.log(payload);

        if(validate_payload(-1, payload, callback)) {
            const id_to_delete = payload.callback_id;
            const team_id = payload.team.id;
            const user_id = payload.user.id;
            const response_url = payload.response_url;


            let _callback = (_null, response) => {
                const text = JSON.parse(response.body).text;
                slack_delete_message_callback(response_url, text);
            };

            delete_message_helper(team_id, user_id, id_to_delete, {}, _callback);

            body.text = "Working on it ...";
            send_response(body, callback);
        }
    } else {
        send_response(body, callback);
    }
};



module.exports.slack_options = (event, context, callback) => {
    let body = {};
    if( get_payload(event) ) {
        const payload = JSON.parse(get_payload(event).payload);
        console.log(payload);

        if(validate_payload(-1, payload, callback)) {
            send_response(body, callback);
        }
    } else {
        send_response(body, callback);
    }
};


/*

{
    token: '',
    team_id: 'T...',
    api_app_id: 'A...',
    event:
    {
        type: 'app_mention',
        user: 'U...',
        text: '<@U...> text',
        client_msg_id: '',
        thread_ts: '1534714829.000100',
        parent_user_id: 'U...',
        ts: '1534716553.000100',
        channel: 'G...',
        event_ts: '1534716553.000100'
     },
    type: 'event_callback',
    event_id: 'EE...',
    event_time: 1534716553,
    authed_users: [ 'U...' ]
  }


*/
module.exports.slack_events = (event, context, callback) => {
    const payload = get_payload(event);

    let body = {};
    if(validate_payload(-1, payload, callback)) {
        let type = payload.type;
        if(type == 'url_verification') {
            body.challenge = payload.challenge;
            console.log('Event:challange');
        } else if (type == 'event_callback') {
            console.log('Event: Callback' + payload['event']['text'])
        }
        send_response(body, callback);
    }
};


