const axios = require('axios');

const { Web3 } = require('web3');

const BigNumber = require('bignumber.js');

const { Queue } = require('../modules/queue_lifo');

const messages = require('../scripts/messages');

const {
    userDBService,
    walletDBService,
    transactionDBService
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

        this.WALLETS_SET = new Set();

        this.CURRENCY_RATES = {
            'BNB': {},
            'TOKENS': {}
        };

        this.CONTRACT_ADDRESSES = [];

        this.NEW_WALLET_REG = /^([^:]+):(0x[a-fA-F0-9]{40}):(\d+(\.\d+)?)/;

        this.CONVERT_BNB_URL = 'https://api.coingecko.com/api/v3/simple/price';
        this.CONVERT_TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens/';

        this.BSCSCAN_API_KEY = '3C792UNZGRI5S54BM6B8XZX6CIUHYH1KS2';

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

            let msgs = [];

            if (action === 'getTxInfo') {
                try {
                    const res = await this.getTxInfo(data.tx_hash, data.address);

                    if (res) {
                        const today = new Date();
                        today.setHours(0);
                        today.setMinutes(0);

                        const wallet = await walletDBService.get({ address: data.address });
                        const users = await userDBService.getAll({
                            chat_id: { $in: wallet.chats },
                            isMonitor: true
                        });

                        await transactionDBService.create(res);

                        if (users.length > 0) {
                            const all = (await transactionDBService.getAll({
                                date: {
                                    $gt: today
                                },
                                address: data.address
                            })).reduce((acc, el) => {
                                if (el.type === 'BUY') {
                                    acc.out += el.out_usd;
                                } else if (el.type === 'SELL') {
                                    acc.in += el.in_usd;
                                }

                                acc.BNB += el.fee_bnb;
                                acc.BNB_USD += el.fee_usd;

                                return acc;
                            }, {
                                out: 0,
                                in: 0,
                                BNB: 0,
                                BNB_USD: 0
                            });

                            if (all.out > 0 && all.in > 0) {
                                const temp = {
                                    address: wallet.address,
                                    name: wallet.name,
                                    total_USD: wallet.wanted_volume_per_day,
                                    commissions_USD: (all.out - all.in).toFixed(2),
                                    BNB: all.BNB,
                                    BNB_USD: all.BNB_USD.toFixed(2)
                                };

                                for (let user of users) {
                                    msgs[msgs.length] = {
                                        chat_id: user.chat_id,
                                        message: messages.monitor(user.lang, temp)
                                    };
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.log('[getTxInfo]', error);

                    await sleep(1000);

                    this.enqueue({
                        action,
                        data
                    });
                }
            }

            msgs.forEach((el) => sender.enqueue(el));

            this.dequeue();
        }

        setTimeout(async () => await this.run(), 1000);
    }

    async getTransactionByHash(txhash) {
        try {
            const res = await axios.get('https://api.bscscan.com/api', {
                params: {
                    module: 'proxy',
                    action: 'eth_getTransactionByHash',
                    txhash,
                    apikey: this.BSCSCAN_API_KEY
                }
            });

            console.log(res.data.result);

            return res.data.result;
        } catch (err) {
            console.error('[getTransactionByHash]', err.message);
        }

        return null;
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

    async convertToken(addresses, amount = 0) {
        let usd = 0;

        for (let i = 0; i < addresses.length; i++) {
            const address = addresses[i].toLowerCase();

            try {
                if (amount && this.CURRENCY_RATES['TOKENS'][address]) {
                    usd = this.CURRENCY_RATES['TOKENS'][address].usd;
                } else {
                    const { data } = await axios.get(
                        'https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain',
                        {
                            params: {
                                contract_addresses: address,
                                vs_currencies: 'usd'
                            }
                        }
                    );

                    console.log(data)

                    if (amount) {
                        usd = data[address].usd;
                    }

                    if (!this.CONTRACT_ADDRESSES.includes(address)) {
                        this.CONTRACT_ADDRESSES[this.CONTRACT_ADDRESSES.length] = address;
                    }

                    this.CURRENCY_RATES['TOKENS'][address] = data[address];
                }

                if (i !== 0 && i % 50 === 0) {
                    await sleep(60000);
                }
            } catch (error) {
                console.log(`[convertToken] ${address}`, error.message);

                await sleep(1000);

                i--;
            }
        }

        return (amount > 0) ?
            (amount.multipliedBy(usd)).toNumber() :
            null;
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
        
            const rawValue = new BigNumber(decoded.value);
            const divisor = new BigNumber(10).pow(decimals);
            const amount = rawValue.dividedBy(divisor);
        
            results[results.length] = {
                from,
                to,
                amount,
                amountFloat: amount.toNumber(),
                symbol,
                tokenAddress
            };
        }
      
        const out_ = results.find(r => r.from.toLowerCase() === address.toLowerCase());
        const in_ = results.findLast(r => r.to.toLowerCase() === address.toLowerCase());
      
        return {
            out_,
            in_
        };
    }

    async getTxInfo(tx_hash, address) {
        const tx = await this.web3.eth.getTransaction(tx_hash);
        const receipt = await this.web3.eth.getTransactionReceipt(tx_hash);

        if (receipt && receipt.status && receipt.blockNumber) {
            const {
                out_,
                in_
            } = await this.getTokensTranssfered(receipt, address);

            if (out_ && in_) {
                const gasUsed = BigInt(receipt.gasUsed);
                const gasPrice = BigInt(tx.gasPrice);
                const fee_bnb = this.web3.utils.fromWei((gasUsed * gasPrice).toString(), 'ether');

                let type = (out_.symbol === 'USDT') ? 'BUY' : 'SELL',
                    out_usd = await this.convertToken([out_.tokenAddress], out_.amount),
                    in_usd =  await this.convertToken([in_.tokenAddress], in_.amount);

                return {
                    address,
                    tx_hash,
                    type,
                    out_: out_.amountFloat,
                    in_: in_.amountFloat,
                    out_usd,
                    in_usd,
                    fee_bnb,
                    fee_usd: await this.convertBNB(fee_bnb)
                };
            }
        } else {
            this.enqueue({
                action: 'getTxInfo',
                data: tx_hash
            });
        }

        return null;
    }

    async monitorWallets(){
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
                            if (log.topics[1] && log.topics[2]) {
                                const from = '0x' + log.topics[1].slice(26).toLowerCase();
                                const to = '0x' + log.topics[2].slice(26).toLowerCase();

                                console.log(from)

                                if (this.WALLETS_SET.has(from)) {
                                    this.enqueue({
                                        action: 'getTxInfo',
                                        data: {
                                            tx_hash: log.transactionHash,
                                            address: from
                                        }
                                    });
                                }
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

        return await this.monitorWallets();
    }
}

const web3Service = new Web3Methods();

setInterval(async () => {
    const wallets = await walletDBService.getAll({});
    web3Service.WALLETS_SET = new Set(wallets.map(w => w.address.toLowerCase()));
}, 5000);

setTimeout(async function exchanges() {
    if (web3Service.CONTRACT_ADDRESSES.length > 0) {
        await web3Service.convertToken(web3Service.CONTRACT_ADDRESSES);
    }

    setTimeout(exchanges, 60000);
}, 1000);

module.exports = {
    web3Service
}