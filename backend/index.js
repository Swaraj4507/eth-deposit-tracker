const express = require('express');
const { ethers } = require('ethers');
const amqp = require('amqplib/callback_api');
const winston = require('winston');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3030;

// Setup Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});

// Connect to Ethereum using Alchemy
const provider = new ethers.providers.AlchemyProvider("homestead", process.env.ALCHEMY_API_KEY);


const beaconContractAddress = process.env.BEACON_CONTRACT_ADDRESS.toLowerCase();

// RabbitMQ configuration
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
// const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmqc';
const QUEUE_INFLUXDB = 'influxdb_queue';
const QUEUE_TELEGRAM = 'telegram_queue';

// To avoid processing the same transaction multiple times
const processedTransactions = new Set();

// Establish RabbitMQ connection
let rabbitConn;
amqp.connect(RABBITMQ_URL, function (error, connection) {
  if (error) {
    logger.error('Failed to connect to RabbitMQ', { error });
    throw error;
  }
  logger.info('Connected to RabbitMQ');
  rabbitConn = connection;
});
// Function to extract public key from transaction
function extractPublicKey(tx) {
  try {
    const expandedSig = {
      r: tx.r,
      s: tx.s,
      v: tx.v
    };

    // Reconstruct the transaction data
    const txData = {
      chainId: tx.chainId,
      nonce: tx.nonce,
      gasPrice: tx.gasPrice,
      gasLimit: tx.gasLimit,
      to: tx.to,
      value: tx.value,
      data: tx.data
    };

    // Serialize the transaction
    const serializedTx = ethers.utils.serializeTransaction(txData);

    // Get the transaction hash
    const txHash = ethers.utils.keccak256(serializedTx);

    // Recover the public key
    const publicKey = ethers.utils.recoverPublicKey(txHash, expandedSig);

    return publicKey;
  } catch (error) {
    logger.error('Error extracting public key', { error, txHash: tx.hash });
    return null;
  }
}
// Send transaction data to two queues: InfluxDB and Telegram Notification
function sendToQueues(txData) {
  rabbitConn.createChannel((error, channel) => {
    if (error) {
      logger.error('Error creating RabbitMQ channel', { error });
      return;
    }
    
    const msg = JSON.stringify(txData);

    // Send to InfluxDB queue
    channel.assertQueue(QUEUE_INFLUXDB, { durable: true });
    channel.sendToQueue(QUEUE_INFLUXDB, Buffer.from(msg), { persistent: true });
    logger.info(`Transaction sent to InfluxDB queue: ${txData.hash}`);

    // Send to Telegram queue
    channel.assertQueue(QUEUE_TELEGRAM, { durable: true });
    channel.sendToQueue(QUEUE_TELEGRAM, Buffer.from(msg), { persistent: true });
    logger.info(`Transaction sent to Telegram queue: ${txData.hash}`);
  });
}

// Fetch and log the latest block number
provider.getBlockNumber().then((blockNumber) => {
  logger.info(`Latest block number: ${blockNumber}`);
}).catch((error) => {
  logger.error("Error fetching block number", { error });
});

// Listen for new blocks
provider.on("block", async (blockNumber) => {
  try {
    logger.info(`New block detected: ${blockNumber}`);

    // Get block data with transactions
    const block = await provider.getBlockWithTransactions(blockNumber);
    const blockTimestamp = block.timestamp; // Get the block timestamp
    block.transactions.forEach(async (tx) => {
      if (!processedTransactions.has(tx.hash)) {
        // Check if it's a deposit to the Beacon Deposit Contract
        if (tx.to && tx.to.toLowerCase() === beaconContractAddress) {
          logger.info("Deposit transaction detected", { txHash: tx.hash });
          const pubkey = extractPublicKey(tx);
          sendToQueues({ ...tx, blockNumber ,blockTimestamp,pubkey});
          processedTransactions.add(tx.hash);
        }

        
        //Removed the trace_transaction functionality, as it's not available on my current Alchemy plan.

        // Check internal transactions for deposits to the contract
        // const receipt = await provider.getTransactionReceipt(tx.hash);
        // if (receipt) {
        //   const traces = await provider.send("trace_transaction", [tx.hash]);
        //   traces.forEach((trace) => {
        //     if (trace.action.to && trace.action.to.toLowerCase() === beaconContractAddress) {
        //       logger.info("Internal ETH deposit detected in trace", { txHash: trace.transactionHash });
        //       const pubkey = extractPublicKey(tx);
        //       sendToQueues({ ...trace, blockNumber,blockTimestamp ,pubkey});
        //       processedTransactions.add(tx.hash);
        //     }
        //   });
        // }
      }
    });
  } catch (error) {
    logger.error(`Error processing block ${blockNumber}`, { error });
  }
});

// Start the Express server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

