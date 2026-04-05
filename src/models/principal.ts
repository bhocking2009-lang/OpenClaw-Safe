import crypto from "crypto";

export enum PrincipalRole {
  OPERATOR = "operator",
  FAMILY = "family",
  TRUSTED_MEMBER = "trusted_member",
}

export interface Principal {
  id: string;
  name: string;
  role: PrincipalRole;
}

export function createPrincipal(name: string, role: PrincipalRole): Principal {
  return { id: crypto.randomUUID(), name, role };
}
