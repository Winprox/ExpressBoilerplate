import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cors from 'cors';
import express from 'express';
import { existsSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { serve, setup } from 'swagger-ui-express';
import { createOpenApiExpressMiddleware, generateOpenApiDocument } from 'trpc-openapi';
import { isProd, port } from './_utils.js';
import { createContext, router } from './router.js';

const app = express();
const server = createServer(app);
export const prisma = new PrismaClient();

//? CORS
app.use(cors());

if (!isProd) {
  //? Generate OpenAPI
  const oApi = generateOpenApiDocument(router, {
    title: 'Example API',
    version: '1.0.0',
    baseUrl: `http://localhost:${port}`,
  });

  //? Write OpenAPI to File
  writeFileSync('./openapi.json', JSON.stringify(oApi, null, 2));

  //? Swagger UI
  app.get('/swagger', setup(oApi));
  app.use('/swagger', serve);
}

//? Serve Static
const dist = `${path.dirname}/dist`;
const distExist = existsSync(dist);
if (distExist) {
  app.use(express.static(dist));
  app.get(['/app', '/app/*'], (_, res) => res.sendFile(path.resolve(dist, 'index.html')));
}

//? REST and TRPC
const errorHandler = (type: string, path: any, error: TRPCError) =>
  console.log(
    `{${type}} [${path}] ${error.code}: ` +
      `${error.message}${error.cause ? `\n${error.cause}` : ''}`
  );

app.use(
  '/',
  createOpenApiExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }: any) => errorHandler('REST', path, error),
    maxBodySize: undefined,
    responseMeta: undefined,
  })
);

app.use(
  '/trpc',
  createExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }) => errorHandler('TRPC', path, error),
    maxBodySize: undefined,
    responseMeta: undefined,
  })
);

server.listen(port, () => {
  if (distExist) console.log(`http://localhost:${port}/app/`);
  if (!isProd) console.log(`http://localhost:${port}/swagger/`);
});
