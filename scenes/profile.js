const fs = require('fs');

const Scene = require('telegraf/scenes/base');

const middlewares = require('../scripts/middlewares');
const messages = require('../scripts/messages');

const { sender } = require('../services/sender');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
}