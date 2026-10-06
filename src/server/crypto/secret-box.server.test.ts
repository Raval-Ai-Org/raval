import { describe, expect, it } from "vitest";
import {
  connectorEncryptionKeys,
  decryptWithKeys,
  encryptWithKey,
  SecretKeyError,
} from "./secret-box.server";

describe("connector encryption keys", () => {
  const root = "service-role-credential-".repeat(3);
  const legacyKey = Buffer.alloc(32, 7);

  it("derives stable, separate keys and reads grants made with an older explicit key", () => {
    const env = {
      SUPABASE_SERVICE_ROLE_KEY: root,
      CANVA_TOKEN_ENCRYPTION_KEY: legacyKey.toString("base64"),
    };
    const canva = connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", env);
    const notion = connectorEncryptionKeys("NOTION_TOKEN_ENCRYPTION_KEY", env);
    expect(canva.key).toHaveLength(32);
    expect(canva.key.equals(notion.key)).toBe(false);
    expect(canva.key.equals(legacyKey)).toBe(false);
    expect(connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", env).key.equals(canva.key)).toBe(
      true,
    );
    expect(decryptWithKeys(encryptWithKey("previous grant", legacyKey), canva.readKeys)).toBe(
      "previous grant",
    );
    expect(decryptWithKeys(encryptWithKey("new grant", canva.key), canva.readKeys)).toBe(
      "new grant",
    );
  });

  it("uses the service credential when a dedicated key is missing or malformed", () => {
    const missing = connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", {
      SUPABASE_SERVICE_ROLE_KEY: root,
    });
    const invalid = connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", {
      SUPABASE_SERVICE_ROLE_KEY: root,
      CANVA_TOKEN_ENCRYPTION_KEY: "invalid",
    });
    expect(invalid.key.equals(missing.key)).toBe(true);
    expect(invalid.readKeys).toHaveLength(1);
  });

  it("accepts a dedicated key without the service credential and rejects no usable key", () => {
    const explicit = connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", {
      CANVA_TOKEN_ENCRYPTION_KEY: legacyKey.toString("base64"),
    });
    expect(explicit.key.equals(legacyKey)).toBe(true);
    expect(() => connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY", {})).toThrow(SecretKeyError);
  });
});
