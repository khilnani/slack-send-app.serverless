'use strict';

const querystring = require('querystring');
const moment = require('moment');
const moment_tz = require('moment-timezone');
const chrono = require('chrono-node');


const default_ack_message= 'Got it. Will send your message on ';
const default_date_format = 'ddd, MMM Do YYYY h:mma z';
const default_tz = 'America/New_York';
const default_tz_offset = -5*60;

const get_payload = (event) => {
    let payload = {};
    const body = event.body;
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
    console.log(payload);
    return payload;
};

const format_date = (date) => {
    let formatted_date = moment_tz.tz(date, default_tz).format(default_date_format);
    return formatted_date;
};

const get_date = (text) => {
    const dates = chrono.parse(text, moment().utcOffset(default_tz_offset));
    const last_date_chrono = dates[dates.length-1].start;
    last_date_chrono.assign('timezoneOffset', default_tz_offset);
    const last_date = last_date_chrono.date();
    const last_date_moment = moment(last_date).utcOffset(default_tz_offset);
    // console.log(last_date);
    // const offset = new Date().getTimezoneOffset();
    // console.log(offset);
    // console.log(moment.tz.guess());
    console.log('Date (moment): ' + last_date_moment.calendar());
    console.log('Date (ISO): ' + last_date_moment.toISOString());
    console.log('Date (formatted): ' + format_date(last_date));

    return last_date;
};


module.exports.scheduled_event = (event, context, callback) => {
  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Go Serverless v1.0! Your function executed successfully!',
      input: event,
    }),
  };

  callback(null, response);
};



module.exports.slack_command = (event, context, callback) => {
    let payload = get_payload(event);

    let text = payload.text;
    const d = get_date(text);
    const d_str = format_date(d);

    let body = {};
    body.text = default_ack_message + d_str;

    const response = {
        statusCode: 200,
        headers: {
           'Content-Type': "application/json",
        },
        body: JSON.stringify(body),
    };

    callback(null, response);
};



module.exports.slack_event = (event, context, callback) => {
    let payload = get_payload(event);

    let body = {};
    let type = payload.type;
    if(type == 'url_verification') {
        body.challenge = payload.challenge;
    }

    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': "application/json",
        },
        body: JSON.stringify(body),
    };

    callback(null, response);
};
