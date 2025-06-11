const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WalletSchema = new Schema({
    chats: {
        type: Array
    },
    name: {
        type: String
    },
    address: {
        type: String
    },
    token_ticker: {
        type: String
    },
    wanted_volume_per_day: {
        type: Number
    },
}, { versionKey: false });

const Wallet = mongoose.model('Wallet', WalletSchema);

module.exports = {
    Wallet
};