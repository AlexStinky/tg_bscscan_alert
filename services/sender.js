const messages = require('../scripts/messages');

const { Queue } = require('../modules/queue_fifo');

const { userDBService } = require('./db');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class Sender {
    constructor() {
        this.queue = new Queue();
        this.enqueue = (data) => this.queue.enqueue(data);
        this.dequeue = () => this.queue.dequeue();

        this.bot = null;
        this.delay = 100;
        this.counter = 0;

        this.MEMBER_STATUS_REG = /(member|administrator|creator)/;

        this.TEXT_MAX_LENGTH = 4000;
        this.CAPTION_MAX_LENGTH = 1000;

        this.FORBIDDEN_ERRORS = [
            'bot was blocked',
            "bot can't initiate conversation with a user",
            'user is deactivated',
            'chat not found'
        ];
    }

    checkForbidden(text) {
        return this.FORBIDDEN_ERRORS.some(el => text.includes(el));
    }

    async create(bot) {
        if (!bot) throw new Error('Bot instance is required');

        this.bot = bot;

        await this.run();

        return this.bot;
    }

    async run() {
        const {
            storage,
            count
        } = this.queue;

        if (storage[count - 1]) {
            const {
                action,
                chat_id,
                user_id,
                message,
                message_thread_id
            } = storage[count - 1];

            if (message_thread_id) {
                message.extra.message_thread_id = message_thread_id;
            }

            await this.sendMessage(chat_id, message);

            this.dequeue();

            this.counter++;

            if (this.counter % 30 === 0) {
                await sleep(1000);
            }
        }

        setTimeout(async () => await this.run(), 100);
    }

    async setChatPermissions(chat_id, permissions) {
        try {
            return await this.bot.telegram.setChatPermissions(chat_id, permissions);
        } catch (error) {
            console.log('[setChatPermissions]', error.response);

            return null;
        }
    }

    async unbanUser(chat_id, user_id) {
        try {
            return await this.bot.telegram.unbanChatMember(chat_id, user_id, {
                only_if_banned: true
            });
        } catch (error) {
            console.log('[unbanUser]', error.response);

            return null;
        }
    }

    async banUser(chat_id, user_id) {
        try {
            return await this.bot.telegram.banChatMember(chat_id, user_id);
        } catch (error) {
            console.log('[banUser]', error.response);

            return null;
        }
    }

    async deleteMessage(chat_id, message_id) {
        try {
            return await this.bot.telegram.deleteMessage(chat_id, message_id);
        } catch (error) {
            console.log('[deleteMessage]', error.response);

            return null;
        }
    }

    async deleteMessages(chat_id, message_ids) {
        try {
            return await this.bot.telegram.callApi('deleteMessages', {
                chat_id,
                message_ids
            });
        } catch (error) {
            console.log('[deleteMessages]', error.response);

            return null;
        }
    }

    async getChat(chat_id) {
        try {
            return await this.bot.telegram.callApi('getChat', {
                chat_id,
            });
        } catch (error) {
            console.log('[getChat]', error.response);

            return null;
        }
    }

    async getInviteLink(chat_id) {
        try {
            const { invite_link } = await this.bot.telegram.callApi('createChatInviteLink', {
                chat_id,
                creates_join_request: true
            });

            return invite_link;
        } catch (error) {
            console.log('[getInviteLink]', error.response);

            return null;
        }
    }

    async revokeInviteLink(chat_id, invite_link) {
        try {
            return await this.bot.telegram.callApi('revokeChatInviteLink', {
                chat_id,
                invite_link
            });
        } catch (error) {
            console.log('[revokeInviteLink]', error.response);

            return null;
        }
    }

    async getChatMember(chat_id, user_id) {
        try {
            return await this.bot.telegram.callApi('getChatMember', {
                chat_id,
                user_id
            });
        } catch (error) {
            console.log('[getChatMember]', error.response);

            return null;
        }
    }

    async sendMessage(chat_id, message) {
        const MAX_LENGTH = (message.type && message.type.includes('text')) ?
            this.TEXT_MAX_LENGTH : this.CAPTION_MAX_LENGTH;

        let next = null,
            text = message.text,
            extra = {};

        if (text && text.length > MAX_LENGTH) {
            const temp = (message.text.split('\n'))
                .reduce((acc, el) => {
                    if ((acc['current'].length + el.length) < MAX_LENGTH) {
                        acc['current'] += el + '\n';
                    } else {
                        acc['next'] += el + '\n';
                    }

                    return acc;
                }, {
                    current: '',
                    next: ''
                });
            next = temp.next;
            text = temp.current;
            extra = {
                caption: text,
                parse_mode: 'HTML'
            };
        } else {
            extra = {
                caption: text,
                parse_mode: 'HTML',
                ...message.extra
            };
        }

        await sleep(this.delay);

        try {
            let res = null;

            switch (message.type) {
                case 'action':
                    res = await this.bot.telegram.sendChatAction(chat_id, message.text);
                    break;
                case 'cb':
                    res = await this.bot.telegram.answerCbQuery(message.id, message.text, message.alert, extra);
                    break;
                case 'edit_keyboard':
                    res = await this.bot.telegram.editMessageReplyMarkup(chat_id, message.message_id, null, extra.reply_markup);
                    break;
                case 'edit_text':
                    res = await this.bot.telegram.editMessageText(chat_id, message.message_id, null, message.text, extra);
                    break;
                case 'edit_caption':
                    res = await this.bot.telegram.editMessageCaption(chat_id, message.message_id, null, message.text, extra);
                    break;
                case 'edit_media':
                    res = await this.bot.telegram.editMessageMedia(chat_id, message.message_id, null, message.file, extra);
                    break;
                case 'photo':
                    res = await this.bot.telegram.sendPhoto(chat_id, message.file, extra);
                    break;
                case 'document':
                    res = await this.bot.telegram.sendDocument(chat_id, message.file, extra);
                    break;
                case 'video':
                    res = await this.bot.telegram.sendVideo(chat_id, message.file, extra);
                    break;
                case 'media_group':
                    await this.bot.telegram.sendMediaGroup(chat_id, message.file, extra);
                    res = await this.bot.telegram.sendMessage(chat_id, text, extra);
                    break;
                case 'invoice':
                    res = await this.bot.telegram.sendInvoice(chat_id, message, extra);
                    //await this.bot.telegram.sendMessage(chat_id, text, extra);
                    break;
                case 'location':
                    await this.bot.telegram.callApi('sendLocation', {
                        chat_id: chat_id,
                        latitude: message.location.latitude,
                        longitude: message.location.longitude
                    });
                    res = await this.bot.telegram.sendMessage(chat_id, text, extra);
                    break;
                default:
                    res = (message.text.length > MAX_LENGTH) ?
                        await this.bot.telegram.sendMessage(chat_id, text, extra) :
                        await this.bot.telegram.sendMessage(chat_id, text, extra);
                    break;
            }

            /*if (this.delay >= 1000) {
                this.delay = 100;
            } else {
                this.delay += 100;
            }*/

            if (message.text && message.text.length > MAX_LENGTH) {
                const temp = {
                    type: 'text',
                    text: next,
                    extra: {
                        caption: next,
                        parse_mode: 'HTML',
                        ...message.extra
                    }
                };

                return this.sendMessage(chat_id, temp);
            } else {
                return res;
            }
        } catch (error) {
            const response = (error.response) ? error.response : error;

            console.log('[sendMessage]', response);

            if (response.description) {
                if (this.checkForbidden(response.description)) {
                    await userDBService.update({ chat_id }, {
                        isActive: false
                    });
                } else if (response.description.includes("Bad Request: can't parse entities:")) {
                    const temp = {
                        type: message.type,
                        text: message.text.replace(/([<>\/])/g, ''),
                        extra: {}
                    };

                    return this.sendMessage(chat_id, temp);
                }
            }

            return null;
        }
    }
}

const sender = new Sender();

module.exports = {
    sender
}