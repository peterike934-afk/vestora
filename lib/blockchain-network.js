// Which blockchain network Vestora uses, decided in ONE place.
//
// BLOCKCHAIN_NETWORK must be set explicitly to 'mainnet' (real money) or
// 'testnet' (Sepolia / Bitcoin testnet). Anything else (missing, empty,
// 'Mainnet', 'prod', ...) is refused: there is no silent default, so a
// missing setting can never send real funds by accident.
//
// Read on every call, never cached at module load.

// Tether USD (USDT) ERC-20 on Ethereum mainnet. Verified 2026-11-23 against
// tether.to/en/supported-protocols, the Etherscan token page ("Tether USD
// (USDT)", 6 decimals, verified source) and CoinGecko; EIP-55 checksum valid.
export const USDT_MAINNET_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
export const USDT_DECIMALS = 6

export class BlockchainNetworkError extends Error {}

export function getBlockchainNetwork(env = process.env) {
  const value = env?.BLOCKCHAIN_NETWORK
  if (value === 'mainnet' || value === 'testnet') return value
  throw new BlockchainNetworkError("BLOCKCHAIN_NETWORK must be set to exactly 'mainnet' or 'testnet'; refusing to guess.")
}

// Per-network endpoints and contracts.
export function networkConfig(env = process.env) {
  const network = getBlockchainNetwork(env)
  const testnet = network === 'testnet'
  return {
    network,
    ethChainId: testnet ? 11155111 : 1,
    infuraSubdomain: testnet ? 'sepolia' : 'mainnet',
    etherscanApi: testnet ? 'https://api-sepolia.etherscan.io/api' : 'https://api.etherscan.io/api',
    blockstreamApi: testnet ? 'https://blockstream.info/testnet/api' : 'https://blockstream.info/api',
    usdtContract: testnet ? (env.SEPOLIA_USDT_CONTRACT || null) : USDT_MAINNET_CONTRACT,
  }
}
