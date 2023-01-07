import { z } from 'zod';
import { SHA256 } from 'crypto-js';
import { TRPCError } from '@trpc/server';
import { prisma, io } from '../index';
import { procedure } from './_index';
import { updateSessionAndIssueJWTs } from '../utils';

export const generateAuthRouter = (router: any) =>
  router({
    login: procedure
      .meta({ openapi: { method: 'GET', path: '/login', tags: ['Auth'] } })
      .input(z.object({ name: z.string(), pass: z.string() }))
      .output(z.object({}))
      .query(async ({ input: { name, pass }, ctx: { req, res } }) => {
        const user = await prisma.user
          .findFirst({ where: { name, pass: String(SHA256(pass)) } })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

        updateSessionAndIssueJWTs({ req, res }, user.id, prisma);
        io.to('admins').emit(`login [${name}]`);
        return {};
      }),
  });
