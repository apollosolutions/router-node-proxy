import { Readable } from "stream";
import rawBody from "raw-body";
import { fetch, Headers, Response } from "undici";
import { startUnleash } from "unleash-client";
import bodyParser from "body-parser";

const unleash = await startUnleash({
  url: process.env.UNLEASH_URL ?? "",
  appName: "router-proxy",
  instanceId: "my-unique-instance-id",
  customHeaders: {
    Authorization: process.env.UNLEASH_API_TOKEN ?? "",
  },
});

const ROLLOUT = "router-rollout";
const REPLAY = "router-replay-on-error";
const IGNORED_HEADERS = new Set(["connection", "content-encoding"]);

/**
 * @param {import("express").Request} req
 */
function useRouter(req) {
  return unleash.isEnabled(ROLLOUT) || req.header("x-use-router") === "true";
}

function shouldReplay() {
  return unleash.isEnabled(REPLAY);
}

/**
 * Converts an express request into a fetch request. This consumes the request
 * body, so we'll also return the body if we need to use it later
 * @param {import("express").Request} req
 * @return {Promise<[Response, Buffer]>}
 */
async function proxyRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value && !IGNORED_HEADERS.has(key)) {
      typeof value === "string"
        ? headers.set(key, value)
        : value.forEach((value) => headers.append(key, value));
    }
  }

  // fetch takes a Buffer not a Readable stream. This consumes the request body.
  const body = await rawBody(req);

  const response = await fetch(process.env.ROUTER_URL ?? "", {
    method: "POST",
    headers,
    body,
  });

  return [response, body];
}

/**
 * Send the status, headers, and body of the fetch response to the client
 * @param {Response} routerResponse
 * @param {import("express").Response} clientResponse
 */
function streamResponse(routerResponse, clientResponse) {
  clientResponse.status(routerResponse.status);

  for (const [key, value] of routerResponse.headers) {
    if (!IGNORED_HEADERS.has(key)) {
      clientResponse.header(key, value);
    }
  }

  if (routerResponse.body)
    Readable.fromWeb(routerResponse.body).pipe(clientResponse);
}

/**
 * Inspects the `errors` of the router response to determine if we should try
 * replaying the request in the gateway.
 * @param {Response} response
 */
async function isReplayable(response) {
  try {
    // Do not try to parse chunked response (@defer)
    if (response.headers.get("transfer-encoding")?.includes("chunked")) {
      return false;
    }

    const json = /** @type {import("graphql").ExecutionResult} */ (
      await response.clone().json()
    );

    if (json.errors && !isPersistedQueryError(json.errors)) {
      console.log(`ROUTER PROXY ERROR: ${JSON.stringify(json.errors)}`);
      return true;
    }
  } catch (e) {
    console.log(
      `Error parsing router JSON response: ${await response.text()}\n${e}`
    );
    return true;
  }

  return false;
}

/**
 * APQ error responses are expected and should not be replayed.
 * @param {readonly import("graphql").GraphQLError[]} errors
 */
function isPersistedQueryError(errors) {
  return errors.length === 1 && errors[0].message === "PersistedQueryNotFound";
}

/** @type {import("express").Handler} */
export async function routerProxyMiddleware(req, res, originalNext) {
  /** @type {Buffer | undefined} */
  let body;

  // When we proxy the request to the router as a Buffer (avoiding JSON
  // de/serialization), it's no longer readable for future middleware. If we
  // need to call `next()`, we'll either A) parse the JSON from the buffer we
  // already have, or B) call the JSON body parser ourselves before calling
  // the next middleware.
  const next = () => {
    if (body) {
      req.body = JSON.parse(body.toString("utf-8"));
      originalNext();
    } else {
      bodyParser.json()(req, res, originalNext);
    }
  };

  // Ignore non-GraphQL requests (for sandbox, etc)
  if (!req.header("accept")?.includes("application/json")) {
    return next();
  }

  try {
    if (useRouter(req)) {
      console.log(`Forwarding request to the router`);

      let resp;
      [resp, body] = await proxyRequest(req);

      if (shouldReplay() && (await isReplayable(resp))) {
        console.log(`Replaying the request in Node.js`);
        return next();
      }

      streamResponse(resp, res);
      return;
    }
  } catch (e) {
    console.log(`ROUTER PROXY ERROR: ${e}`);
    console.log(`Replaying the request in Node.js`);
    return next();
  }

  console.log(`Handling the request in Node.js`);
  next();
}
