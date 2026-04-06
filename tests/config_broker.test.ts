import { ConfigBroker } from "../src/core/config_broker";

describe("ConfigBroker", () => {
  let broker: ConfigBroker;

  beforeEach(() => {
    broker = new ConfigBroker();
  });

  describe("set/get", () => {
    it("sets and gets a string value", () => {
      broker.set("key1", "value1");
      expect(broker.get("key1")).toBe("value1");
    });

    it("sets and gets a number value", () => {
      broker.set("count", 42);
      expect(broker.get("count")).toBe(42);
    });

    it("sets and gets an object value", () => {
      const obj = { x: 1, y: 2 };
      broker.set("obj", obj);
      expect(broker.get("obj")).toEqual(obj);
    });

    it("returns undefined for unknown key", () => {
      expect(broker.get("nonexistent")).toBeUndefined();
    });

    it("overrides existing value on re-set", () => {
      broker.set("k", "v1");
      broker.set("k", "v2");
      expect(broker.get("k")).toBe("v2");
    });

    it("sets and gets boolean values", () => {
      broker.set("flag", true);
      expect(broker.get("flag")).toBe(true);
    });

    it("sets and gets null value", () => {
      broker.set("nullkey", null);
      expect(broker.get("nullkey")).toBeNull();
    });
  });

  describe("setSecret/hasSecret", () => {
    it("stores a secret and hasSecret returns true", () => {
      broker.setSecret("db_password", "super-secret");
      expect(broker.hasSecret("db_password")).toBe(true);
    });

    it("hasSecret returns false for unknown key", () => {
      expect(broker.hasSecret("unknown")).toBe(false);
    });

    it("does not expose actual secret value via get()", () => {
      broker.setSecret("api_key", "real-key");
      expect(broker.get("api_key")).toBeUndefined();
    });

    it("can store multiple secrets", () => {
      broker.setSecret("s1", "v1");
      broker.setSecret("s2", "v2");
      expect(broker.hasSecret("s1")).toBe(true);
      expect(broker.hasSecret("s2")).toBe(true);
    });

    it("re-setting a secret updates it", () => {
      broker.setSecret("pw", "old");
      broker.setSecret("pw", "new");
      expect(broker.hasSecret("pw")).toBe(true);
    });
  });

  describe("delete", () => {
    it("removes a config key", () => {
      broker.set("to-delete", "value");
      broker.delete("to-delete");
      expect(broker.get("to-delete")).toBeUndefined();
    });

    it("removes a secret key", () => {
      broker.setSecret("secret-to-delete", "value");
      broker.delete("secret-to-delete");
      expect(broker.hasSecret("secret-to-delete")).toBe(false);
    });

    it("does nothing for non-existent key", () => {
      expect(() => broker.delete("ghost")).not.toThrow();
    });

    it("deletes only the specified key", () => {
      broker.set("a", 1);
      broker.set("b", 2);
      broker.delete("a");
      expect(broker.get("a")).toBeUndefined();
      expect(broker.get("b")).toBe(2);
    });
  });
});
