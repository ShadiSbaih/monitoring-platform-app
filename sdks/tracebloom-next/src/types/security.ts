export type AuthStatus =
  | 'authenticated'
  | 'unauthenticated'
  | 'success'
  | 'failure'
  | (string & {});

export interface LogSecurity {
  auth_status?: AuthStatus;
  suspicious?: boolean;
  tags?: string[];
}
