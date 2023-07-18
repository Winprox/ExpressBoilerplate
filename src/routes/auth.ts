import { TRPCError } from '@trpc/server';
import Crypto from 'crypto-js';
import { z } from 'zod';
import { updateSessionAndIssueJWTs } from '../_utils.js';
import { procedure, TRouter } from '../router.js';

export const generateAuthRouter = (router: TRouter) =>
  router({
    login: procedure
      .meta({ openapi: { method: 'POST', path: '/login', tags: ['Auth'] } })
      .input(z.object({ name: z.string(), pass: z.string() }))
      .output(z.object({}))
      .query(async ({ input: { name, pass }, ctx: { req, res, prisma } }) => {
        const user = await prisma.user
          .findFirst({ where: { name, pass: Crypto.SHA256(pass).toString() } })
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
        return {};
      }),
    register: procedure
      .meta({ openapi: { method: 'POST', path: '/register', tags: ['Auth'] } })
      .input(z.object({ name: z.string(), pass: z.string().min(6), isAdmin: z.boolean() }))
      .output(z.object({}))
      .mutation(async ({ input: { name, isAdmin, pass }, ctx: { prisma } }) => {
        await prisma.user
          .create({ data: { name, isAdmin, pass: Crypto.SHA256(pass).toString() } })
          .catch(({ message }) => {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message, cause: message });
          });
        prisma.$disconnect();
        return {};
      }),
  });
