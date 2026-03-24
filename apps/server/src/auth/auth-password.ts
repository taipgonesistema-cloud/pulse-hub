import {
  randomBytes,
  timingSafeEqual,
  scrypt as nodeScrypt,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedHex] = passwordHash.split(':');

  if (!salt || !storedHex) {
    return false;
  }

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const stored = Buffer.from(storedHex, 'hex');

  if (derived.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(derived, stored);
}
