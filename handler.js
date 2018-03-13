'use strict';

const request = require('request');
const rp = require('request-promise');
const querystring = require('querystring');
const moment = require('moment');
const moment_tz = require('moment-timezone');
// keep name as Promise for aws-cli
// https://aws.amazon.com/blogs/developer/support-for-promises-in-the-sdk/
const Promise = require('bluebird');
const chrono = require('chrono-node');

const ddb_tokens = process.env.DDB_TOKENS;
const ddb_sch_msg = process.env.DDB_SCH_MSG;

const message_err = 'Oops, Unable to schedule your message for ';
const message_err_validation = 'The message token could not be validated.';
const message_ack = 'Got it. "';
const message_ack_delim = '" on ';
const message_no_date = 'Hmm... I couldnt find a date in your message: ';
const date_format_log = 'ddd, MMM Do YYYY h:mma z';

const date_format_iso = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
const date_format_ymdh = 'YYYY-MM-DD[T]HH:';
const date_format_ymd = 'YYYY-MM-DD';

const tz = 'America/New_York';

const aws = require('aws-sdk');
aws.config.update({region: 'us-east-1'});
const ddb = new aws.DynamoDB();

const config = require('./config.json');
console.log('config.json', config);

const slack = require('./slack.json');
console.log('slack.json', slack);

const { WebClient } = require('@slack/client');



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
    callback(null, response);
};



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
    let payload = {};
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
    }
    console.log(payload);
    return payload;
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

        const clean_text = text.substring(0,last_date.index);

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



/*
    _id: -1 if validating a command
 */ 
const validate_payload = (_id, payload, callback) => {
    if(slack.token == payload.token) {
        console.log('Payload Token Validation Success', _id);
        return true;
    } else {
        console.log('Payload Token Validation Error', _id);
        if(callback) {
            let body = {};
            body.text = message_err_validation;
            send_response(body, callback);
        }
    }
    return false;
};



const persist_token = (team_id, channel_id, access_token, payload) => {

    const p_str = JSON.stringify(payload);
    const _id =         new Date().getTime();
    const _created =    new Date().getTime();
    const _updated =    new Date().getTime();
    const _state =      -1;

    let params = {
        TableName: ddb_tokens,
        Item: {
            'team_id' :         {S: String(team_id)},
            'channel_id' :      {S: String(channel_id)},
            'access_token' :    {S: String(access_token)},
            'payload' :         {S: String(p_str)},
            '_id' :             {S: String(_id)},
            '_created' :        {N: String(_created)},
            '_updated' :        {N: String(_updated)},
            '_state' :          {N: String(_state)}, 
        }
    };

    console.log('------');
    console.log(params);
    console.log('------');

    let p = ddb.putItem(params).promise();
    return p;
}



const query_token = (team_id, channel_id) => {

    var params = {
        TableName: ddb_tokens,
        ExpressionAttributeValues: {
            ':team_id' : {S: team_id},
            ':channel_id' : {S: channel_id},
        },
        KeyConditionExpression: 'team_id = :team_id AND channel_id = :channel_id',
    };

    console.log(params);

    let p = ddb.query(params).promise();
    return p;
};



const persist_scheduled_message = (date, payload) => {
    const ymd =         get_date_ymd(date)
    const iso_date =    get_date_iso(date);
    const team_id =     payload.team_id;
    const user_id =     payload.user_id;
    const channel_id =  payload.channel_id;
    const p_str =       JSON.stringify(payload);
    const _id =         new Date().getTime();
    const _created =    new Date().getTime();
    const _updated =    new Date().getTime();
    const _state =      -1;

    let params = {
        TableName: ddb_sch_msg,
        Item: {
            'ymd' :         {S: String(ymd)},
            'iso_date' :    {S: String(iso_date)},
            'team_id' :     {S: String(team_id)},
            'user_id' :     {S: String(user_id)},
            'channel_id' :  {S: String(channel_id)},
            'payload' :     {S: String(p_str)},
            '_id' :         {S: String(_id)},
            '_created' :    {N: String(_created)},
            '_updated' :    {N: String(_updated)},
            '_state' :      {N: String(_state)}, 
        }
    };

    console.log('------');
    console.log(params);
    console.log('------');

    let p = ddb.putItem(params).promise();
    return p;
}



const update_scheduled_message = (_id, ymd, iso_date) => {
    const _updated =    new Date().getTime();
    const _state =      0;

    let params = {
        TableName: ddb_sch_msg,
        Key: {
            'ymd' :         {S: String(ymd)},
            'iso_date' :    {S: String(iso_date)},
        },
        ExpressionAttributeNames: {
            '#i' :          '_id',
            '#s' :          '_state',
            '#u' :          '_updated',
        },
        ExpressionAttributeValues: {
            ':_id' :         {S: String(_id)},
            ':_updated' :    {N: String(_updated)},
            ':_state' :      {N: String(_state)}, 
        },
        UpdateExpression: 'set #s = :_state, #u = :_updated',
        ConditionExpression: '#i = :_id',
        ReturnValues: 'UPDATED_NEW',
    };

    console.log('------');
    console.log(params);
    console.log('------')   ;

    let p = ddb.updateItem(params).promise();
    return p;
}



const query_scheduled_messages = (date) => {
    const ymd =         get_date_ymd(date)
    const ymdh =        get_date_ymdh(date)
    const iso_date =    get_date_iso(date);

    var params = {
        TableName: ddb_sch_msg,
        ExpressionAttributeValues: {
            ':ymd':     {S: ymd},
            ':ymdh':    {S: ymdh},
        },
        KeyConditionExpression: 'ymd = :ymd AND begins_with(iso_date, :ymdh)',
    };

    console.log(params);

    let p = ddb.query(params).promise();
    return p;
};



