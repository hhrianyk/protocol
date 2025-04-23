const { ethers } = require('ethers');
const Web3 = require('web3');
const { Connection, PublicKey } = require('@solana/web3.js');
const { TronClient } = require('@tronscan/client');
const blockchains = require('../config/blockchains');
const fs = require('fs');
const path = require('path');

// Load ABI files
const contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/build/TrustWalletTokenImport.json'), 'utf8')).abi;

// Initialize providers and clients for each chain
const providers = {};
const contracts = {};

// Setup blockchain providers
Object.keys(blockchains).forEach(chain => {
  const chainConfig = blockchains[chain];
  
  if (!chainConfig.enabled) return;

  try {
    switch (chain) {
      case 'ethereum':
      case 'binanceSmartChain':
      case 'polygon':
      case 'avalanche':
      case 'optimism':
      case 'arbitrum':
        // For EVM compatible chains
        providers[chain] = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrls[0]);
        
        // If contract address exists for this chain, initialize contract
        const contractAddress = process.env[`${chain.toUpperCase()}_CONTRACT_ADDRESS`];
        if (contractAddress) {
          contracts[chain] = new ethers.Contract(contractAddress, contractABI, providers[chain]);
        }
        break;
        
      case 'tron':
        // For TRON network
        const tronClient = new TronClient({
          fullNode: chainConfig.rpcUrls[0],
          solidityNode: chainConfig.rpcUrls[0],
          eventServer: chainConfig.rpcUrls[0],
          headers: { "TRON-PRO-API-KEY": process.env.TRON_API_KEY }
        });
        providers[chain] = tronClient;
        
        // If contract address exists for TRON, initialize contract
        const tronContractAddress = process.env.TRON_CONTRACT_ADDRESS;
        if (tronContractAddress) {
          contracts[chain] = tronClient.contract(contractABI, tronContractAddress);
        }
        break;
        
      case 'solana':
        // For Solana network
        providers[chain] = new Connection(chainConfig.rpcUrls[0], 'confirmed');
        // Solana uses different contract methodology (Programs), so we don't initialize a contract here
        break;
        
      default:
        console.log(`No provider initialization for ${chain}`);
    }
  } catch (error) {
    console.error(`Error initializing provider for ${chain}:`, error);
  }
});

/**
 * Service for handling blockchain interactions
 */
