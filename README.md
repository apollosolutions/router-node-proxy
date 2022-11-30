# Apollo Router Node.js proxy migration strategy

**The code in this repository is experimental and has been provided for reference purposes only. Community feedback is welcome but this project may not be supported in the same way that repositories in the official [Apollo GraphQL GitHub organization](https://github.com/apollographql) are. If you need help you can file an issue on this repository, [contact Apollo](https://www.apollographql.com/contact-sales) to talk to an expert, or create a ticket directly in Apollo Studio.**

This repo demonstrates running both [`@apollo/gateway`](https://www.apollographql.com/docs/federation/api/apollo-gateway) and [Apollo Router](https://www.apollographql.com/docs/router/), and using the gateway Node.js server to conditionally proxy traffic to the router to support a gradual release strategy. It uses [Unleash](https://www.getunleash.io/) to demonstrate a somewhat-realistic feature toggle system.

## Run the demo

1. Clone this repository

   ```sh
   git clone https://github.com/apollosolutions/router-node-proxy
   ```

2. Build and run the services:

   ```sh
   docker compose up --build
   ```

3. Create the feature toggles:

   1. The rollout feature toggle:
      ```sh
      curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features' \
        --header 'Authorization: *:*.unleash-insecure-api-token' \
        --header 'Content-Type: application/json' \
        --data-raw '{
          "type": "release",
          "name": "router-rollout",
          "description": "",
          "impressionData": false
        }'
      ```
   2. The replay-on-error feature toggle:
      ```sh
      curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features' \
        --header 'Authorization: *:*.unleash-insecure-api-token' \
        --header 'Content-Type: application/json' \
        --data-raw '{
          "type": "release",
          "name": "router-replay-on-error",
          "description": "",
          "impressionData": false
        }'
      ```

4. Restart the services with `<ctrl-c>` and `docker compose up`.

5. Visit [http://localhost:4000](http://localhost:4000). Execute an operation:

   ```graphql
   query Query {
     me {
       id
     }
   }
   ```

6. Observe `Handling the request in Node.js` log messages.

7. Add a override header to send the request to the router: `x-use-router: true` and execute the operation.

8. Observe `Forwarding request to the router` log messages.

9. Rollout out the router to 50% of requests:

   ```sh
   curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features/router-rollout/environments/development/strategies' \
      --header 'Authorization: *:*.unleash-insecure-api-token' \
      --header 'Content-Type: application/json' \
      --data-raw '{
        "name": "flexibleRollout",
        "constraints": [],
        "parameters": {
          "rollout": "50",
          "stickiness": "random",
          "groupId": "router-rollout"
        }
      }'
   ```

10. Enable the feature toggle:

    ```sh
    curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features/router-rollout/environments/development/on' \
      --header 'Authorization: *:*.unleash-insecure-api-token'
    ```

11. Disable the `x-use-router` header and execute the request several times.

12. Observe that about 50% of requests print `Forwarding request to the router` to the logs.

13. Enable the replay-on-error feature toggle:

    ```sh
    curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features/router-replay-on-error/environments/development/on' \
      --header 'Authorization: *:*.unleash-insecure-api-token'
    ```

14. Execute an operation that will trigger an error:

    ```graphql
    query Query {
      me {
        foo
      }
    }
    ```

15. Observe three log messages indicating that the Node.js server replayed the request in the gateway:

    ```
    Forwarding request to the router
    ROUTER PROXY ERROR: [{"message":"cannot query field 'foo' on type 'User'"}]
    Replaying the request in Node.js
    ```

16. Set the router rollout feature toggle to 100%. You can also log into the Unleash UI by navigating to [http://localhost:4242/](http://localhost:4242/), logging in with username `admin` and password `unleash4all` and editing the existing rollout strategy.

    ```sh
    curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features/router-rollout/environments/development/strategies' \
      --header 'Authorization: *:*.unleash-insecure-api-token' \
      --header 'Content-Type: application/json' \
      --data-raw '{
        "name": "flexibleRollout",
        "constraints": [],
        "parameters": {
          "rollout": "100",
          "stickiness": "random",
          "groupId": "router-rollout"
        }
      }'
    ```

17. Disable router replay-on-error:

    ```sh
    curl --location --request POST 'http://localhost:4242/api/admin/projects/default/features/router-replay-on-error/environments/development/off' \
      --header 'Authorization: *:*.unleash-insecure-api-token'
    ```

18. Try a router-specific feature like `@defer`:

    ```graphql
    query Query {
      me {
        id
      }
      ... @defer {
        topProducts {
          name
        }
      }
    }
    ```

## Limitations

The "replay-on-error" functionality can't handle chunked responses, so it's incompatible with `@defer`. Make sure you disable the "replay-on-error" functionality before trying to use `@defer` in operations.
