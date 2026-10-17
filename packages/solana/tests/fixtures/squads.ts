import { compileSquadsMessage, inspectSquadsVault } from "../../src/squads.js";
import { createHash } from "node:crypto";
import {
  AccountRole,
  addSignersToInstruction,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  type Address,
  type Instruction,
  type TransactionSigner,
  type ReadonlyUint8Array,
} from "@solana/kit";
import type { createMarketplaceFixture } from "./marketplace.js";

// Test-only Kit adapter for the official Squads schema at
// af94153ff77a28b6effe46b9c94baaa93742b48c/sdk/multisig/{idl,src/types.ts}.
// The genuine pinned program performs creation, voting and invoke_signed.
export const SQUADS = address("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const SYSTEM = address("11111111111111111111111111111111");
const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const encodeAddress = getAddressEncoder();
const text = (value: string) => new TextEncoder().encode(value);
const discriminator = (name: string) =>
  createHash("sha256").update(name).digest().subarray(0, 8);
const number = (value: number | bigint, size: number) => {
  const out = Buffer.alloc(size);
  if (size === 8) out.writeBigUInt64LE(BigInt(value));
  else out.writeUIntLE(Number(value), 0, size);
  return out;
};
const concat = (...parts: readonly (ReadonlyUint8Array | readonly number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));
const meta = (address: Address, role: AccountRole = AccountRole.READONLY) => ({
  address,
  role,
});
const pda = async (...seeds: ReadonlyUint8Array[]) =>
  (await getProgramDerivedAddress({ programAddress: SQUADS, seeds }))[0];
type TestClient = Awaited<ReturnType<typeof createMarketplaceFixture>>["client"];

/** Local trusted global bootstrap only; multisig/proposal state is created by Squads itself. */
export async function createSquads(
  client: TestClient,
  payer: TransactionSigner,
  options: { threshold?: number; timeLock?: number; controlled?: boolean } = {},
) {
  const binary = process.env.KATHA_TEST_SQUADS_SO;
  if (!binary) throw new Error("Run pnpm program:test for the pinned Squads fixture");
  client.svm.addProgramFromFile(SQUADS, binary);
  const programConfig = await pda(text("multisig"), text("program_config"));
  if (!client.svm.getAccount(programConfig).exists) {
    const data = concat(
      discriminator("account:ProgramConfig"),
      encodeAddress.encode(payer.address),
      number(0, 8),
      encodeAddress.encode(payer.address),
      new Uint8Array(64),
    );
    client.svm.setAccount({
      address: programConfig,
      programAddress: SQUADS,
      data,
      executable: false,
      lamports: lamports(10_000_000n),
      space: BigInt(data.length),
    });
  }
  const members = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  members.sort((a, b) =>
    Buffer.compare(
      Buffer.from(encodeAddress.encode(a.address)),
      Buffer.from(encodeAddress.encode(b.address)),
    ),
  );
  for (const member of members)
    client.svm.airdrop(member.address, lamports(1_000_000_000n));
  const memberAddresses = members.map((member) => member.address) as [
    Address,
    Address,
    Address,
  ];
  const createKey = await generateKeyPairSigner();
  const multisig = await pda(
    text("multisig"),
    text("multisig"),
    encodeAddress.encode(createKey.address),
  );
  const vault = await pda(
    text("multisig"),
    encodeAddress.encode(multisig),
    text("vault"),
    Uint8Array.of(0),
  );
  const controlled = options.controlled === true;
  const create: Instruction = {
    programAddress: SQUADS,
    accounts: [
      meta(programConfig),
      meta(payer.address, AccountRole.WRITABLE),
      meta(multisig, AccountRole.WRITABLE),
      meta(createKey.address, AccountRole.READONLY_SIGNER),
      meta(payer.address, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM),
    ],
    data: concat(
      discriminator("global:multisig_create_v2"),
      controlled ? concat([1], encodeAddress.encode(payer.address)) : [0],
      number(options.threshold ?? 2, 2),
      number(3, 4),
      ...memberAddresses.map((member) => concat(encodeAddress.encode(member), [7])),
      number(options.timeLock ?? 0, 4),
      [0, 0],
    ),
  };
  await client.sendTransaction([addSignersToInstruction([payer, createKey], create)]);
  client.svm.airdrop(vault, lamports(100_000_000n));
  let transactionIndex = 0n;
  async function propose(
    instructions: readonly Instruction[],
    extraSigners: readonly TransactionSigner[] = [],
  ) {
    transactionIndex++;
    const index = transactionIndex;
    const transaction = await pda(
      text("multisig"),
      encodeAddress.encode(multisig),
      text("transaction"),
      number(index, 8),
    );
    const proposal = await pda(
      text("multisig"),
      encodeAddress.encode(multisig),
      text("transaction"),
      number(index, 8),
      text("proposal"),
    );
    const { message, remainingAccounts } = compileSquadsMessage(vault, instructions);
    const creator = members[0]!;
    await client.sendTransaction([
      addSignersToInstruction([creator, payer], {
        programAddress: SQUADS,
        accounts: [
          meta(multisig, AccountRole.WRITABLE),
          meta(transaction, AccountRole.WRITABLE),
          meta(creator.address, AccountRole.READONLY_SIGNER),
          meta(payer.address, AccountRole.WRITABLE_SIGNER),
          meta(SYSTEM),
        ],
        data: concat(
          discriminator("global:vault_transaction_create"),
          [0, 0],
          number(message.length, 4),
          message,
          [0],
        ),
      }),
      addSignersToInstruction([creator, payer], {
        programAddress: SQUADS,
        accounts: [
          meta(multisig),
          meta(proposal, AccountRole.WRITABLE),
          meta(creator.address, AccountRole.READONLY_SIGNER),
          meta(payer.address, AccountRole.WRITABLE_SIGNER),
          meta(SYSTEM),
        ],
        data: concat(discriminator("global:proposal_create"), number(index, 8), [0]),
      }),
    ]);
    async function approve(member = members[0]!) {
      await client.sendTransaction([
        addSignersToInstruction([member], {
          programAddress: SQUADS,
          accounts: [
            meta(multisig),
            meta(member.address, AccountRole.WRITABLE_SIGNER),
            meta(proposal, AccountRole.WRITABLE),
          ],
          data: concat(discriminator("global:proposal_approve"), [0]),
        }),
      ]);
    }
    async function execute(prefix: readonly Instruction[] = []) {
      const remaining = remainingAccounts;
      const execution = addSignersToInstruction([creator, ...extraSigners], {
        programAddress: SQUADS,
        accounts: [
          meta(multisig),
          meta(proposal, AccountRole.WRITABLE),
          meta(transaction),
          meta(creator.address, AccountRole.READONLY_SIGNER),
          ...remaining,
        ],
        data: discriminator("global:vault_transaction_execute"),
      });
      // Failed LiteSVM transactions also enter its signature cache. Each explicit
      // test attempt gets a fresh blockhash so rejection exercises program state.
      client.svm.expireBlockhash();
      await client.sendTransaction([...prefix, execution]);
    }
    return { approve, execute, proposal, transaction };
  }
  if (!options.controlled && (options.threshold ?? 2) === 2) {
    const account = client.svm.getAccount(multisig);
    if (!account.exists || (await inspectSquadsVault(account, 0)).vault !== vault)
      throw new Error("Squads review adapter rejected the genuine fixture");
  }
  return { multisig, vault, members, memberAddresses, propose };
}

/** Real loader instruction, included atomically with the accepting Squads execution. */
export function transferUpgradeAuthority(
  programData: Address,
  current: TransactionSigner,
  next: Address,
): Instruction {
  return addSignersToInstruction([current], {
    programAddress: LOADER,
    accounts: [
      meta(programData, AccountRole.WRITABLE),
      meta(current.address, AccountRole.READONLY_SIGNER),
      meta(next),
    ],
    data: number(4, 4),
  });
}
