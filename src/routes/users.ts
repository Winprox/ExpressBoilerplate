import { TRPCError } from '@trpc/server';
import Crypto from 'crypto-js';
import { z } from 'zod';
import { adminProcedure, authedProcedure, TRouter } from '../router.js';

export const generateUsersRouter = (router: TRouter) =>
  router({
    getUsers: authedProcedure
      .meta({ openapi: { method: 'GET', path: '/get_users', tags: ['Base'] } })
      .input(z.object({}))
      .output(z.array(z.object({ id: z.string(), name: z.string() })))
      .query(async ({ ctx: { user, prisma } }) => {
        //? If user is not admin, only return non-admin users
        const res = await prisma.user
          .findMany({ where: user?.isAdmin ? {} : { isAdmin: false } })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();
        return res;
      }),
    updateUser: adminProcedure
      .meta({
        openapi: {
          method: 'PUT',
          path: '/update_user',
          tags: ['Admin'],
          description: 'Everything except for [id] is optional',
        },
      })
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          pass: z.string().min(6).optional(),
          isAdmin: z.boolean().optional(),
        })
      )
      .output(z.object({}))
      .mutation(async ({ input: { id, name, pass, isAdmin }, ctx: { prisma } }) => {
        await prisma.user
          .update({
            where: { id },
            data: { name, pass: pass ? Crypto.SHA256(pass).toString() : undefined, isAdmin },
          })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();
        return {};
      }),
    deleteUser: adminProcedure
      .meta({ openapi: { method: 'DELETE', path: '/delete_user', tags: ['Admin'] } })
      .input(z.object({ id: z.string() }))
      .output(z.object({}))
      .mutation(async ({ input: { id }, ctx: { prisma, user } }) => {
        if (id == user?.id)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot delete self',
            cause: 'BAD_REQUEST',
          });
        await prisma.user.delete({ where: { id } }).catch(({ message }) => {
          console.log(message);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: message,
          });
        });
        prisma.$disconnect();
        return {};
      }),
  });
