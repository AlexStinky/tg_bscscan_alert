const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
    date: {
        type: Date,
        default: Date.now
    },
    tx_hash: {
        type: String
    },
    address: {
        type: String
    },
    symbol: {
        type: String
    },
    tx_hash: {
        type: String
    },
    type: {
        type: String
    },
    out_: {
        type: Number
    },
    in_: {
        type: Number
    },
    out_usd: {
        type: Number
    },
    in_usd: {
        type: Number
    },
    fee_bnb: {
        type: Number
    },
    fee_usd: {
        type: Number
    },
}, { versionKey: false });

const Transaction = mongoose.model('Transaction', TransactionSchema);

module.exports = {
    Transaction
};