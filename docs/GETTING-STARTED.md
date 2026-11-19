# Getting started: your first swap from your own computer

This walks you through swapping on HogSwap with a script on your own computer, from nothing
installed to a confirmed swap. You don't need to be a developer. You'll copy a few commands into a
terminal, and the script always shows you the deal and asks before it sends anything.

If you just want to swap in a browser, use a site or wallet that offers HogSwap. This guide is for
running it yourself.

## What you need

- A computer with Windows, macOS or Linux.
- An Algorand account with some ALGO in it. Pera, Defly or Lute all work.
- About 15 minutes.

## 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and install it with the
default options. Then open a terminal:

- **Windows:** Start menu, type `PowerShell`, open it.
- **macOS:** Spotlight (Cmd+Space), type `Terminal`, open it.
- **Linux:** your Terminal app.

Check it worked. This should print a version number, 18 or higher:

```sh
node --version
```

## 2. Get the SDK

Download this repository as a ZIP from its GitHub page (**Code**, then **Download ZIP**) and unzip
it somewhere you'll find it. Or, if you use git:

```sh
git clone https://github.com/LiquiHog/hogswap-v3-js-sdk.git
```

In the terminal, go into the folder and install the one library the examples need for signing:

```sh
cd path/to/hogswap-v3-js-sdk
npm install --no-save algosdk
```

## 3. Try a quote (nothing is sent)

```sh
node examples/node-quote.mjs 10
```

You should see what 10 ALGO buys in USDC right now. If you do, everything is installed.

## 4. Use a separate account for scripts

A script signs with your account's 25-word recovery phrase (mnemonic), so it has full control of
that account. Keep the risk small:

1. In your wallet app, **create a new account** just for this.
2. **Send it only what you plan to trade**, plus a little ALGO for fees (1 ALGO is plenty to
   start).
3. Find its 25 words in your wallet's account settings (often under "view passphrase" or
   "export"). Never share them, and never paste them into a website or chat.

## 5. Give the words to this terminal only

Load them into the terminal session, so they're never saved in a file or your command history.
They're forgotten when you close the terminal.

**Windows (PowerShell):**

```powershell
$env:MY_MNEMONIC = Read-Host "Paste your 25 words"
```

**macOS / Linux:**

```sh
printf 'Paste your 25 words: '; read -s MY_MNEMONIC; export MY_MNEMONIC; echo
```

Paste and press Enter. On macOS and Linux nothing shows as you paste; that's normal. On Windows
the words stay on screen, so type `cls` and press Enter afterwards to clear them.

## 6. Find the asset you want

Every Algorand asset has a number (its asset id). ALGO is `0`, USDC is `31566704` and HOG is
`3178895177`. For anything else, search by name:

```sh
node examples/find-asset.mjs gold
```

Names can be copied by anyone, so check the id matches the one your wallet or an explorer such as
[allo.info](https://allo.info) shows for the real asset.

## 7. Opt in to the asset you're buying

On Algorand, an account must opt in to an asset before it can hold it. In your wallet app, open
the script account, choose **Add asset** (or similar), search for the id, and confirm. It costs a
tiny fee and sets aside 0.1 ALGO, which you get back if you opt out later. ALGO itself never needs
an opt-in.

## 8. Your first swap

Start small. This swaps 1 ALGO for USDC:

```sh
node examples/my-swap.mjs 0 31566704 1
```

The script shows the deal and waits:

```text
swap      1 ALGO -> 0.078439 USDC
at least  0.07796 USDC (or the swap reverts)
fees      router 0.000039 USDC, network up to 0.029 ALGO
route     STAMM, Pact Weighted (2 legs, 3 txns)
send it? [y/N]
```

- **swap:** what you should receive.
- **at least:** the least you'll accept. If the price moves further than that before your swap
  lands, the whole swap is refused and nothing happens: you keep your ALGO and pay no fee.
- **fees:** the router's fee (already taken out of the amount shown) and the most the network
  fees can be. Routes through several pools cost more network fee, so on very small swaps the
  network fee can be a noticeable share.
- **route:** where the swap goes.

Type `y` and press Enter to send, or just Enter to stop. When it's done, it prints
`confirmed in round <number>: <transaction id>`. Paste that id into an explorer to see it.

The amount is in whole tokens: `1` is 1 ALGO, `0.5` is half. The first two numbers are the asset
ids you sell and buy, so `node examples/my-swap.mjs 31566704 0 5` sells 5 USDC for ALGO.

## If something goes wrong

| You see | What it means | What to do |
|---|---|---|
| `set MY_MNEMONIC` | The terminal doesn't have your words | Do step 5 again (it resets when you close the terminal) |
| `opt in to asset(s) … first` | Your account can't hold what you're buying yet | Step 7 |
| `no route` | No pool can fill this swap right now | Try a smaller amount, or a different asset |
| `overspend` or `balance … below min` | Not enough ALGO left after the swap and fees | Add ALGO, or swap a little less. Every account keeps 0.1 ALGO, plus 0.1 per asset it holds |
| `429` or `rate limit` | Too many requests in a short time | Wait 10 seconds |
| The quote looks wrong | | Answer `n`. Nothing happens until you type `y` |

## Staying safe

- **Nobody from HogSwap will ever ask for your 25 words.** The script uses them only on your
  computer to sign. They're never sent anywhere.
- Keep the script account small, and move profits back to your main account.
- Only run scripts you got from this repository, or ones you've read.

## Next

- [PERSONAL-USE.md](PERSONAL-USE.md): repeating a trade, liquidity, and writing your own scripts.
- [ROUTING-OPTIONS.md](ROUTING-OPTIONS.md): slippage, avoiding certain venues, and route limits.
