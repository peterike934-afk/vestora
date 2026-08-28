// lib/wallet.js
//
// This is the file that actually MOVES MONEY. Unlike lib/blockchain.js
// (which only READS the blockchain to verify deposits), everything here
// signs and broadcasts real transactions using your platform's private
// keys. Treat every function in this file as high-stakes.
//
// Uses the same BLOCKCHAIN_NETWORK env var as lib/blockchain.js to switch
// between Sepolia (testing) and mainnet (real money) — see that file for
// the full explanation of how that switch works.

import { ethers } from "ethers";
import { sendBtc, getBtcHotWalletBalance } from "./wallet-btc";

const NETWORK = process.env.BLOCKCHAIN_NETWORK === "testnet" ? "testnet" : "mainnet";

const ETH_CHAIN_ID = NETWORK === "testnet" ? 11155111 : 1; // Sepolia vs mainnet
const USDT_CONTRACT =
  NETWORK === "testnet"
    ? process.env.SEPOLIA_USDT_CONTRACT || null
    : "0xdAC17F958D2ee523a2206206994597C13D831ec";
const USDT_DECIMALS = 6;

// Minimal ERC-20 ABI — we only need the "transfer" function, nothing else.
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

function getEthProvider() {
  // Uses your Infura project (the same one you already set up for the
  // faucet/API key) as the RPC endpoint — this is how your server actually
  // talks to the Ethereum network to broadcast transactions.
  const infuraKey = process.env.INFURA_API_KEY;
  if (!infuraKey) {
    throw new Error("INFURA_API_KEY is not set — needed to broadcast transactions");
  }
  const subdomain = NETWORK === "testnet" ? "sepolia" : "mainnet";
  return new ethers.JsonRpcProvider(`https://${subdomain}.infura.io/v3/${infuraKey}`);
}

function getEthSigner() {
  const privateKey = process.env.PLATFORM_ETH_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PLATFORM_ETH_PRIVATE_KEY is not set on the server");
  }
  const provider = getEthProvider();
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Sends real ETH from the platform wallet to a user's address.
 * @param {string} toAddress
 * @param {number|string} amountEth
 * @returns {Promise<{txHash: string}>}
 */
export async function sendEth(toAddress, amountEth) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error("Invalid destination address");
  }

  const signer = getEthSigner();
  const tx = await signer.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amountEth.toString()),
  });

  // Wait for at least one confirmation before telling the caller it
  // succeeded — an unconfirmed tx could still be dropped from the mempool.
  await tx.wait(1);

  return { txHash: tx.hash };
}

/**
 * Sends real USDT (ERC-20) from the platform wallet to a user's address.
 * @param {string} toAddress
 * @param {number|string} amountUsdt
 * @returns {Promise<{txHash: string}>}
 */
export async function sendUsdt(toAddress, amountUsdt) {
  if (!ethers.isAddress(toAddress)) {
    throw new Error("Invalid destination address");
  }
  if (!USDT_CONTRACT) {
    throw new Error("No USDT contract configured for this network");
  }

  const signer = getEthSigner();
  const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, signer);

  const amountUnits = ethers.parseUnits(amountUsdt.toString(), USDT_DECIMALS);
  const tx = await contract.transfer(toAddress, amountUnits);
  await tx.wait(1);

  return { txHash: tx.hash };
}

/**
 * Checks the platform's hot wallet balance for a currency, so we can
 * refuse a withdrawal BEFORE attempting it if there isn't enough to cover
 * it — rather than failing halfway through and leaving things unclear.
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
    if (!USDT_CONTRACT) throw new Error("No USDT contract configured for this network");
    const contract = new ethers.Contract(USDT_CONTRACT, ["function balanceOf(address) view returns (uint256)"], provider);
    const balance = await contract.balanceOf(address);
    return parseFloat(ethers.formatUnits(balance, USDT_DECIMALS));
  }

  throw new Error(`getHotWalletBalance: unsupported currency ${currency}`);
}

/**
 * Single entry point the API route calls — routes to the right sender
 * based on currency and returns a consistent shape either way.
 */
export async function sendCryptoPayout(currency, toAddress, amount) {
  if (currency === "ETH") return sendEth(toAddress, amount);
  if (currency === "USDT") return sendUsdt(toAddress, amount);
  if (currency === "BTC") return sendBtc(toAddress, amount);
  throw new Error(`Unsupported currency: ${currency}`);
}