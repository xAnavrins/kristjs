const Address = require("./Address")

class Name {
    constructor(name) {
        this.name = name.name
        this.owner = new Address({"address": name.owner})
        this.original_owner = new Address({"address": name.original_owner})
        this.registered = new Date(name.registered)
        this.updated = new Date(name.updated)
        this.a_record = name.a || undefined
        this.unpaid = name.unpaid

        this.previous_owner = new Address({"address": name.previous_owner})
    }

    setRecord(record) {}

    toString = () => this.name
}

module.exports = Name
