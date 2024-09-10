const amqp = require('amqplib/callback_api');
const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
require('dotenv').config();

// Setup Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/telegram_worker.log' })
  ]
});

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
// const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmqc';
const QUEUE_TELEGRAM = 'telegram_queue';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

//Use this script to know your chatid 
//Just send  messages to your bot for few times you will see botid

// const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// // When any message is received, log the chatId
// bot.on('message', (msg) => {
//   const chatId = msg.chat.id;
  
//   // Send a confirmation message with the chatId
//   bot.sendMessage(chatId, `Your chat ID is: ${chatId}`);
  
//   console.log(`Chat ID: ${chatId}`);
  
//   // Optionally, you can stop polling after getting the chatId
//   bot.stopPolling();
// });

// Function to process transaction and send Telegram notification
async function processTransaction(msg) {
  const tx = JSON.parse(msg.content.toString());
  const { hash, from, value, gasPrice, pubkey, blockNumber, blockTimestamp } = tx;
  // Convert value and gasPrice back to BigNumber
  const valueBN = ethers.BigNumber.from(value);
  const gasPriceBN = ethers.BigNumber.from(gasPrice);

  const formattedValue = ethers.utils.formatEther(valueBN);
  const formattedGasPrice = ethers.utils.formatUnits(gasPriceBN, 'gwei');

  // Calculate the fee
  const fee = valueBN.mul(gasPriceBN).div(ethers.utils.parseUnits('1', 'gwei'));
  const formattedFee = ethers.utils.formatEther(fee);

  // Format the block timestamp
  const formattedTimestamp = new Date(blockTimestamp * 1000).toISOString();

  const message = `New ETH Deposit Detected:
    - Transaction Hash: ${hash}
    - From: ${from}
    - Public Key: ${pubkey || 'Unknown'}
    - Value: ${formattedValue} ETH
    - Gas Price: ${formattedGasPrice} Gwei
    - Fee: ${formattedFee} ETH
    - Block Number: ${blockNumber}
    - Block Timestamp: ${formattedTimestamp}`;

  bot.sendMessage(chatId, message)
    .then(() => {
      logger.info(`Telegram notification sent for transaction ${hash}`);
    })
    .catch((error) => {
      logger.error('Error sending Telegram message', { error });
    });
}

// RabbitMQ consumer setup
amqp.connect(RABBITMQ_URL, function (error, connection) {
  if (error) {
    logger.error('Failed to connect to RabbitMQ', { error });
    throw error;
  }
  connection.createChannel(function (error, channel) {
    if (error) {
      logger.error('Error creating RabbitMQ channel', { error });
      return;
    }
    
    // Assert the Telegram queue
    channel.assertQueue(QUEUE_TELEGRAM, { durable: true });
    
    // Consume messages from the Telegram queue
    channel.consume(QUEUE_TELEGRAM, (msg) => {
      processTransaction(msg);
      channel.ack(msg);
    });

    logger.info('Telegram worker is waiting for messages');
  });
});

