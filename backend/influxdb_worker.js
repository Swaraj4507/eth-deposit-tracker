const amqp = require('amqplib/callback_api');
const { ethers } = require('ethers');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
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
    new winston.transports.File({ filename: 'logs/influxdb_worker.log' })
  ]
});

// InfluxDB configurations
const influxDB = new InfluxDB({ 
  url: process.env.INFLUXDB_URL, 
  token: process.env.INFLUXDB_TOKEN 
});
const writeApi = influxDB.getWriteApi(process.env.INFLUXDB_ORG, process.env.INFLUXDB_BUCKET);
writeApi.useDefaultTags({ app: 'eth-deposit-tracker' });

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
// const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmqc';
const QUEUE_INFLUXDB = 'influxdb_queue';

// Function to process transactions and save to InfluxDB
async function processTransaction(msg) {
  const tx = JSON.parse(msg.content.toString());
  const { hash, from, value, gasPrice, pubkey, blockNumber, blockTimestamp} = tx;

  // Convert value and gasPrice back to BigNumber
  const valueBN = ethers.BigNumber.from(value);
  const gasPriceBN = ethers.BigNumber.from(gasPrice);

  const formattedValue = ethers.utils.formatEther(valueBN);
  const formattedGasPrice = ethers.utils.formatUnits(gasPriceBN, 'gwei');

  // Calculate the fee
  const fee = valueBN.mul(gasPriceBN).div(ethers.utils.parseUnits('1', 'gwei'));
  const formattedFee = ethers.utils.formatEther(fee);


  const point = new Point('deposits')
    .tag('tx_hash', hash)
    .tag('from_address', from)
    .tag('pubkey', pubkey || 'unknown')
    .floatField('value_eth', parseFloat(formattedValue))
    .floatField('gas_price_gwei', parseFloat(formattedGasPrice))
    .floatField('fee_eth', parseFloat(formattedFee))
    .floatField('block_number', blockNumber)
    .timestamp(blockTimestamp ? new Date(blockTimestamp * 1000) : new Date());

  // Write the data point to InfluxDB
  try {
    writeApi.writePoint(point);
    logger.info(`Saved deposit transaction to InfluxDB: ${hash}`);
  } catch (error) {
    logger.error('Error writing transaction to InfluxDB', { error });
  }
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
    channel.assertQueue(QUEUE_INFLUXDB, { durable: true });
    channel.consume(QUEUE_INFLUXDB, (msg) => {
      processTransaction(msg);
      channel.ack(msg);
    });
    logger.info('InfluxDB worker is waiting for messages');
  });
});

process.on('exit', () => {
  writeApi.close().then(() => {
    logger.info('InfluxDB connection closed');
  }).catch(err => {
    logger.error('Error closing InfluxDB connection', { err });
  });
});
