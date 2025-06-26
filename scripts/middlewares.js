const ExcelJS = require('exceljs');

const messages = require('./messages');
const helper = require('./helper');

const { sender } = require('../services/sender');
const { web3Service } = require('../services/web3');
const {
    userDBService,
    walletDBService,
    transactionDBService
} = require('../services/db');

const ADMINS = process.env.ADMINS.split(',');

const LANGUAGES = /uk/;

const start = async (ctx, next) => {
    const { message } = ctx.update.callback_query || ctx.update;

    if (message) {
        try {
            ctx.state.user = await userDBService.get({ chat_id: ctx.from.id });

            if (message.chat.type === 'private') {
                const lang = (LANGUAGES.test(ctx.from.language_code)) ?
                    ctx.from.language_code : 'uk';
                const username = ctx.chat.username || ctx.from.username || ctx.from.first_name;

                if (!ctx.state.user) {
                    const user = {
                        chat_id: ctx.from.id,
                        username,
                        lang
                    };

                    ctx.state.user = await userDBService.create(user);
                }

                await ctx.i18n.locale(lang);

                if (ctx.state.user.username !== username || ctx.state.user.lang !== lang) {
                    ctx.state.user = await userDBService.update({ chat_id: ctx.from.id }, {
                        isActive: true,
                        lang,
                        username
                    }, 'after');
                }
            }
        } catch (error) {
            console.log(error)
        }
    }

    return next();
};

const commands = async (ctx, next) => {
    const { message } = ctx.update;

    const { user } = ctx.state;

    if (message && message.text) {
        const { text } = message;

        const match = text.split(' ');

        let chat_id = message.chat.id,
            response_message = null,
            update = null;

        if (message.chat.type === 'private') {
            if (match[0] === '/start') {
                response_message = messages.start(user.lang, user);

                await ctx.scene.leave();
            }

            if (text === ctx.i18n.t('cancel_button')) {
                response_message = messages.start(user.lang, user);

                await ctx.replyWithHTML('👍', {
                    reply_markup: {
                        remove_keyboard: true
                    }
                });

                await ctx.scene.leave();
            }

            if (web3Service.NEW_WALLET_REG.test(text)) {
                const [name, address, wanted_volume_per_day] = text.split(':');

                console.log(name, address, wanted_volume_per_day)

                let wallet = await walletDBService.get({
                    address,
                    wanted_volume_per_day
                });

                if (!wallet) {
                    wallet = await walletDBService.create({
                        chats: [user.chat_id],
                        name,
                        address,
                        wanted_volume_per_day
                    });
                } else {
                    wallet = await walletDBService.update({ _id: wallet._id }, {
                        $addToSet: {
                            chats: user.chat_id
                        }
                    }, 'after');
                }

                if (wallet) {
                    update = {
                        $addToSet: {
                            wallets: wallet._id
                        }
                    };
                }

                response_message = messages.start(user.lang, user);
                response_message.text = ctx.i18n.t('walletAdded_message');
            }

            if (match[0].includes('/del_')) {
                const address = match[0].replace('/del_', '');

                const wallet = await walletDBService.get({ address });

                if (wallet) {
                    if (wallet.chats.length === 1) {
                        await walletDBService.delete({ _id: wallet._id });
                    } else {
                        await walletDBService.update({ _id: wallet._id }, {
                            chats: {
                                $pull: user.chat_id
                            }
                        });
                    }

                    response_message = messages.start(user.lang, user);
                    response_message.text = ctx.i18n.t('walletDeleted_message');
                }
            }

            if (match[0].includes('/daily_')) {
                const address = match[0].replace('/daily_', '');

                const today = new Date();
                today.setHours(0);
                today.setMinutes(0);

                const wallet = await walletDBService.get({ address });

                if (wallet) {
                    const transactions = helper.report(await transactionDBService.getAll({
                        date: {
                            $gt: today
                        },
                        address
                    }), wallet);

                    response_message = messages.daily(user.lang, transactions);
                }
            }

            if (match[0].includes('/report_')) {
                const address = match[0].replace('/report_', '');
                const wallet = await walletDBService.get({ address });

                if (wallet) {
                    response_message = messages.report(user.lang, wallet);
                }
            }

            if (user.isAdmin || ADMINS.includes(user.chat_id)) {
                if (match[0] === '/admin') {
                    const check = await userDBService.get({
                        $or: [
                            { chat_id: match[1] },
                            { username: match[1] }
                        ]
                    });
                
                    if (check) {
                        check.isAdmin = (user.chat_id == check.chat_id) ?
                            true : !check.isAdmin;

                        await userDBService.update({ chat_id: check.chat_id }, check);
                
                        response_message = messages.userInfo(user.lang, check);
                    }
                }

                if (match[0] === '/check') {
                    const res = await web3Service.convertToken(['0x55d398326f99059ff775485246999027b3197955']);

                    console.log('[check]', res)

                    await ctx.replyWithHTML(JSON.stringify(res));
                }
            }
        }

        if (update) {
            await userDBService.update({ chat_id }, update);
        }

        if (response_message) {
            sender.enqueue({
                chat_id,
                message: response_message
            });
        }
    }

    return next();
};

