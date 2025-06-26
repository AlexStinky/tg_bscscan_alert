const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
    date: {
        type: Date,
        default: Date.now
    },
    type: {
        type: String
    },
    address: {
        type: String
    },
    tx_hash: {
        type: String
    },
    out_symbol: {
        type: String
    },
    out_token_address: {
        type: String
    },
    in_symbol: {
        type: String
    },
    in_token_address: {
        type: String
    },
    out_amount: {
        type: Number
    },
    in_amount: {
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