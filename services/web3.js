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
                    const temp = await this.getTxInfo(data);

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

    async getPairTokens(pairAddress) {
        const pairAbi = [
            {
                constant: true,
                inputs: [],
                name: "token0",
                outputs: [{ name: "", type: "address" }],
                type: "function"
            },
            {
                constant: true,
                inputs: [],
                name: "token1",
                outputs: [{ name: "", type: "address" }],
                type: "function"
            }
        ];

        const pairContract = new this.web3.eth.Contract(pairAbi, pairAddress);
        const token0 = await pairContract.methods.token0().call();
        const token1 = await pairContract.methods.token1().call();

        return { token0, token1 };
    }

    async getTokenDecimals(tokenAddress) {
        try {
            const tokenAbi = [
                {
                    constant: true,
                    name: 'decimals',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint8' }],
                    type: 'function',
                },
            ];

            const tokenContract = new this.web3.eth.Contract(tokenAbi, tokenAddress);
            const decimals = await tokenContract.methods.decimals().call();

            return Number(decimals);
        } catch (error) {
            console.error(`[getTokenDecimals] ${tokenAddress}:`, error);

            return 18;
        }
    }

    async decodeSwap(log) {
        const {
            token0,
            token1
        } = await this.getPairTokens(log.address);
        const [decimals0, decimals1] = await Promise.all([
            this.getTokenDecimals(token0.toLowerCase()),
            this.getTokenDecimals(token1.toLowerCase()),
        ]);

        const decoded = this.web3.eth.abi.decodeLog(
            [
                { type: 'address', name: 'sender', indexed: true },
                { type: 'uint256', name: 'amount0In' },
                { type: 'uint256', name: 'amount1In' },
                { type: 'uint256', name: 'amount0Out' },
                { type: 'uint256', name: 'amount1Out' },
                { type: 'address', name: 'to', indexed: true },
            ],
            log.data,
            [log.topics[1], log.topics[2]]
        );

        const input0 = BigInt(decoded.amount0In);
        const input1 = BigInt(decoded.amount1In);
        const output0 = BigInt(decoded.amount0Out);
        const output1 = BigInt(decoded.amount1Out);

        const inputFormatted = this.formatTokenAmount(input0 || input1, input0 > 0n ? decimals0 : decimals1);
        const outputFormatted = this.formatTokenAmount(output0 || output1, output0 > 0n ? decimals0 : decimals1);

        const fee = (input0 + input1) > 0n ? (input0 + input1 - output0 - output1) : 0n;
        const feeFormatted = this.formatTokenAmount(fee, input0 > 0n ? decimals0 : decimals1);

        return {
            from: decoded.sender,
            to: decoded.to,
            input: inputFormatted,
            output: outputFormatted,
            fee: feeFormatted
        };
    }

    async getTxDetails(txHash) {
        const receipt = await this.web3.eth.getTransactionReceipt(txHash);
        const tx = await this.web3.eth.getTransaction(txHash);

        if (!receipt || !tx) {
            throw new Error('[getTxDetails] TX not found!');
        }

        const gasUsed = BigInt(receipt.gasUsed);
        const gasPrice = BigInt(tx.gasPrice);
        const fee_bnb = this.web3.utils.fromWei((gasUsed * gasPrice).toString(), 'ether');

        const transferEventSig = this.web3.utils.sha3("Transfer(address,address,uint256)");

        const decodedTransfers = [];

        for (const log of receipt.logs) {
            if (log.topics[0] === transferEventSig) {
                const tokenAddress = log.address;

                const from = '0x' + log.topics[1].slice(26);
                const to = '0x' + log.topics[2].slice(26);
                const amountRaw = this.web3.utils.hexToNumberString(log.data);

                const tokenContract = new this.web3.eth.Contract([
                    {
                        constant: true,
                        name: "decimals",
                        inputs: [],
                        outputs: [{ name: "", type: "uint8" }],
                        type: "function"
                    }
                ], tokenAddress);

                let decimals = 18;

                try {
                    decimals = await tokenContract.methods.decimals().call();
                } catch {
                    //...
                }

                const amount = (BigInt(amountRaw) / (10n ** BigInt(decimals))).toString();

                decodedTransfers.push({ tokenAddress, from, to, amount });
            }
        }

        return {
            txHash,
            fee_bnb,
            fee_usd: await this.convertBNB(feeBNB),
            transfers: decodedTransfers
        };
    }

    async getTokenInfo(address) {
        const tokenContract = new this.web3.eth.Contract([
            { constant: true, inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], type: "function" },
            { constant: true, inputs: [], name: "symbol", outputs: [{ name: "", type: "string" }], type: "function" },
            { constant: true, name: "token0", outputs: [{ name: "", type: "address" }], inputs: [], type: "function" },
            { constant: true, name: "token1", outputs: [{ name: "", type: "address" }], inputs: [], type: "function" }
        ], address);

        try {
            const [
                decimals,
                symbol,
                token0,
                token1
            ] = await Promise.all([
                tokenContract.methods.decimals().call(),
                tokenContract.methods.symbol().call(),
                tokenContract.methods.token0().call(),
                tokenContract.methods.token1().call()
            ]);

            return {
                decimals: Number(decimals),
                symbol,
                token0,
                token1
            };
        } catch (error) {
            console.error(`[getTokenInfo]`, error.message);

            return {
                decimals: 18,
                symbol: ''
            };
        }
    }

    async getTxInfo(txHash) {
        const tx = await this.web3.eth.getTransaction(txHash);
        const receipt = await this.web3.eth.getTransactionReceipt(txHash);

        if (receipt && receipt.status && receipt.blockNumber) {
            const log = receipt.logs.find(el =>
                el.topics[0] === this.web3.utils.sha3('Transfer(address,address,uint256)')
            );

            console.log(log)

            if (log) {
                let {
                    decimals,
                    token0,
                    token1
                } = await this.getTokenInfo(log.address);

                if (log && token0 && token1) {
                    const gasUsed = BigInt(receipt.gasUsed);
                    const gasPrice = BigInt(tx.gasPrice);
                    const fee_bnb = this.web3.utils.fromWei((gasUsed * gasPrice).toString(), 'ether');

                    const decoded = this.web3.eth.abi.decodeLog([
                        { type: 'uint256', name: 'amount0In' },
                        { type: 'uint256', name: 'amount1In' },
                        { type: 'uint256', name: 'amount0Out' },
                        { type: 'uint256', name: 'amount1Out' }
                    ], log.data, log.topics.slice(1));

                    const amount0In = decoded.amount0In;
                    const amount1In = decoded.amount1In;
                    const amount0Out = decoded.amount0Out;
                    const amount1Out = decoded.amount1Out;

                    let type,
                        tokenAmount,
                        bought,
                        sold,
                        bought_usd,
                        sold_usd,
                        lose_usd;

                    token0 = token0.toLowerCase();
                    token1 = token1.toLowerCase();

                    if (amount0In > 0n && amount1Out > 0n) {
                        type = 'BUY';

                        tokenAmount = (amount1Out / BigInt(10n ** BigInt(decimals))).toString();

                        bought = this.web3.utils.fromWei(amount0In.toString(), 'ether');
                        sold = this.web3.utils.fromWei(amount1Out.toString(), 'ether');

                        bought_usd = await this.convertToken(token0, bought);
                        sold_usd = await this.convertToken(token1, sold);
                    } else if (amount1In > 0n && amount0Out > 0n) {
                        type = 'SELL';

                        tokenAmount = (amount1In / BigInt(10n ** BigInt(decimals))).toString();

                        bought = this.web3.utils.fromWei(amount1In.toString(), 'ether');
                        sold = this.web3.utils.fromWei(amount0Out.toString(), 'ether');

                        bought_usd = await this.convertToken(token1, bought);
                        sold_usd = await this.convertToken(token0, sold);
                    }

                    if (bought_usd && sold_usd) {
                        lose_usd = bought_usd - sold_usd;
                    }

                    return {
                        address: swapLog.address,
                        token0,
                        token1,
                        txHash,
                        type,
                        tokenAmount,
                        bought,
                        sold,
                        bought_usd,
                        sold_usd,
                        lose_usd,
                        fee_bnb,
                        fee_usd: await this.convertBNB(fee_bnb)
                    };
                }
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
                                    this.web3.utils.sha3('Swap(address,uint256,uint256,uint256,uint256,address)'),
                                    //this.web3.utils.sha3('Transfer(address,address,uint256)'),
                                    //this.web3.utils.sha3('Approval(address,address,uint256)')
                                ]
                            ]
                        });

                        for (const log of logs) {
                            const from = '0x' + log.topics[1].slice(26).toLowerCase();
                            const to = '0x' + log.topics[2].slice(26).toLowerCase();

                            if (true || walletSet.has(from) || walletSet.has(to)) {
                                /*this.enqueue({
                                    action: 'getTxInfo',
                                    data: log.transactionHash
                                });*/
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