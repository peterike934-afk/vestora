// lib/wallet.js
//
// This is the file that actually MOVES MONEY. Unlike lib/blockchain.js
// (which only READS the blockchain to verify deposits), everything here
// signs and broadcasts real transactions using your platform's private
// keys. Treat every function in this file as high-stakes.
//
// Safety rules enforced here, before any key is loaded or any network is
// contacted:
//   - sendCryptoPayout refuses unless WITHDRAWAL_PAYOUTS_ENABLED is exactly
//     'true' (lib/financial-controls.js). The database switch and the valid
//     funds hold are enforced separately by claim_transaction_for_approval.
//   - BLOCKCHAIN_NETWORK must be exactly 'mainnet' or 'testnet'
//     (lib/blockchain-network.js); there is no silent mainnet default.
//   - the destination address is validated for that network.
// After a transaction is broadcast, onBroadcast(txHash) is called BEFORE
// waiting for confirmation, so the hash is recorded even if the wait fails
// or the function is stopped; an already-broadcast payment then can never
// be sent again by mistake.

import { ethers } from "ethers";
import { sendBtc, getBtcHotWalletBalance, isValidBtcAddress } from "./wallet-btc";
import { networkConfig, USDT_DECIMALS } from "./blockchain-network";
import { assertWithdrawalPayoutsEnabled } from "./financial-controls";

// How long to wait for the first confirmation before reporting the outcome
// as uncertain (the transaction may still confirm later).
const CONFIRMATION_TIMEOUT_MS = 40_000;

// Minimal ERC-20 ABI — we only need the "transfer" function, nothing else.
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

function getEthProvider() {
  // Uses your Infura project as the RPC endpoint — this is how your server
  // actually talks to the Ethereum network to broadcast transactions.
  const { infuraSubdomain } = networkConfig();
  const infuraKey = process.env.INFURA_API_KEY;
  if (!infuraKey) {
    throw new Error("INFURA_API_KEY is not set — needed to broadcast transactions");
  }
  return new ethers.JsonRpcProvider(`https://${infuraSubdomain}.infura.io/v3/${infuraKey}`);
}

function getEthSigner() {
  const privateKey = process.env.PLATFORM_ETH_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PLATFORM_ETH_PRIVATE_KEY is not set on the server");
  }
  const provider = getEthProvider();
  return new ethers.Wallet(privateKey, provider);
}

/** True if `address` is a valid destination for `currency` on the configured network. */
export function isValidPayoutAddress(currency, address) {
  if (typeof address !== "string" || !address.trim()) return false;
  if (currency === "ETH" || currency === "USDT") return ethers.isAddress(address.trim());
  if (currency === "BTC") return isValidBtcAddress(address.trim());
  return false;
}

// Records the hash, then waits for one confirmation. Any failure after the
// broadcast carries txHash so the caller marks the payment uncertain.
async function confirmBroadcast(tx, onBroadcast) {
  if (onBroadcast) {
    // A recording problem must not hide the hash: it travels with any error below.
    try { await onBroadcast(tx.hash); } catch { /* the caller keeps the claim processing */ }
  }
  try {
    const receipt = await tx.wait(1, CONFIRMATION_TIMEOUT_MS);
    if (!receipt || receipt.status !== 1) {
      throw new Error("Transaction was broadcast but did not succeed on-chain");
    }
  } catch (err) {
    err.txHash = tx.hash;
    err.broadcast = true;
    throw err;
  }
  return { txHash: tx.hash };
}

/**
 * Sends real ETH from the platform wallet to a user's address.
 * @param {string} toAddress
 * @param {string} amountEth  decimal string (at most 18 decimals)
 */
export async function sendEth(toAddress, amountEth, { onBroadcast } = {}) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error("Invalid destination address");
  }
  const signer = getEthSigner();
  const tx = await signer.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amountEth.toString()),
  });
  return confirmBroadcast(tx, onBroadcast);
}

/**
 * Sends real USDT (ERC-20) from the platform wallet to a user's address.
 * @param {string} toAddress
 * @param {string} amountUsdt  decimal string (at most 6 decimals)
 */
export async function sendUsdt(toAddress, amountUsdt, { onBroadcast } = {}) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error("Invalid destination address");
  }
  const { usdtContract } = networkConfig();
  if (!usdtContract) {
    throw new Error("No USDT contract configured for this network");
  }
  const signer = getEthSigner();
  const contract = new ethers.Contract(usdtContract, ERC20_ABI, signer);
  const amountUnits = ethers.parseUnits(amountUsdt.toString(), USDT_DECIMALS);
  const tx = await contract.transfer(toAddress, amountUnits);
  return confirmBroadcast(tx, onBroadcast);
}

/**
 * Checks the platform's hot wallet balance for a currency, so we can
 * refuse a withdrawal BEFORE attempting it if there isn't enough to cover
 * it — rather than failing halfway through and leaving things unclear.
 * Read-only; needs no switch, but does need an explicit network.
 */
export async function getHotWalletBalance(currency) {
  if (currency === "BTC") {
    return getBtcHotWalletBalance();
  }

  const provider = getEthProvider();
  const address = process.env.PLATFORM_ETH_ADDRESS;
  if (!address) {
    throw new Error("PLATFORM_ETH_ADDRESS is not set on the server");
  }

  if (currency === "ETH") {
    const balance = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  }

  if (currency === "USDT") {
    const { usdtContract } = networkConfig();
    if (!usdtContract) throw new Error("No USDT contract configured for this network");
    const contract = new ethers.Contract(usdtContract, ["function balanceOf(address) view returns (uint256)"], provider);
    const balance = await contract.balanceOf(address);
    return parseFloat(ethers.formatUnits(balance, USDT_DECIMALS));
  }

  throw new Error(`getHotWalletBalance: unsupported currency ${currency}`);
}

/**
 * Single entry point the API route calls. Refuses before loading any key
 * unless withdrawal payouts are enabled, the network is explicit and the
 * address is valid for it; then routes to the right sender.
 * @returns {Promise<{txHash: string}>}
 */
export async function sendCryptoPayout(currency, toAddress, amount, { onBroadcast } = {}) {
  assertWithdrawalPayoutsEnabled();
  networkConfig(); // throws unless BLOCKCHAIN_NETWORK is 'mainnet' or 'testnet'
  if (!["ETH", "USDT", "BTC"].includes(currency)) throw new Error(`Unsupported currency: ${currency}`);
  if (!isValidPayoutAddress(currency, toAddress)) throw new Error(`Invalid ${currency} destination address for this network`);
  if (currency === "ETH") return sendEth(toAddress, amount, { onBroadcast });
  if (currency === "USDT") return sendUsdt(toAddress, amount, { onBroadcast });
  return sendBtc(toAddress, amount, { onBroadcast });
}
