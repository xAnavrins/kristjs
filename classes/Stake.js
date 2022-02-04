const Address = require("./Address")

class Stake {
    constructor(stake) {
        this.owner = new Address({"address": stake.owner})
        this.amount = stake.stake
        this.active = stake.active
    }
}

module.exports = Stake
