import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

export interface OracleConfig {
  programId: PublicKey;
  priceAccount: PublicKey;
  owner: Keypair;
}

export interface PriceData {
  price: number;
  confidence: number;
  timestamp: number;
}

export interface TestOracle {
  config: OracleConfig;
  connection: Connection;
  program: Program;
}

export async function createTestOracle(
  connection: Connection,
  owner: Keypair
): Promise<TestOracle> {
  const programId = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"); // placeholder for test
  const priceAccount = Keypair.generate();

  // Create a minimal price account
  const lamports = await connection.getMinimumBalanceForRentExemption(200);
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: owner.publicKey,
      newAccountPubkey: priceAccount.publicKey,
      lamports,
      space: 200,
      programId,
    })
  );
  await anchor.web3.sendAndConfirmTransaction(connection, tx, [owner, priceAccount]);

  const config: OracleConfig = {
    programId,
    priceAccount: priceAccount.publicKey,
    owner,
  };

  // Minimal mock program for sim
  const program = {
    methods: {
      updatePrice: (price: number, confidence: number) => ({
        accounts: { priceAccount: config.priceAccount, owner: config.owner.publicKey },
        rpc: async () => {
          // mock update
          await new Promise((r) => setTimeout(r, 10));
          return "mock-tx";
        },
      }),
    },
  } as any;

  return {
    config,
    connection,
    program,
  };
}

export async function updateTestOracle(
  oracle: TestOracle,
  price: number,
  confidence: number = 0.01,
  timestamp?: number
): Promise<string> {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  // In real sim this would call the oracle program; here we mock the on-chain update
  await oracle.program.methods
    .updatePrice(price, confidence)
    .accounts({
      priceAccount: oracle.config.priceAccount,
      owner: oracle.config.owner.publicKey,
    })
    .signers([oracle.config.owner])
    .rpc();

  // Return the price account pubkey as identifier
  return oracle.config.priceAccount.toBase58();
}

export function createPriceAccount(): PublicKey {
  return Keypair.generate().publicKey;
}

export async function updatePriceAccount(
  connection: Connection,
  priceAccount: PublicKey,
  price: number,
  confidence: number,
  timestamp: number
): Promise<void> {
  // Mock on-chain update for the test harness
  console.log(`[mock] Updated oracle ${priceAccount.toBase58()} to price=${price} conf=${confidence} ts=${timestamp}`);
}
