const { User } = require('../models/User');
const { Wallet } = require('../models/Wallet');

class DBMethods {
    constructor(model) {
        this.Model = model;
    }

    async create(data) {
        try {
            return await this.Model.create(data);
        } catch (error) {
            console.log('[create]', error);

            return null;
        }
    }

    async get(req) {
        try {
            return await this.Model.findOne(req);
        } catch (error) {
            console.log('[get]', error);

            return null;
        }
    }

    async getAll(req, score = {}, sort = {}, limit = false) {
        try {
            return await this.Model.find(req, score).sort(sort).limit(limit);
        } catch (error) {
            console.log('[getAll]', error);

            return [];
        }
    }

    async update(req, update, returnDocument = 'before', upsert) {
        try {
            return await this.Model.findOneAndUpdate(req, update, {
                upsert,
                returnDocument
            });
        } catch (error) {
            console.log('[update]', error);

            return null;
        }
    }

    async updateAll(req, update) {
        try {
            return await this.Model.updateMany(req, update);
        } catch (error) {
            console.log('[updateAll]', error);

            return null;
        }
    }

    async delete(req) {
        try {
            return await this.Model.findOneAndDelete(req);
        } catch (error) {
            console.log('[delete]', error);

            return null;
        }
    }

    async deleteAll(req) {
        try {
            return await this.Model.deleteMany(req);
        } catch (error) {
            console.log('[deleteAll]', error);

            return null;
        }
    }

    async getCount(req) {
        try {
            return await this.Model.find(req).countDocuments();
        } catch (error) {
            console.log('[getCount]', error);

            return 0;
        }
    }

    async dropCollection() {
        try {
            return await this.Model.collection.drop();
        } catch (error) {
            console.log('[dropCollection]', error);

            return 0;
        }
    }
}

const userDBService = new DBMethods(User);
const walletDBService = new DBMethods(Wallet);

module.exports = {
    userDBService,
    walletDBService
}