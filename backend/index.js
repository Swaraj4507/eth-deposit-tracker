const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  console.log(`Your chat ID: ${chatId}`);
});

const app = express();
const PORT = process.env.PORT || 3030;
// InfluxDB configurations from environment variables
const influxDB = new InfluxDB({ 
  url: process.env.INFLUXDB_URL, 
  token: process.env.INFLUXDB_TOKEN 
});
const writeApi = influxDB.getWriteApi(process.env.INFLUXDB_ORG, process.env.INFLUXDB_BUCKET);
writeApi.useDefaultTags({ app: 'eth-deposit-tracker' });


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



function sendTelegramMessage(message) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  bot.sendMessage(chatId, message)
    .then(() => {
      console.log('Message sent to Telegram');
    })
    .catch((error) => {
      console.error('Error sending message to Telegram:', error);
    });
}


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

  // Create a data point to write to InfluxDB
  const point = new Point('deposits')
    .tag('tx_hash', hash)
    .tag('from_address', from)
    .floatField('value_eth', parseFloat(formattedValue))
    .floatField('gas_price_gwei', parseFloat(formattedGasPrice))
    .floatField('block_number', blockNumber)
    .timestamp(new Date());

  // Write the data point to InfluxDB
  try {
    writeApi.writePoint(point);
    console.log('Deposit transaction saved to InfluxDB');
  } catch (error) {
    console.error('Error writing transaction to InfluxDB:', error);
  }
  const message = `New ETH Deposit Detected:
    - Transaction Hash: ${hash}
    - From: ${from}
    - Value: ${formattedValue} ETH
    - Gas Price: ${formattedGasPrice} Gwei
    - Block Number: ${blockNumber}`;

  sendTelegramMessage(message);
}



process.on('exit', () => {
  writeApi
    .close()
    .then(() => {
      console.log('InfluxDB connection closed.');
    })
    .catch(err => {
      console.error('Error closing InfluxDB connection:', err);
    });
});




// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
