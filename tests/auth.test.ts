import { IdentityAuth, AuthMethod, AuthResult } from "../src/core/auth";

describe("IdentityAuth", () => {
  let auth: IdentityAuth;

  beforeEach(() => {
    auth = new IdentityAuth();
  });

  describe("LOCAL method", () => {
    it("always authenticates with principalId=local", () => {
      const result = auth.authenticate(AuthMethod.LOCAL, {});
      expect(result.authenticated).toBe(true);
      expect(result.principalId).toBe("local");
      expect(result.method).toBe(AuthMethod.LOCAL);
    });

    it("authenticates regardless of credentials", () => {
      const result = auth.authenticate(AuthMethod.LOCAL, { anything: "value" });
      expect(result.authenticated).toBe(true);
    });
  });

  describe("API_KEY method", () => {
    it("authenticates with a registered API key", () => {
      auth.registerApiKey("principal-1", "my-secret-key");
      const result = auth.authenticate(AuthMethod.API_KEY, { key: "my-secret-key" });
      expect(result.authenticated).toBe(true);
      expect(result.principalId).toBe("principal-1");
      expect(result.method).toBe(AuthMethod.API_KEY);
    });

    it("rejects an unregistered API key", () => {
      const result = auth.authenticate(AuthMethod.API_KEY, { key: "wrong-key" });
      expect(result.authenticated).toBe(false);
      expect(result.principalId).toBeNull();
      expect(result.error).toBeDefined();
    });

    it("rejects when no key provided", () => {
      const result = auth.authenticate(AuthMethod.API_KEY, {});
      expect(result.authenticated).toBe(false);
    });

    it("can register multiple keys for different principals", () => {
      auth.registerApiKey("p1", "key1");
      auth.registerApiKey("p2", "key2");
      expect(auth.authenticate(AuthMethod.API_KEY, { key: "key1" }).principalId).toBe("p1");
      expect(auth.authenticate(AuthMethod.API_KEY, { key: "key2" }).principalId).toBe("p2");
    });

    it("returns error message on failure", () => {
      const result = auth.authenticate(AuthMethod.API_KEY, { key: "bad" });
      expect(typeof result.error).toBe("string");
    });
  });

  describe("OAUTH method", () => {
    it("returns not authenticated for oauth (not implemented)", () => {
      const result = auth.authenticate(AuthMethod.OAUTH, { token: "bearer-xyz" });
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("AuthResult structure", () => {
    it("successful result has no error", () => {
      const result = auth.authenticate(AuthMethod.LOCAL, {});
      expect(result.error).toBeUndefined();
    });

    it("failed result has error string", () => {
      const result = auth.authenticate(AuthMethod.API_KEY, { key: "bad" });
      expect(result.error).toBeTruthy();
    });

    it("returns null principalId on failure", () => {
      const result = auth.authenticate(AuthMethod.API_KEY, { key: "bad" });
      expect(result.principalId).toBeNull();
    });

    it("returns method in result", () => {
      const result = auth.authenticate(AuthMethod.LOCAL, {});
      expect(result.method).toBe(AuthMethod.LOCAL);
    });
  });

  describe("registerApiKey", () => {
    it("can re-register same principal with new key", () => {
      auth.registerApiKey("p1", "key-old");
      auth.registerApiKey("p1", "key-new");
      expect(auth.authenticate(AuthMethod.API_KEY, { key: "key-new" }).authenticated).toBe(true);
    });
  });

  describe("AuthMethod enum", () => {
    it("has API_KEY value", () => {
      expect(AuthMethod.API_KEY).toBe("api_key");
    });

    it("has OAUTH value", () => {
      expect(AuthMethod.OAUTH).toBe("oauth");
    });

    it("has LOCAL value", () => {
      expect(AuthMethod.LOCAL).toBe("local");
    });
  });
});
