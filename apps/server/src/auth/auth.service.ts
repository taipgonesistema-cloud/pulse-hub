import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PostgresService } from '../persistence/postgres.service';
import { hashPassword, verifyPassword } from './auth-password';
import type {
  AuthUser,
  SignInResult,
  UserRecord,
  UserRole,
} from './auth.types';
import type { SignInDto } from './dto/sign-in.dto';

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  is_active: boolean;
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly postgres: PostgresService) {}

  async onModuleInit() {
    await this.ensureSeedUser();
  }

  async signIn(payload: SignInDto): Promise<SignInResult> {
    const email = payload.email.trim().toLowerCase();
    const password = payload.password.trim();
    const user = await this.findByEmail(email);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Email ou senha invalidos.');
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      throw new UnauthorizedException('Email ou senha invalidos.');
    }

    await this.postgres.query(
      `
        UPDATE users
        SET last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [user.id],
    );

    const refreshedUser = await this.findByEmail(email);

    if (!refreshedUser) {
      throw new NotFoundException('Usuario nao encontrado apos autenticacao.');
    }

    return {
      user: this.toAuthUser(refreshedUser),
      token: this.createSessionToken(refreshedUser),
    };
  }

  private async ensureSeedUser() {
    const seedEmail = (process.env.AUTH_SEED_EMAIL ?? 'admin@pulsehub.local')
      .trim()
      .toLowerCase();
    const seedPassword = (
      process.env.AUTH_SEED_PASSWORD ?? 'PulseHub123!'
    ).trim();
    const seedName = (process.env.AUTH_SEED_NAME ?? 'ether command Admin').trim();
    const seedRole = (process.env.AUTH_SEED_ROLE ?? 'admin').trim() as UserRole;

    const existingUser = await this.findByEmail(seedEmail);

    if (!existingUser) {
      const passwordHash = await hashPassword(seedPassword);

      await this.postgres.query(
        `
          INSERT INTO users (
            id,
            email,
            name,
            role,
            password_hash,
            is_active,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
        `,
        [this.createId('user'), seedEmail, seedName, seedRole, passwordHash],
      );

      this.logger.log(`Usuario seed criado para ${seedEmail}.`);
      return;
    }

    const usesSeedPassword = await verifyPassword(
      seedPassword,
      existingUser.passwordHash,
    );

    if (
      usesSeedPassword &&
      existingUser.name === seedName &&
      existingUser.role === seedRole &&
      existingUser.isActive
    ) {
      return;
    }

    const passwordHash = usesSeedPassword
      ? existingUser.passwordHash
      : await hashPassword(seedPassword);

    await this.postgres.query(
      `
        UPDATE users
        SET
          name = $2,
          role = $3,
          password_hash = $4,
          is_active = TRUE,
          updated_at = NOW()
        WHERE email = $1
      `,
      [seedEmail, seedName, seedRole, passwordHash],
    );

    this.logger.log(`Usuario seed sincronizado para ${seedEmail}.`);
  }

  private async findByEmail(email: string) {
    const result = await this.postgres.query<UserRow>(
      `
        SELECT
          id,
          email,
          name,
          role,
          password_hash,
          is_active,
          last_login_at,
          created_at,
          updated_at
        FROM users
        WHERE email = $1
      `,
      [email],
    );

    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  private mapUser(row: UserRow): UserRecord {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      passwordHash: row.password_hash,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at
        ? new Date(row.last_login_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private toAuthUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private createSessionToken(user: UserRecord) {
    const nonce = randomBytes(18).toString('hex');
    const payload = `${user.id}:${user.email}:${nonce}`;
    return Buffer.from(payload).toString('base64url');
  }

  private createId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
