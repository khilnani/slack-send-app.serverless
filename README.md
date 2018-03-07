# slack-send-messages-app.serverless

> Send Slack messages on your own terms.

## Setup

OK, lets get started. There are quite a few steps here and you may need 30 mins to 1 hour depending on your familiarity with AWS. 

*Note*

- The default setup will create a public API endpoint. Take a look at the *Private API Setup* section to make the API private. 
- The project has been tested on Ubuntu, macOS as well as Bash on Windows 10, with and without Docker.

## AWS Setup

Since we're working with AWS Lambda and AWS API Gateway, we need to setup AWS credentials. 
We are also going to use the Serverless framework to manage the AWS tech stack.

> - The role Serverless needs requires a lot of privilages. 
> - The role used to setup and deploy is different from the permissions set on the lambda code that runs.
> - If this concerns you, create a new AWS account to play around with.

### Serverless AWS Credentials Setup

- Follow the instructions at https://serverless.com/framework/docs/providers/aws/guide/credentials/ . They cover the setup pretty well.

### Manual AWS IAM Setup

- Create an IAM Group with:
  - Attach Managed Policies:
    - AmazonEC2FullAccess - Start and stop EC2 instances
    - AWSLambdaFullAccess - Create and manage Lambda functions
    - AmazonS3FullAccess - Create a bucket to store the lambda function code
    - AmazonDynamoDBFullAccess - Manage DynamoDB
    - CloudWatchLogsFullAccess - Create and manage Cloudwatch logs
    - CloudWatchEventsFullAccess - Manage Cloudwatch events
    - AmazonSESFullAccess - Send Emails for alerts
    - AmazonSQSFullAccess - Send and subscribe to queues for alerts
    - AmazonAPIGatewayAdministrator - Create and manage API endpoints
    - IAMFullAccess - Create new role for the Lambda to work with EC2 instances
  - Create Custom Group Policy > Custom Policy:
    - Custom CloudFormation policy (below)- Create and manage CloudFormation stacks
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "Stmt1499009146000",
            "Effect": "Allow",
            "Action": [
                "cloudformation:*"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
```
- Create an IAM User and assign the User the newly created Group
- Setup AWS credentials with this user's security credentials. Check the above link since it has a good overview.

### Private API Setup

In most cases you will want to secure access to this API. We'll do this using an AWS API Key using the steps below:

- Create an API Key - https://console.aws.amazon.com/apigateway/home?region=us-east-1#/api-keys
- Create a Usage Plan - https://console.aws.amazon.com/apigateway/home?region=us-east-1#/usage-plans
    - Add the API (`ec2-remote-dev`) and API Key you created to the Usage Plan.
- Update `private` to `true` in the `serverless.yaml` method definition for the `unread` function 
- Make API calls with the Request Header `x-api-key: APIKEY`. 
- Example:
```
curl -H "x-api-key: AWS_API_KEY" https://API_ID.execute-api.us-east-1.amazonaws.com/dev/ec2/status/INSTANCE_NAME
```

## Slack Setup

We will need to add the app to you Slack Workspace

- Create a Slack app - https://api.slack.com/apps?new_app=1
- Navigate to: Slash Commands
    - Command: /send
    - Request URL: /dev/slack/send/command
    - Description: Send messages on steriods!
    - Usage hint: [MESSAGE tomorrow, at TIME, in N hours/mins/seconds] [list] [delete ID]
- Navigate to: OAuth & Permissions
    - Add Permission Scopes
        - bot
        - commands
        - incoming-webhook
        - chat:write:bot
        - chat:write:user
        - groups:read
        - team:read
        - users.profile:read
        - users:read
- Navigate to: Bot User
  - Add Name & Username: send-messages
  - Always Show My Bot as Online: Yes
- Navigate to: Event Subscriptions
    - Enable: Enable Events
    - Request URL: /dev/slack/send/command
    - Subscribe to Workspace Events
        - app_uninstalled
        - tokens_revoked
    - Subscribe to Bot Events:
        - app_mention


# Links

## NLP

- https://github.com/wanasit/chrono
    - https://github.com/wanasit/chrono/issues/214
- https://github.com/neilgupta/Sherlock
- http://compromise.cool


## Dates 

- https://www.epochconverter.com
- http://momentjs.com/docs/
- http://momentjs.com/timezone/docs/#/


## Slack Documentation

- https://api.slack.com/events-api
- https://api.slack.com/slash-commands
- https://api.slack.com/incoming-webhooks
- https://api.slack.com/bot-users
