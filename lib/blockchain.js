// lib/blockchain.js
//
// Verifies a user-submitted crypto transaction against the real blockchain,
// instead of trusting the amount/hash the user typed into the deposit form.
//
// Exports one function: verifyTransaction(currency, txHash, expectedAddress, expectedAmount)
// Returns a plain object describing what was actually found on-chain, which the
// admin panel can show next to the user's claim before anyone clicks Verify.

const ETHERSCAN_API = "https://api.etherscan.io/api";
const BLOCKSTREAM_API = "https://blockstream.info/api";

// USDT on Ethereum (ERC-20). 6 decimals, not 18 — this trips people up constantly.
const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec";
const USDT_DECIMALS = 6;
const ETH_DECIMALS = 18;

// How many confirmations we consider "safe" before treating a deposit as final.
// Ethereum finalizes faster than Bitcoin; these are reasonable, commonly used minimums.
const REQUIRED_CONFIRMATIONS = {
  ETH: 12,
  USDT: 12,
  BTC: 3,
};

function hexToDecimalString(hex, decimals) {
  // Converts a hex wei/token value (e.g. "0x1bc16d674ec80000") into a human amount.
  const raw = BigInt(hex);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

async function verifyEthOrUsdt(currency, txHash, expectedAddress) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    throw new Error("ETHERSCAN_API_KEY is not set on the server");
  }

  // 1. Pull the transaction itself.
  const txRes = await fetch(
    `${ETHERSCAN_API}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`
  );
  const txData = await txRes.json();
  const tx = txData.result;

  if (!tx) {
    return { found: false, reason: "Transaction hash not found on Ethereum" };
  }

  // 2. Pull the receipt — this tells us if it actually succeeded, and (for USDT)
  //    contains the token-transfer log we need to read the real amount from.
  const receiptRes = await fetch(
    `${ETHERSCAN_API}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`
  );
  const receiptData = await receiptRes.json();
  const receipt = receiptData.result;

  if (!receipt || receipt.status !== "0x1") {
    return { found: true, succeeded: false, reason: "Transaction failed or is still pending" };
  }

  // 3. Figure out confirmations by comparing the tx's block to the current tip.
  const blockNumRes = await fetch(
    `${ETHERSCAN_API}?module=proxy&action=eth_blockNumber&apikey=${apiKey}`
  );
  const blockNumData = await blockNumRes.json();
  const currentBlock = parseInt(blockNumData.result, 16);
  const txBlock = parseInt(tx.blockNumber, 16);
  const confirmations = currentBlock - txBlock;

  let amount, recipient;

  if (currency === "ETH") {
    // Plain ETH transfer: amount and recipient are right on the transaction.
    amount = hexToDecimalString(tx.value, ETH_DECIMALS);
    recipient = tx.to;
  } else {
    // USDT: the ETH-level "to" is the USDT contract, not the recipient.
    // The real transfer details live in a Transfer event log on the receipt.
    const transferLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === USDT_CONTRACT.toLowerCase()
    );

    if (!transferLog) {
      return { found: true, succeeded: true, reason: "No USDT transfer found in this transaction" };
    }

    // Transfer(address indexed from, address indexed to, uint256 value)
    // topics[2] is the recipient, padded to 32 bytes — take the last 40 hex chars.
    recipient = "0x" + transferLog.topics[2].slice(-40);
    amount = hexToDecimalString(transferLog.data, USDT_DECIMALS);
  }

  const matchesAddress = recipient?.toLowerCase() === expectedAddress?.toLowerCase();

  return {
    found: true,
    succeeded: true,
    amount,
    recipient,
    matchesAddress,
    confirmations,
    confirmed: confirmations >= REQUIRED_CONFIRMATIONS[currency],
  };
}

async function verifyBtc(txHash, expectedAddress) {
  const txRes = await fetch(`${BLOCKSTREAM_API}/tx/${txHash}`);
  if (txRes.status === 404) {
    return { found: false, reason: "Transaction hash not found on Bitcoin" };
  }
  const tx = await txRes.json();

  // Sum up every output that pays the expected address — a single tx can have
  // multiple outputs, and only some may go to us.
  const matchingOutputs = tx.vout.filter(
    (out) => out.scriptpubkey_address === expectedAddress
  );
  const totalSats = matchingOutputs.reduce((sum, out) => sum + out.value, 0);
  const amount = (totalSats / 1e8).toString(); // satoshis -> BTC

  const statusRes = await fetch(`${BLOCKSTREAM_API}/tx/${txHash}/status`);
  const status = await statusRes.json();

  let confirmations = 0;
  if (status.confirmed) {
    const tipRes = await fetch(`${BLOCKSTREAM_API}/blocks/tip/height`);
    const tipHeight = parseInt(await tipRes.text(), 10);
    confirmations = tipHeight - status.block_height + 1;
  }

  return {
    found: true,
    succeeded: true,
    amount,
    matchesAddress: matchingOutputs.length > 0,
    confirmations,
    confirmed: confirmations >= REQUIRED_CONFIRMATIONS.BTC,
  };
}

/**
 * Checks a user-submitted transaction against the real blockchain.
 *
 * @param {"ETH"|"USDT"|"BTC"} currency
 * @param {string} txHash - what the user submitted
 * @param {string} expectedAddress - your platform's deposit address for this currency
 * @param {number|string} claimedAmount - what the user says they sent, for comparison
 * @returns {Promise<object>} structured verification result
 */
export async function verifyTransaction(currency, txHash, expectedAddress, claimedAmount) {
  if (!txHash || !expectedAddress) {
    return { found: false, reason: "Missing transaction hash or deposit address" };
  }

  let result;
  try {
    if (currency === "ETH" || currency === "USDT") {
      result = await verifyEthOrUsdt(currency, txHash, expectedAddress);
    } else if (currency === "BTC") {
      result = await verifyBtc(txHash, expectedAddress);
    } else {
      return { found: false, reason: `Unsupported currency: ${currency}` };
    }
  } catch (err) {
    console.error(`Blockchain verification error (${currency}, ${txHash}):`, err);
    return { found: false, reason: "Verification request failed — try again" };
  }

  if (!result.found || !result.succeeded) {
    return { ...result, amountMatches: false };
  }

  // Compare on-chain amount to what the user claimed, with a small tolerance
  // for floating point / gas-adjacent rounding noise.
  const onChain = parseFloat(result.amount);
  const claimed = parseFloat(claimedAmount);
  const amountMatches = Math.abs(onChain - claimed) < 0.000001;

  return { ...result, amountMatches, claimedAmount: claimed };
}