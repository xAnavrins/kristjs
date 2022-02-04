const Address = require("./Address")
const Name = require("./Name")

class Transaction {
    constructor(transaction) {
        this.type = transaction.type
        this.id = transaction.id
        this.from = new Address({"address": transaction.from})
        this.to = new Address({"address": transaction.to})
        this.value = transaction.value
        this.time = new Date(transaction.time)
        this.name = transaction.name ? new Name({"name": transaction.name}) : undefined
        this.metadata = transaction.metadata
    }
}

module.exports = Transaction
