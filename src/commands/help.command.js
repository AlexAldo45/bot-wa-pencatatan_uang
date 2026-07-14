const responseBuilder = require('../bot/responseBuilder');
const config = require('../config');

module.exports = {
    async execute() {
        return responseBuilder.buildHelp(config.botPrefix);
    }
};
