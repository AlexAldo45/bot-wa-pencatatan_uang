const database = require('./database');
const migrate = require('./migrate');

module.exports = {
    ...database,
    ...migrate
};
