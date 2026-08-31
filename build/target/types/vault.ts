// Placeholder type module so tsc resolves ../target/types/vault in CI,
// where `anchor build` does not run. Locally, `anchor build` regenerates
// the real types at this path and this stub is superseded.
export type Vault = any;
export const IDL: any = { version: "0.1.0", name: "vault", instructions: [] };
