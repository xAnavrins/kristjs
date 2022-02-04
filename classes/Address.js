class Address {
    constructor(address) {
        this.address = address.address ? address.address : undefined
        this.balance = address.balance
        this.totalin = address.totalin
        this.totalout = address.totalout
        this.firstseen = address.firstseen ? new Date(address.firstseen) : undefined
    }

    sendTo(client, amount, metadata) {
        return client._wsSend({
            "type": "make_transaction",
            "privatekey": client.private_key,
            "to": this.address,
            "amount": amount,
            "metadata": metadata // new Metadata
        })
    }

    toString = () => this.address
}

module.exports = Address
