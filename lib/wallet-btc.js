// lib/wallet-btc.js
//
// Separate from lib/wallet.js because Bitcoin's transaction model is
// fundamentally different from Ethereum's — it's UTXO-based (you spend
// specific "coins" you've received, not draw from a running balance),
// so it needs its own logic for selecting what to spend, calculating
// change, and signing.
//
// Uses the same BLOCKCHAIN_NETWORK switch as lib/blockchain.js and
// lib/wallet.js — testnet uses Bitcoin's testnet, not Sepolia (Sepolia
// is Ethereum-only; Bitcoin has its own separate test network).

import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "@bitcoinerlab/secp256k1";

const ECPair = ECPairFactory(ecc);

const NETWORK = process.env.BLOCKCHAIN_NETWORK === "testnet" ? "testnet" : "mainnet";
const BTC_NETWORK = NETWORK === "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
const BLOCKSTREAM_API =
  NETWORK === "testnet"
    ? "https://blockstream.info/testnet/api"
    : "https://blockstream.info/api";

// Conservative fallback fee rate (satoshis per virtual byte) if the
// live fee-estimate API call fails for any reason — better to slightly
// overpay than to have a withdrawal silently fail.
const FALLBACK_FEE_RATE = 20;

function getPlatformKeyPair() {
  const wif = process.env.PLATFORM_BTC_PRIVATE_KEY;
  if (!wif) {
    throw new Error("PLATFORM_BTC_PRIVATE_KEY is not set on the server");
  }
  return ECPair.fromWIF(wif, BTC_NETWORK);
}

function getPlatformAddress() {
  const address = process.env.PLATFORM_BTC_ADDRESS;
  if (!address) {
    throw new Error("PLATFORM_BTC_ADDRESS is not set on the server");
  }
  return address;
}

async function getUtxos(address) {
  const res = await fetch(`${BLOCKSTREAM_API}/address/${address}/utxo`);
  if (!res.ok) throw new Error(`Failed to fetch UTXOs: ${res.status}`);
  return res.json();
}

async function getFeeRate() {
  try {
    const res = await fetch(`${BLOCKSTREAM_API}/fee-estimates`);
    const estimates = await res.json();
    // "6" = target confirmation within ~6 blocks (~1 hour) — a
    // reasonable default, not the cheapest/slowest option.
    return Math.ceil(estimates["6"] || FALLBACK_FEE_RATE);
  } catch (err) {
    console.error("Failed to fetch BTC fee estimate, using fallback:", err);
    return FALLBACK_FEE_RATE;
  }
}

// Rough transaction size estimate for fee calculation, based on typical
// single-sig P2WPKH (native SegWit) input/output sizes.
function estimateVBytes(numInputs, numOutputs) {
  return 10 + numInputs * 68 + numOutputs * 31;
}

/**
 * Checks the platform's BTC hot wallet balance by summing its UTXOs.
 */
export async function getBtcHotWalletBalance() {
  const address = getPlatformAddress();
  const utxos = await getUtxos(address);
  const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
  return totalSats / 1e8;
}

/**
 * Builds, signs, and broadcasts a real BTC transaction from the
 * platform wallet to a user's address.
 *
 * @param {string} toAddress
 * @param {number|string} amountBtc
 * @returns {Promise<{txHash: string}>}
 */
export async function sendBtc(toAddress, amountBtc) {
  const keyPair = getPlatformKeyPair();
  const fromAddress = getPlatformAddress();
  const amountSats = Math.round(Number(amountBtc) * 1e8);

  if (amountSats <= 0) {
    throw new Error("Withdrawal amount must be greater than zero");
  }

  const utxos = await getUtxos(fromAddress);
  if (utxos.length === 0) {
    throw new Error("Platform BTC wallet has no spendable funds");
  }

  const feeRate = await getFeeRate();

  // Select UTXOs one at a time (oldest/largest-first is fine here) until
  // we've covered the send amount plus an estimated fee. Simpler than
  // optimal coin selection, but correct and safe for this use case.
  let selected = [];
  let selectedTotal = 0;
  for (const utxo of utxos) {
    selected.push(utxo);
    selectedTotal += utxo.value;
    const estimatedFee = estimateVBytes(selected.length, 2) * feeRate; // 2 outputs: recipient + change
    if (selectedTotal >= amountSats + estimatedFee) break;
  }

  const finalFee = estimateVBytes(selected.length, 2) * feeRate;
  const changeSats = selectedTotal - amountSats - finalFee;

  if (changeSats < 0) {
    throw new Error(
      `Insufficient BTC balance — need ${(amountSats + finalFee) / 1e8} BTC (including fee), have ${selectedTotal / 1e8} BTC in selected UTXOs`
    );
  }

  // Fetch the full previous transaction for each UTXO — required to
  // sign a SegWit input correctly (witnessUtxo needs the output script + value).
  const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });

  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: BTC_NETWORK });

  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: p2wpkh.output,
        value: BigInt(utxo.value),
      },
    });
  }

  psbt.addOutput({ address: toAddress, value: BigInt(amountSats) });

  // Only add a change output if it's above the "dust" threshold —
  // sending back an amount smaller than ~546 sats isn't worth a
  // separate output and some nodes will reject it.
  if (changeSats > 546) {
    psbt.addOutput({ address: fromAddress, value: BigInt(changeSats) });
  }

  selected.forEach((_, i) => psbt.signInput(i, keyPair));
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();

  const broadcastRes = await fetch(`${BLOCKSTREAM_API}/tx`, {
    method: "POST",
    body: txHex,
  });

  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text();
    throw new Error(`Failed to broadcast BTC transaction: ${errText}`);
  }

  const txHash = await broadcastRes.text();
  return { txHash };
}