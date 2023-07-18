import { TRPCError } from '@trpc/server';
import { SHA256 } from 'crypto-js';
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
          .findFirst({ where: { name, pass: SHA256(pass).toString() } })
          .catch(({ message }) => {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
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
        const user = await prisma.user.findFirst({ where: { name } }).catch(({ message }) => {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
        });
        if (user) throw new TRPCError({ code: 'BAD_REQUEST', message: 'User exists' });
        await prisma.user
          .create({ data: { name, isAdmin, pass: SHA256(pass).toString() } })
          .catch(({ message }) => {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
          });
        prisma.$disconnect();
        return {};
      }),
  });
