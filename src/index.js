import { readFile } from "fs/promises";
import { createServer } from "http";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { ApolloGateway } from "@apollo/gateway";
import cors from "cors";
import express from "express";
import { routerProxyMiddleware } from "./router.js";

// See the @apollo/server/express4 docs for an explanation of this code:
// https://www.apollographql.com/docs/apollo-server/api/express-middleware/

const app = express();
const httpServer = createServer(app);

const gateway = new ApolloGateway({
  supergraphSdl: await readFile("/dist/schema/local.graphql", "utf-8"),
});

const server = new ApolloServer({
  gateway,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});

await server.start();

// Here's an example of Node.js middleware you need to reuse.
app.use(cors());

// Router proxy middleware comes next. If the router can handle the request,
// this will respond and terminate the request pipeline. Otherwise it will pass
// the request to the gateway middleware registered next.
app.use(routerProxyMiddleware);

// Register the @apollo/server middleware last.
app.use(expressMiddleware(server));

const port = process.env.PORT ?? 4000;
await /** @type {Promise<void>} */ (
  new Promise((resolve) => httpServer.listen({ port }, resolve))
);

console.log(`🚀 Server ready at http://localhost:${port}/`);
