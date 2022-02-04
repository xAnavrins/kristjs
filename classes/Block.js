const Address = require("./Address")

class Block {
    constructor(block) {
        this.height = block.height
        this.miner = new Address({"address": block.address})
        this.hash = block.hash
        this.short_hash = block.short_hash
        this.value = block.value
        this.time = new Date(block.time)
        this.difficulty = block.difficulty
    }

    toString = () => this.short_hash
}

module.exports = Block
