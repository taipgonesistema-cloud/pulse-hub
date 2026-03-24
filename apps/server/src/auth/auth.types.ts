export type UserRole = 'admin' | 'supervisor' | 'attendant';

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthUser = Omit<UserRecord, 'passwordHash'>;

export type SignInResult = {
  user: AuthUser;
  token: string;
};
