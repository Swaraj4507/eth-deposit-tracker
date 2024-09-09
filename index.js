const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

// Initialize Firestore


const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Ethereum using Alchemy
const provider = new ethers.providers.AlchemyProvider("homestead", process.env.ALCHEMY_API_KEY);
const beaconContractAddress = process.env.BEACON_CONTRACT_ADDRESS;

// To avoid processing the same transaction multiple times
const processedTransactions = new Set();

// Fetch and log the latest block number
provider.getBlockNumber().then((blockNumber) => {
  console.log(`Latest block number: ${blockNumber}`);
}).catch((error) => {
  console.error("Error fetching block number:", error);
});

// Listen for new blocks
provider.on("block", async (blockNumber) => {
  try {
    console.log(`New block: ${blockNumber}`);

    // Get block data with transactions
    const block = await provider.getBlockWithTransactions(blockNumber);

    console.log(`Block ${blockNumber} contains ${block.transactions.length} transactions.`);

    // Filter transactions sent to the Beacon Deposit Contract
    block.transactions.forEach((tx) => {
      if (!processedTransactions.has(tx.hash) && tx.to && tx.to.toLowerCase() === beaconContractAddress.toLowerCase()) {
        console.log("Deposit transaction detected:", tx);
        logDepositTransaction(tx);
        processedTransactions.add(tx.hash); // Avoid processing this transaction again
      }
    });
  } catch (error) {
    console.error(`Error processing block ${blockNumber}:`, error);
  }
});

// Function to log and store deposit transactions
async function logDepositTransaction(tx) {
  const { hash, from, value, gasPrice, blockNumber } = tx;
  const formattedValue = ethers.utils.formatEther(value);
  const formattedGasPrice = ethers.utils.formatUnits(gasPrice, 'gwei');
  
  console.log(`
    Transaction Hash: ${hash}
    From: ${from}
    Value: ${formattedValue} ETH
    Gas Price: ${formattedGasPrice} Gwei
    Block Number: ${blockNumber}
  `);

  const depositData = {
    hash,
    from,
    value: formattedValue,
    gasPrice: formattedGasPrice,
    blockNumber,
    timestamp: new Date().toISOString(),
  };

  // Save transaction to Firestore
  // try {
  //   await db.collection('deposits').doc(hash).set(depositData);
  //   console.log('Deposit transaction saved to Firestore:', depositData);
  // } catch (error) {
  //   console.error('Error saving transaction to Firestore:', error);
  // }
}

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
