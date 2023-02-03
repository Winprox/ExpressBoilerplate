import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import c from 'chalk';
import cors from 'cors';
import express from 'express';
import { writeFileSync } from 'fs';
import { createServer } from 'http';
import { serve, setup } from 'swagger-ui-express';
import { createOpenApiExpressMiddleware, generateOpenApiDocument } from 'trpc-openapi';
import { createContext, router } from './router/_index';
import { port } from './utils';

const app = express();
const server = createServer(app);
export const prisma = new PrismaClient();

//? Generate OpenAPI
const oApi = generateOpenApiDocument(router, {
  title: 'Example API',
  version: '1.0.0',
  baseUrl: `http://localhost:${port}`,
});

//? Write OpenAPI to File
writeFileSync('./openapi.json', JSON.stringify(oApi, null, 2));

//? CORS
app.use(cors());

//? Swagger UI
app.get('/view', setup(oApi));
app.use('/view', serve);

//? REST and TRPC
const errorHandler = (type: string, path: any, error: TRPCError) =>
  console.log(
    c.red(
      `{${type}} [${path}] ${error.code}: ` +
        `${error.message}${error.cause ? `\n${error.cause}` : ''}`
    )
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

server.listen(port, () => console.log(c.blue(`http://localhost:${port}/view`)));