const blockchainService = {
  /**
   * Get provider for specified blockchain
   * @param {string} chain - Blockchain identifier
   * @returns {Object} Provider instance
   */
  getProvider(chain) {
    if (!providers[chain]) {
      throw new Error(`Provider for ${chain} not initialized`);
    }
    return providers[chain];
  },
  
  /**
   * Get contract interface for specified blockchain
   * @param {string} chain - Blockchain identifier
   * @returns {Object} Contract instance
   */
  getContract(chain) {
    if (!contracts[chain]) {
      throw new Error(`Contract for ${chain} not initialized`);
    }
    return contracts[chain];
  },
  
  /**
   * Get token information from blockchain
   * @param {string} chain - Blockchain identifier
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} Token information
   */
  async getTokenInfo(chain, tokenAddress) {
    try {
      // Different implementation based on chain
      switch (chain) {
        case 'ethereum':
        case 'binanceSmartChain':
        case 'polygon':
        case 'avalanche':
        case 'optimism':
        case 'arbitrum':
          // For EVM chains
          const provider = this.getProvider(chain);
          const tokenContract = new ethers.Contract(
            tokenAddress,
            [
              'function name() view returns (string)',
              'function symbol() view returns (string)',
              'function decimals() view returns (uint8)',
              'function totalSupply() view returns (uint256)'
            ],
            provider
          );
          
          const [name, symbol, decimals, totalSupply] = await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.decimals(),
            tokenContract.totalSupply()
          ]);
          
          return {
            name,
            symbol,
            decimals,
            totalSupply: totalSupply.toString(),
            chain,
            tokenType: chain === 'binanceSmartChain' ? 'BEP20' : 'ERC20'
          };
          
        case 'tron':
          // For TRON network
          const tronClient = this.getProvider('tron');
          const tronContract = await tronClient.contract().at(tokenAddress);
          
          const trcName = await tronContract.name().call();
          const trcSymbol = await tronContract.symbol().call();
          const trcDecimals = await tronContract.decimals().call();
          
          return {
            name: trcName,
            symbol: trcSymbol,
            decimals: parseInt(trcDecimals),
            chain: 'tron',
            tokenType: 'TRC20'
          };
          
        case 'solana':
          // For Solana
          const connection = this.getProvider('solana');
          const pubkey = new PublicKey(tokenAddress);
          const accountInfo = await connection.getAccountInfo(pubkey);
          
          // This is simplified - actual Solana token info retrieval would require more processing
          return {
            address: tokenAddress,
            chain: 'solana',
            tokenType: 'SPL'
          };
          
        default:
          throw new Error(`Chain ${chain} not supported`);
      }
    } catch (error) {
      console.error(`Error getting token info for ${tokenAddress} on ${chain}:`, error);
      throw error;
    }
  },

  /**
   * Verify signature for token import
   * @param {string} chain - Blockchain identifier 
   * @param {string} message - Message that was signed
   * @param {string} signature - Signature to verify
   * @param {string} address - Signer address
   * @returns {Promise<boolean>} Is signature valid
   */
  async verifySignature(chain, message, signature, address) {
    try {
      switch (chain) {
        case 'ethereum':
        case 'binanceSmartChain':
        case 'polygon':
        case 'avalanche':
        case 'optimism':
        case 'arbitrum':
          // For EVM chains
          const recoveredAddress = ethers.utils.verifyMessage(message, signature);
          return recoveredAddress.toLowerCase() === address.toLowerCase();
          
        case 'tron':
          // For TRON network
          const tronClient = this.getProvider('tron');
          return tronClient.trx.verifyMessage(message, signature, address);
          
        case 'solana':
          // Solana signature verification is more complex
          // This is a simplified placeholder
          return true;
          
        default:
          throw new Error(`Chain ${chain} not supported for signature verification`);
      }
    } catch (error) {
      console.error(`Error verifying signature on ${chain}:`, error);
      return false;
    }
  },

  /**
   * Import token to contract
   * @param {string} chain - Blockchain identifier
   * @param {string} tokenId - Token identifier
   * @param {string} signature - Import signature
   * @param {string} signer - Signer's private key or wallet
   * @returns {Promise<Object>} Transaction result
   */
  async importToken(chain, tokenId, signature, signer) {
    try {
      // Different implementation based on chain
      switch (chain) {
        case 'ethereum':
        case 'binanceSmartChain':
        case 'polygon':
        case 'avalanche':
        case 'optimism':
        case 'arbitrum':
          // For EVM chains
          const contract = this.getContract(chain);
          const wallet = new ethers.Wallet(signer, this.getProvider(chain));
          const contractWithSigner = contract.connect(wallet);
          
          const tx = await contractWithSigner.importToken(tokenId, signature);
          const receipt = await tx.wait();
          
          return {
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            status: receipt.status === 1 ? 'success' : 'failed'
          };
          
        case 'tron':
          // For TRON network
          const tronContract = this.getContract('tron');
          const tronTx = await tronContract.importToken(tokenId, signature).send({
            feeLimit: 100_000_000,
            callValue: 0,
            from: signer
          });
          
          return {
            transactionHash: tronTx,
            status: 'success'
          };
          
        case 'solana':
          // Solana implementation would go here
          throw new Error('Solana import not yet implemented');
          
        default:
          throw new Error(`Chain ${chain} not supported for import`);
      }
    } catch (error) {
      console.error(`Error importing token ${tokenId} on ${chain}:`, error);
      throw error;
    }
  },
  
  /**
   * Get list of supported chains
   * @returns {Array} List of supported chains
   */
  getSupportedChains() {
    return Object.keys(blockchains).filter(chain => blockchains[chain].enabled);
  },
  
  /**
   * Get chain configuration
   * @param {string} chain - Blockchain identifier
   * @returns {Object} Chain configuration
   */
  getChainConfig(chain) {
    return blockchains[chain];
  }
};

module.exports = blockchainService; 