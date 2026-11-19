# Examples

| File | What it shows | Signs or sends? |
|---|---|---|
| `node-quote.mjs` | A quote from Node, with amounts converted exactly | No |
| `find-asset.mjs` | Look up asset ids by name | No |
| `referral-platform.mjs` | A platform's referral flow start to finish: status, opening assets, opt-ins, what a referred swap pays, claiming; simulates every group | Only with `--send` |
| `lp.mjs` | LP deposit (two-sided, one-sided) and withdraw quotes on a STAMM pool | No |
| `my-swap.mjs` | Swap from your own account: shows the quote, asks before sending | **Yes**, after you answer `y` (or with `--yes`) |
| `compose-before-swap.mjs` | Your own payment in the same atomic group, before the swap | Only with `--send` |
| `after-swap.mjs` | Use the swap's output in the same atomic group, sized to the guaranteed minimum; simulates first | Only with `--send` |
| `node-bot-sign.mjs` | A backend that quotes, builds, signs with its own key and submits | **Yes**, a real mainnet swap (`DRY_RUN=1` stops before signing) |
| `use-wallet-react.jsx` | A React swap box with Pera, Defly and Lute through use-wallet | Yes, when the user approves in their wallet |

Run the Node ones from the repo root, e.g. `node examples/node-quote.mjs 25`.
