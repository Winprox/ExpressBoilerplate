import { z } from 'zod';
import { SHA256 } from 'crypto-js';
import { TRPCError } from '@trpc/server';
import { prisma, io } from '../index';
import { authedProcedure, adminProcedure } from './_index';

export const generateUsersRouter = (router: any) =>
  router({
    getUsers: authedProcedure
      .meta({ openapi: { method: 'GET', path: '/get_users', tags: ['Base'] } })
      .input(z.object({}))
      .output(z.array(z.object({ id: z.string(), name: z.string() })))
      .query(async ({ ctx: { user } }) => {
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

        io.to('users').emit('getUsers', { user });
        io.to('admins').emit('getUsers', { user });
        return res;
      }),
    addUser: adminProcedure
      .meta({ openapi: { method: 'POST', path: '/add_user', tags: ['Admin'] } })
      .input(z.object({ name: z.string(), pass: z.string().min(6), isAdmin: z.boolean() }))
      .output(z.string())
      .mutation(async ({ input: { name, isAdmin, pass }, ctx: { user } }) => {
        const res = await prisma.user
          .create({ data: { name, isAdmin, pass: String(SHA256(pass)) } })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();

        io.to('admins').emit(`addUser [${res.id}]`, { user, data: { name, pass, isAdmin } });
        return res.id;
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
      .mutation(async ({ input: { id, name, pass, isAdmin }, ctx: { user } }) => {
        await prisma.user
          .update({
            where: { id },
            data: { name, pass: pass ? String(SHA256(pass)) : undefined, isAdmin },
          })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();

        io.to('admins').emit(`updateUser [${id}]`, { user, data: { name, pass, isAdmin } });
        return {};
      }),
    deleteUser: adminProcedure
      .meta({ openapi: { method: 'DELETE', path: '/delete_user', tags: ['Admin'] } })
      .input(z.object({ id: z.string() }))
      .output(z.object({}))
      .mutation(async ({ input: { id }, ctx: { user } }) => {
        await prisma.user.delete({ where: { id } }).catch(({ message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: message,
          });
        });
        prisma.$disconnect();

        io.to('admins').emit(`deleteUser [${id}]`, { user });
        return {};
      }),
  });
