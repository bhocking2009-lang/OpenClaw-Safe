export declare enum PrincipalRole {
    OPERATOR = "operator",
    FAMILY = "family",
    TRUSTED_MEMBER = "trusted_member"
}
export interface Principal {
    id: string;
    name: string;
    role: PrincipalRole;
}
export declare function createPrincipal(name: string, role: PrincipalRole): Principal;
//# sourceMappingURL=principal.d.ts.map