const cb = async (ctx, next) => {
    const { callback_query } = ctx.update;

    const { user } = ctx.state;

    if (callback_query) {
        const now = new Date();

        const { message } = callback_query;
        const { message_id } = message;

        const chat_id = message.chat.id;

        const match = callback_query.data.split('-');

        let deleteMessage = false,
            response_message = null,
            update = null,
            answer = null;

        if (callback_query.message.chat.type === 'private') {
            if (match[0] === 'cancel') {
                deleteMessage = true;
                response_message = messages.start(user.lang, user);

                await ctx.scene.leave();
            }

            if (match[0] === 'monitor') {
                const isMonitor = !user.isMonitor;

                if (user.wallets.length > 0 || !isMonitor) {
                    const temp = await userDBService.update({ chat_id: user.chat_id }, { isMonitor }, 'after');

                    response_message = messages.start(user.lang, temp, message_id);
                    response_message.text = (isMonitor) ?
                        ctx.i18n.t('monitorIsActivated_message') : ctx.i18n.t('monitorIsDeactivated_message');
                } else {
                    response_message = messages.start(user.lang, user, message_id);
                    response_message.text = ctx.i18n.t('addWalletsFirst_message');
                }
            }

            if (match[0] === 'daily' || match[0] === 'report') {
                if (match[1]) {
                    if (match[2]) {
                        const req = (match[1] === 'all') ?
                            { address: { $in: user.wallets }} : { address: match[1] };

                        if (match[2] !== 'all') {
                            const gt = new Date();
                            gt.setHours(0);
                            gt.setMinutes(0);
                            gt.setSeconds(0);

                            if (match[2] === 'month') {
                                gt.setDate(1);
                            } else if (match[2] === 'week') {
                                gt.setDate(gt.getDate() - 7);
                            }

                            req.date = {
                                $gt: gt
                            };
                        }

                        const transactions = await transactionDBService.getAll(req, {}, { date: 1 });

                        const temp = {};

                        await sender.sendMessage(user.chat_id, {
                            type: 'edit_text',
                            message_id,
                            text: ctx.i18n.t('waitForIt_message'),
                            extra: {}
                        });

                        for (let tx of transactions) {
                            const address = tx.address;
                            const date = tx.date.toLocaleDateString('ru-RU');

                            if (temp[address]) {
                                if (temp[address][date]) {
                                    const length = temp[address][date].length;
                                    temp[address][date][length] = tx;
                                } else {
                                    temp[address][date] = [tx];
                                }
                            } else {
                                temp[address] = {
                                    [date]: [tx]
                                };
                            }
                        }

                        const workbook = new ExcelJS.Workbook();
                        const exel_path = `./files/${user.chat_id}.xlsx`;

                        let wallet = {},
                            i = 0;

                        for (let element of Object.entries(temp)) {
                            wallet = await walletDBService.get({ address: element[0] });

                            if (wallet) {
                                const sheet = workbook.addWorksheet(wallet.name + '_' + i);

                                sheet.columns = [
                                    { header: 'Date', key: 'date' },
                                    { header: 'Total Volume', key: 'total_USD' },
                                    { header: 'Spent', key: 'spent' },
                                    { header: 'BNB', key: 'BNB' },
                                    { header: 'BNB USD', key: 'BNB_USD' }
                                ];

                                const t = [];

                                for (let el of Object.entries(element[1])) {
                                    const report = helper.report(el[1]);
                                    report.date = el[0];

                                    t[t.length] = report;
                                }

                                sheet.addRows(t);

                                i++;
                            }
                        }

                        await new Promise((response) => workbook.xlsx.writeFile(exel_path).then(() => {
                            response(true);
                        }));

                        response_message = messages.report(user.lang, wallet, { source: exel_path });
                    }
                } else {
                    const wallets = await walletDBService.getAll({ chats: user.chat_id });

                    response_message = messages.start(user.lang, user, message_id);
                    response_message.text = ctx.i18n.t('myWallets_message', {
                        data: wallets.reduce((acc, el) => {
                            acc += ctx.i18n.t('wallet', {
                                key: match[0],
                                address: el.address,
                                name: el.name,
                                volume: el.wanted_volume_per_day
                            }) + '\n';
                            return acc;
                        }, '')
                    });
                }
            }

            if (match[0] === 'wallets') {
                const wallets = await walletDBService.getAll({ chats: user.chat_id });

                response_message = messages.start(user.lang, user, message_id);
                response_message.text = ctx.i18n.t('myWallets_message', {
                    data: wallets.reduce((acc, el) => {
                        acc += ctx.i18n.t('wallet', {
                            key: 'del',
                            address: el.address,
                            name: el.name,
                            volume: el.wanted_volume_per_day
                        }) + '\n';
                        return acc;
                    }, '')
                });
            }
        }

        if (update) {
            await userDBService.update({ chat_id }, update);
        }

        if (deleteMessage) {
            await sender.deleteMessage(chat_id, message_id);
        }

        if (answer) {
            await ctx.answerCbQuery(answer, true);
        }

        if (response_message) {
            sender.enqueue({
                chat_id,
                message: response_message
            });
        }
    }

    return next();
};

module.exports = {
    start,
    commands,
    cb
}