export enum AuthMethod {
  API_KEY = "api_key",
  OAUTH = "oauth",
  LOCAL = "local",
}

export interface AuthResult {
  authenticated: boolean;
  principalId: string | null;
  method: AuthMethod | null;
  error?: string;
}

export class IdentityAuth {
  private apiKeys: Map<string, string> = new Map(); // key -> principalId

  registerApiKey(principalId: string, key: string): void {
    this.apiKeys.set(key, principalId);
  }

  authenticate(method: AuthMethod, credentials: Record<string, string>): AuthResult {
    switch (method) {
      case AuthMethod.LOCAL:
        return { authenticated: true, principalId: "local", method };

      case AuthMethod.API_KEY: {
        const key = credentials["key"] ?? "";
        const principalId = this.apiKeys.get(key);
        if (principalId) {
          return { authenticated: true, principalId, method };
        }
        return {
          authenticated: false,
          principalId: null,
          method,
          error: "Invalid API key.",
        };
      }

      case AuthMethod.OAUTH:
        return {
          authenticated: false,
          principalId: null,
          method,
          error: "OAuth not implemented.",
        };

      default:
        return {
          authenticated: false,
          principalId: null,
          method: null,
          error: "Unknown authentication method.",
        };
    }
  }
}
