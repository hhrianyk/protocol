/**
 * Configuration for supported blockchains
 */

const blockchains = {
  ethereum: {
    name: 'Ethereum',
    shortName: 'ETH',
    chainId: 1,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: [
      process.env.ETHEREUM_RPC_URL || 'https://mainnet.infura.io/v3/your-api-key'
    ],
    blockExplorerUrls: ['https://etherscan.io'],
    tokenTypes: ['ERC20', 'ERC721', 'ERC1155'],
    icon: '/images/chains/ethereum.svg',
    enabled: true
  },
  tron: {
    name: 'TRON',
    shortName: 'TRX',
    isLayer1: true,
    nativeCurrency: {
      name: 'TRON',
      symbol: 'TRX',
      decimals: 6
    },
    rpcUrls: [
      process.env.TRON_RPC_URL || 'https://api.trongrid.io'
    ],
    blockExplorerUrls: ['https://tronscan.org'],
    tokenTypes: ['TRC10', 'TRC20'],
    icon: '/images/chains/tron.svg',
    enabled: true
  },
  binanceSmartChain: {
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    chainId: 56,
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18
    },
    rpcUrls: [
      process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'
    ],
    blockExplorerUrls: ['https://bscscan.com'],
    tokenTypes: ['BEP20'],
    icon: '/images/chains/binance.svg',
    enabled: true
  },
  polygon: {
    name: 'Polygon',
    shortName: 'MATIC',
    chainId: 137,
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    },
    rpcUrls: [
      process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
    ],
    blockExplorerUrls: ['https://polygonscan.com'],
    tokenTypes: ['MATIC'],
    icon: '/images/chains/polygon.svg',
    enabled: true
  },
  solana: {
    name: 'Solana',
    shortName: 'SOL',
    isLayer1: true,
    nativeCurrency: {
      name: 'SOL',
      symbol: 'SOL',
      decimals: 9
    },
    rpcUrls: [
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    ],
    blockExplorerUrls: ['https://explorer.solana.com'],
    tokenTypes: ['SPL'],
    icon: '/images/chains/solana.svg',
    enabled: true
  },
  avalanche: {
    name: 'Avalanche',
    shortName: 'AVAX',
    chainId: 43114,
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18
    },
    rpcUrls: [
      process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'
    ],
    blockExplorerUrls: ['https://snowtrace.io'],
    tokenTypes: ['AVAX'],
    icon: '/images/chains/avalanche.svg',
    enabled: true
  },
  optimism: {
    name: 'Optimism',
    shortName: 'OP',
    chainId: 10,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: [
      process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
    ],
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
    tokenTypes: ['ERC20'],
    icon: '/images/chains/optimism.svg',
    isLayer2: true,
    parentChain: 'ethereum',
    enabled: true
  },
  arbitrum: {
    name: 'Arbitrum',
    shortName: 'ARB',
    chainId: 42161,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: [
      process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
    ],
    blockExplorerUrls: ['https://arbiscan.io'],
    tokenTypes: ['ERC20'],
    icon: '/images/chains/arbitrum.svg',
    isLayer2: true,
    parentChain: 'ethereum',
    enabled: true
  }
};

module.exports = blockchains; 