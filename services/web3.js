const axios = require('axios');

const { Web3 } = require('web3');

const { Queue } = require('../modules/queue_lifo');

const {
    userDBService,
    walletDBService
} = require('../services/db');
const { sender } = require('../services/sender');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class Web3Methods {
    constructor() {
        this.queue = new Queue();
        this.enqueue = (data) => this.queue.enqueue(data);
        this.dequeue = () => this.queue.dequeue();

        this.web3 = new Web3(new Web3.providers.HttpProvider(process.env.BSC_RPC));

        this.lastBlock = null;

        this.CURRENCY_RATES = {
            'BNB': {},
            'TOKENS': {}
        };

        this.NEW_WALLET_REG = /^([^:]+):(0x[a-fA-F0-9]{40}):([A-Z0-9]{2,10}):(\d+(\.\d+)?)/g;

        this.CONVERT_BNB_URL = 'https://api.coingecko.com/api/v3/simple/price';
        this.CONVERT_TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens/';

        this.ERC20_ABI = [
            {
                constant: true,
                inputs: [],
                name: 'symbol',
                outputs: [{ name: '', type: 'string' }],
                type: 'function'
            },
            {
                constant: true,
                inputs: [],
                name: 'decimals',
                outputs: [{ name: '', type: 'uint8' }],
                type: 'function'
            },
            {
                constant: true,
                inputs: [],
                name: 'name',
                outputs: [{ name: '', type: 'string' }],
                type: 'function'
            },
            {
                constant: true,
                inputs: [{ name: 'owner', type: 'address' }],
                name: 'balanceOf',
                outputs: [{ name: '', type: 'uint256' }],
                type: 'function'
            }
        ];
    }

    formatTokenAmount(amountBigInt, decimals = 18) {
        const amountStr = amountBigInt.toString().padStart(decimals + 1, '0');
        const integerPart = amountStr.slice(0, -decimals);
        const decimalPart = amountStr.slice(-decimals).replace(/0+$/, '') || '0';

        return `${integerPart}.${decimalPart}`;
    }

    async run() {
        const {
            _storage,
            _oldestIndex,
            _newestIndex
        } = this.queue;

        for (let i = _oldestIndex; i < _newestIndex; i++) {
            const {
                action,
                data
            } = _storage[i];

            if (action === 'getTxInfo') {
                try {
                    const temp = await this.getTxInfo(data.txHash, data.address);

                    console.log(temp);
                } catch (error) {
                    console.log('[getTxInfo]', error);

                    await sleep(1000);

                    this.enqueue({
                        action,
                        data
                    });
                }
            }

            this.dequeue();
        }

        setTimeout(async () => await this.run(), 1000);
    }

    async convertBNB(amount, currency = 'usd', ids = 'binancecoin') {
        try {
            if (!this.CURRENCY_RATES['BNB'][currency]) {
                const res = await axios.get(this.CONVERT_BNB_URL, {
                    params: {
                        ids,
                        vs_currencies: currency
                    }
                });

                this.CURRENCY_RATES['BNB'][currency] = res.data.binancecoin[currency];

                setTimeout(() => this.CURRENCY_RATES['BNB'][currency] = null, 60 * 1000);
            }

            const rate = this.CURRENCY_RATES['BNB'][currency];

            return parseFloat(amount) * rate;
        } catch (error) {
            console.error('[convertBNB]', error.message);
        }

        return 0;
    }

    async convertToken(address, amount) {
        try {
            if (!this.CURRENCY_RATES['TOKENS'][address]) {
                const res = await axios.get(this.CONVERT_TOKENS_URL + address);

                this.CURRENCY_RATES['TOKENS'][address] = res.data.pairs?.[0];

                setTimeout(() => this.CURRENCY_RATES['TOKENS'][address] = null, 60 * 1000);
            }

            const pair = this.CURRENCY_RATES['TOKENS'][address];

            if (pair && pair.priceUsd) {
                return parseFloat(amount) * parseFloat(pair.priceUsd);
            }
        } catch (error) {
            console.log('[convertToken]', error.message);
        }

        return 0;
    }

    async getTokensTranssfered(receipt, address) {
        const transfers = receipt.logs.filter(log => log.topics[0] === this.web3.utils.sha3("Transfer(address,address,uint256)"));
      
        const results = [];
      
        for (const log of transfers) {
            const from = '0x' + log.topics[1].slice(26);
            const to = '0x' + log.topics[2].slice(26);
            const tokenAddress = log.address;
        
            const tokenContract = new this.web3.eth.Contract(this.ERC20_ABI, tokenAddress);

            let symbol = '';
            let decimals = 18n;
        
            try {
                symbol = await tokenContract.methods.symbol().call();
                decimals = await tokenContract.methods.decimals().call();
            } catch {
                //...
            }
        
            const decoded = this.web3.eth.abi.decodeLog(
                [{ type: "uint256", name: "value" }],
                log.data,
                log.topics.slice(1)
            );
        
            const amount = Number(decoded.value / 10n ** decimals);
        
            results[results.length] = {
                from,
                to,
                amount,
                symbol,
                tokenAddress
            };
        }
      
        const sent = results.find(r => r.from.toLowerCase() === address.toLowerCase());
        const received = results.find(r => r.to.toLowerCase() === address.toLowerCase());
      
        return {
            sent,
            received
        };
    }

    async getTxInfo(txHash, address) {
        const tx = await this.web3.eth.getTransaction(txHash);
        const receipt = await this.web3.eth.getTransactionReceipt(txHash);

        if (receipt && receipt.status && receipt.blockNumber) {
            const {
                sent,
                received
            } = await this.getTokensTranssfered(receipt, address);

            if (sent && received) {
                const gasUsed = BigInt(receipt.gasUsed);
                const gasPrice = BigInt(tx.gasPrice);
                const fee_bnb = this.web3.utils.fromWei((gasUsed * gasPrice).toString(), 'ether');

                let type = (sent.symbol === 'USDT') ? 'BUY' : 'SELL',
                    sent_usd,
                    received_usd,
                    lose_usd;

                sent_usd = await this.convertToken(sent.tokenAddress, sent.amount);
                received_usd = await this.convertToken(received.tokenAddress, received.amount);

                if (sent_usd && received_usd) {
                    lose_usd = sent_usd - received_usd;
                }

                return {
                    txHash,
                    type,
                    sent: sent.amount,
                    received: received.amount,
                    sent_usd,
                    received_usd,
                    lose_usd,
                    fee_bnb,
                    fee_usd: await this.convertBNB(fee_bnb)
                };
            }
        } else {
            this.enqueue({
                action: 'getTxInfo',
                data: txHash
            });
        }

        return null;
    }

    async monitorWallets(){
        const wallets = await walletDBService.getAll({});
        const walletSet = new Set(wallets.map(w => w.address.toLowerCase()));

        if (!this.lastBlock) {
            this.lastBlock = await this.web3.eth.getBlockNumber();
        }

        while (true) {
            try {
                const currentBlock = await this.web3.eth.getBlockNumber();

                if (currentBlock > this.lastBlock) {
                    for (let i = this.lastBlock + 1n; i <= currentBlock; i = i + 1n) {
                        const logs = await this.web3.eth.getPastLogs({
                            fromBlock: i,
                            toBlock: i,
                            topics: [
                                [
                                    //this.web3.utils.sha3('Swap(address,uint256,uint256,uint256,uint256,address)'),
                                    this.web3.utils.sha3('Transfer(address,address,uint256)'),
                                    //this.web3.utils.sha3('Approval(address,address,uint256)')
                                ]
                            ]
                        });

                        for (const log of logs) {
                            const from = '0x' + log.topics[1].slice(26).toLowerCase();
                            const to = '0x' + log.topics[2].slice(26).toLowerCase();

                            if (walletSet.has(from)) {
                                this.enqueue({
                                    action: 'getTxInfo',
                                    data: {
                                        txHash: log.transactionHash,
                                        address: from
                                    }
                                });
                            }

                            await sleep(1000);
                        }

                        this.lastBlock = i;

                        await sleep(1000);
                    }
                }
            } catch (error) {
                console.log('[monitorWallets]', error);

                await sleep(10000);
            }
        }
    }
}

const web3Service = new Web3Methods();

web3Service.run();

module.exports = {
    web3Service
}