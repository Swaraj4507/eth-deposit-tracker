const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Ethereum using Alchemy
const provider = new ethers.providers.AlchemyProvider("homestead", process.env.ALCHEMY_API_KEY);
const beaconContractAddress = process.env.BEACON_CONTRACT_ADDRESS;
provider.getBlockNumber().then((blockNumber) => {
  console.log(`Latest block number: ${blockNumber}`);
}).catch((error) => {
  console.error("Error fetching block number:", error);
});
provider.on("block", async (blockNumber) => {
  console.log(`New block: ${blockNumber}`);

  // Get the block data
  const block = await provider.getBlockWithTransactions(blockNumber);


  console.log(block.transactions.length)
  // Filter transactions sent to the Beacon Deposit Contract
  block.transactions.forEach((tx) => {
    if (tx.to && tx.to.toLowerCase() === beaconContractAddress.toLowerCase()) {
      console.log("Deposit transaction detected:", tx);
      
      // You can now log the transaction or save it to your database
      // Example:
      // logDepositTransaction(tx);
    }
  });
});

function logDepositTransaction(tx) {
  // Extract and log relevant data
  const { hash, from, value, gasPrice, blockNumber } = tx;
  console.log(`
    Transaction Hash: ${hash}
    From: ${from}
    Value: ${ethers.utils.formatEther(value)} ETH
    Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei
    Block Number: ${blockNumber}
  `);

  // Here you can write logic to store this information in Firestore/InfluxDB
}
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