const slack_post_message = (_id, ymd, iso_date, payload) => {
    const channel_id = payload.channel_id;
    const team_id = payload.team_id;

    const p = query_token(team_id, channel_id);
    p.then((data) => {
        const items = data['Items'];

        if(items.length > 0) {
            const item = items[0];

            const _tid = Number(item._id['S']);
            const _state = Number(item._state['N']);

            if(_state == -1) {
                const access_token = item.access_token['S'];
                const slack_web = new WebClient(access_token);
                const clean_text = payload.clean_text;

                let params = {
                    channel: channel_id,
                    text: clean_text,
                    as_user: true,
                };

                slack_web.chat.postMessage(params)
                .then((data) => {
                    if(data.ok) {
                        console.log('Post Message Sent: ', _id, data.ts);
                        update_scheduled_message(_id, ymd, iso_date)
                        .then((data) => {
                            console.log('Post Message Update Success', data);
                        })
                        .catch((err) => {
                            console.log('Post Message Update Error', err);
                        });
                    } else {
                        console.log('Post Message Slack Error', _id, data);
                    }
                })
                .catch((err) => {
                    console.log('Post Message Slack Error', _id, err);
                });
            } else {
                console.log('Post Message Access token Inactive: ', _tid, team_id, channel_id);
            }
        } else {
            console.log('Post Message No access tokens found for: ', _id, team_id, channel_id);
        }
    })
    .catch((err) => {
        console.log('Post Message Query Token Error', _id, err);
    });
};



module.exports.scheduled_event = (event, context, callback) => {
    const body = {};

    const now =new Date();
    let p = query_scheduled_messages(now);

    p.then((data) => {
        const items = data['Items'];
        console.log('Query Payloads Success', items.length);
        for(var ea in items) {
            const item = items[ea];

            const ymd = item.ymd['S'];
            const iso_date = item.iso_date['S'];
            const _state = Number(item._state['N']);
            const _id = item._id['S'];

            const now = new Date();
            const iso = new Date(iso_date);

            console.log('iso', iso, '<', 'now', now);

            if( _state == -1 && iso.getTime() < now.getTime()) {
                let _payload = item.payload['S'];
                let payload = JSON.parse(_payload);
                console.log(payload);
                if(validate_payload(_id, payload)) {
                    slack_post_message(_id, ymd, iso_date, payload);
                }
            } else {
                console.log('Skipped Message ', _id, _state);
            }
        }
        send_response(body, callback);
    }).catch((err) => {
        console.log('Query Payloads Error', err);
        send_response(body, callback);
    });

};



module.exports.slack_command = (event, context, callback) => {
    const payload = get_payload(event);

    let body = {};
    //body.response_type = 'in_channel';
    body.response_type = 'ephemeral';

    let text = payload.text;
    const [d, clean_text] = parse_date(text);

    if(d != undefined) {
        const d_str = get_date_formatted(d);
        payload.clean_text = clean_text;

        if(validate_payload(-1, payload, callback)) {
            let p = persist_scheduled_message(d, payload);

            p.then((data) => {
                console.log('Success', data);
                body.text = message_ack + clean_text + message_ack_delim + d_str;
                send_response(body, callback);
            }).catch((err) => {
                console.log('Error', err);
                body.text = message_err + d_str;
                send_response(body, callback);
            });
        }
    } else {
        console.log('No date found');
        body.text = message_no_date + text;
        send_response(body, callback);
    }
};



module.exports.slack_event = (event, context, callback) => {
    const payload = get_payload(event);

    let body = {};
    let type = payload.type;
    if(type == 'url_verification') {
        body.challenge = payload.challenge;
    }

    send_response(body, callback);
};



/*
    Oauth Request (get)
    - code

    Oauth Response (json)

    - access_token
    - scope
    - user_id
    - team_name
    - team_id
    - incoming_webhook
        - channel
        - channel_id
        - configuration_url
        - url
    - bot
        - bot_user_id
        - bot_access_token
*/

module.exports.slack_redirect = (event, context, callback) => {
    let body = {};

    const qs = event.queryStringParameters;
    if(qs && qs.code) {
        const code = qs.code;

        let options = {
            uri: config.oauth_url,
            qs: {
                client_id: slack.client_id,
                client_secret: slack.client_secret,
                code: code,
            },
            json: true,
        }

        console.log(options);

        rp(options)
            .then((data) => {
                if(data.ok) {
                    console.log('Oauth Success');
                    console.log(data);
                    const team_id = data.team_id;
                    const access_token = data.access_token;
                    const channel_id = data.incoming_webhook.channel_id;
                    const p = persist_token(team_id, channel_id, access_token, data);
                    p.then((data) => {
                        console.log('Oauth Persist Success', data);
                        redirect_response(slack.installed_url, callback);
                    })
                    .catch((err) => {
                        console.log('Oauth Persist Error', err);
                        body.message = 'Oauth Persist error';
                        send_response(body, callback);
                    });
                } else {
                    body.message = 'Oauth Error: ' + data.error;
                    console.log(body.message);
                    console.log(data);
                    send_response(body, callback);
                }
            })
            .catch((err) => {
                body.message = 'Oauth Error: ' + err;
                console.log(body.message);
                send_response(body, callback);
            });
    } else {
        body.message = 'No code in query string parameters.';
        console.log(body.message);
        send_response(body, callback);
    }

};
