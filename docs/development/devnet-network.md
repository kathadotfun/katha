# Verified Devnet configuration

[network.json](../../config/devnet/network.json) records public deployment and
bootstrap facts. Registry initialization finalized at slot **509937161** and
Marketplace initialization at **509938040**. The final program/mint snapshot was
read at finalized slot **509938589**. This is a verification snapshot, not a live
health check or a completed artwork demonstration.

| Account                   | Public address                                 |
| ------------------------- | ---------------------------------------------- |
| Registry program          | `Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr` |
| Registry configuration    | `Dvyw1uy7pF6hXv3beBKYq7RLeeJkbRRpuZcNnmALoQHs` |
| Collection authority PDA  | `AkCfnp44oqqgdoHU65kYAfCD8Gj4KXu3aKwHHKRvZnWW` |
| Marketplace program       | `B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq` |
| Marketplace configuration | `55UWqsPB5Rr4KhQSGT25i7xS2eiFo2RpjiUgJz3Frint` |
| Core collection           | `D2zNLnTqoFZPSCqVLiQAPMXbeoNoLABkh3t6jjoMBUUi` |
| Classic SPL test mint     | `21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam` |

Both program upgrade authorities, the platform authority, administrative roles,
and test treasury are `DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR`.
This shared-wallet setup is for the demonstration. The CLI deployment wallet
`J8a1REuSLoviz2iyfmM8hL51ouXtG88PnUNJBFF3sPgt` retains the test token's mint
authority; it no longer has authority to upgrade either program. Signing
credentials are outside this repository. Public addresses are not signing keys.

The test mint has six decimals and no freeze authority. Payments use this mint,
not SOL. It represents test balances with no cash value. Marketplace settings
are 250 basis points commission, 500 basis points secondary royalty, and
2,592,000 seconds (30 days) inspection validity. These are development settings.

The manifest includes successful finalized deployment/bootstrap signatures,
canonical account relationships and exact deployed ELF byte lengths/SHA-256
hashes. Core collection metadata is pinned to a public Git commit and its bytes
were compared with the repository file. Both configurations are already
initialized; **do not repeat collection creation or singleton initialization**.
The `bootstrapInputs` object records the accepted public inputs, not a command
to run initialization again.

## Use this deployment locally

Follow [application and worker configuration](devnet-deployment.md#configure-the-application-and-worker).
Use the role address above in the ignored API allowlists. Select a fresh database
for the Devnet demonstration; preserve existing localnet data. Generated clients
already use these program IDs, so no manual client edits are needed.

Application, storage, database and worker services run locally or on the operator's
LAN. This record does not deploy a website to `katha.fun`. Artwork photographs,
private evidence, shipping details and signing credentials are not in the manifest.
Artist onboarding, payout binding, collector test balances, physical inspection,
tag writing, primary purchase and resale still require the demonstration workflow.

Read-only checks:

```bash
pnpm devnet:test
pnpm devnet:plan -- helper/devnet/bootstrap.json
solana --url devnet program show Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr
solana --url devnet program show B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq
spl-token --url devnet display 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam
```

For a fresh checkout, save the manifest's `bootstrapInputs` object as an ignored
local file before using the plan command. The plan does not contact the network
or submit transactions. Confirm live finalized account state before operating;
Devnet accounts, program upgrades and RPC availability can change after this snapshot.
