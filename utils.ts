import c from 'chalk';
import { verify } from 'jsonwebtoken';

export const getIdFromJWT = (token: string, jwtSecret: string) => {
  try {
    const decoded: any = verify(token, jwtSecret);
    if (!decoded.id) {
      console.log(c.red('{REST/TRPC} WRONG_TOKEN_FORMAT'));
      return undefined;
    }
    return String(decoded.id);
  } catch (error) {
    console.log(c.red(`{REST/TRPC} ${error}`));
    return undefined;
  }
};
