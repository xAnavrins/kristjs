const Websocket = require("ws")
const Fetch = require("node-fetch")
const { EventEmitter } = require("events")

const Address = require("./classes/Address")
const Block = require("./classes/Block")
const Metadata = require("./classes/Metadata")
const Name = require("./classes/Name")
const Stake = require("./classes/Stake")
const Transaction = require("./classes/Transaction")

const HEADERS = {
    "Content-Type": "application/json",
    "Origin": "Anav's KristJS",
    "User-Agent": "node-fetch/2.0",
}

class Krist extends EventEmitter {
    constructor(opts = {}) {
        super()
        this.node_url = opts.url || "https://krist.ceriat.net"
        this.private_key = opts.private_key

        this.autoReconnect = opts.autoReconnect || true
        this.reconnectDelay = opts.reconnectDelay || 1000
        this.keepaliveDelay = opts.keepaliveDelay || 15000

        this.running = false
        this.started = false
        this.connected = false
    }

    _timedOut() {
        this.emit("timedout")
    }    

    connect() {
        return new Promise((resolve, reject) => {
            let opts = {method: "POST", headers: HEADERS}
            if (this.private_key) { opts.body = `{"privatekey": "${this.private_key}"}` }

            Fetch(this.node_url + "/ws/start", opts)
            .then(res => res.json())
            .then(res => {
                this.handle = new Websocket(res.url)

                this.handle.on("message", this._onMessage.bind(this))

                this.handle.on("open", () => {
                    this.connected = true
                    this.timeout = setTimeout(this._timedOut, this.keepaliveDelay)
                })
    
                this.handle.on("close", (code, reason) => { // idk wtf fix this
                    if (this.running) {
                        this.emit("disconnected")
                        setTimeout(() => {
                            this.emit("reconnect")
                            return this.connect()
                        }, this.reconnectDelay)
                    }
                })

                this.handle.on("error", reject)

                if (!this.started) {
                    this.started = true
                    this.once("ready", () => {
                        resolve(this._hello)
                    })
                }
            })
        })
    }

    _onMessage(message) {
        let data = JSON.parse(message)
        this.emit("raw", data)

        if (data.hasOwnProperty("id")) {
            let id = data.id
            this.emit("response:" + id, data)
            if (data.hasOwnProperty("subscription_level")) { this.subscription_level = data.subscription_level }
        } else {
            if (data.type === "hello") {
                this._hello = data
                this.currentBlock = new Block(data.last_block)
                this.currentWork = data.work

                // I'd rather not have any default subscriptions
                this._wsSend({"type": "me"})
                .then(res => {
                    if (res.address) { this.address = new Address(res.address) }
                    this.isGuest = res.isGuest
                    return this.getStake()
                })
                .then(this.unsubscribe("ownTransactions"))
                .then(this.unsubscribe("blocks"))
                .then(this.unsubscribe("ownStake").catch(() => {}))
                .catch(() => {})
                .finally(() => {
                    this.running = true
                    this.emit("ready")
                })

            } else if (data.type === "keepalive") {
                clearTimeout(this.timeout)
                this.timeout = setTimeout(this._timedOut, this.keepaliveDelay)
                this.emit("keepalive", new Date(data.server_time))
    
            } else if (data.type === "name") { // Unimplemented by the node
            } else if (data.type === "motd") { // Unimplemented by the node
    
            } else if (data.type === "event") {
                if (data.event === "block") {
                    let newBlock = new Block(data.block)
                    this.currentWork = data.new_work
                    this.currentBlock = newBlock
                    this.emit("block", newBlock)
    
                } else if (data.event === "transaction") {
                    data.transaction.metadata = new Metadata(data.transaction.metadata, this._hello.currency.name_suffix)
                    let newTx = new Transaction(data.transaction)
                    this.emit("transaction", newTx)
                    if (newTx.type === "name_purchase") {
                        this.emit("namePurchase", new Name({"original_owner": newTx.from, "owner": newTx.from, "name": newTx.name}))
    
                    } else if (newTx.type === "name_transfer") {
                        this.emit("nameTransfer", new Name({"previous_owner": newTx.from, "owner": newTx.to, "name": newTx.name}))
    
                    } else if (newTx.type === "name_a_record") {
                        this.emit("nameRecordChange", new Name({"owner": newTx.from, "name": newTx.name, "a_record": newTx.metadata}))
    
                    }
    
                } else if (data.event === "validator") {
                    this.currentValidator = new Address({"address": data.validator})
                    this.emit("validator", this.currentValidator)
    
                } else if (data.event === "stake") {
                    let stake = new Stake(data.stake)
                    if (stake.owner.address === this.address.address) { this.currentStake = stake }
                    this.emit("stake", stake)
    
                } else {
                    this.emit("unknown", data)

                }

            } else {
                this.emit("unknown", data)
            }
        }
    }

    _httpSend(path, post) {
        let options = {method: "GET", headers: HEADERS}
        if (post) {
            options.method = "POST"
            options.body = JSON.stringify(post)
        }
        return new Promise((resolve, reject) => {
            Fetch(this.node_url + path, options)
            .then(res => res.json())
            .then(res => { res.ok ? resolve(res) : reject(res) })
            .catch(err => reject(err))
        })
    }

    _wsSend(data) {
        return new Promise((resolve, reject) => {
            let id = Math.floor(Math.random() * 65536)
            data.id = id
            this.once("response:" + id, data => {
                data.ok ? resolve(data) : reject(data)
            })
            this.handle.send(JSON.stringify(data))
        })
    }

    login(privkey) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "login", "privatekey": privkey})
            .then(res => {
                this.address = new Address(res.address)
                this.isGuest = res.isGuest
                resolve(this.address)
            })
            .catch(reject)
        })
    }

    logout() {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "logout"})
            .then(res => {
                delete this.address
                this.isGuest = res.isGuest
                resolve(res)
            })
            .catch(reject)
        })
    }

    getAddress(address) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "address", "address": address})
            .then(res => resolve(new Address(res.address)))
            .catch(reject)
        })
    }

    getRichest(top = 50) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/rich?limit=${top}`)
            .then(res => resolve(res.addresses.map(i => new Address(i))))
            .catch(reject)
        })
    }

    getTransactions(address = this.address.address, limit) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/${address}/transactions?excludeMined=true` + (limit ? `&limit=${limit}` : ""))
            .then(res => {
                delete res.ok
                res.transactions = res.transactions.map(tx => new Transaction(tx))
                resolve(res)
            })
            .catch(reject)
        })
    }

    getName(name) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${name}`)
            .then(res => resolve(new Name(res.name)))
            .catch(reject)
        })
    }

    getNames(address = this.address.address, limit) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/${address}/names` + (limit ? `?limit=${limit}` : ""))
            .then(res => {
                delete res.ok
                res.names = res.names.map(name => new Name(name))
                resolve(res)
            })
            .catch(reject)
        })
    }

    getStake(address = this.address.address) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "stake", "address": address})
            .then(res => {
                let stake = new Stake(res.stake)
                if (stake.owner.address === this.address.address) { this.currentStake = stake }
                resolve(stake)
            })
            .catch(reject)
        })
    }

    getStakes(limit) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking" + (limit ? `?limit=${limit}` : ""))
            .then(res => {
                delete res.ok
                res.stakes = res.stakes.map(stake => new Stake(stake))
                resolve(res)
            })
            .catch(reject)
        })
    }

    getDetailedWork() {
        return new Promise((resolve, reject) => {
            this._httpSend("/work/detailed")
            .then(resolve)
            .catch(reject)
        })
    }

    getDayWork() {
        return new Promise((resolve, reject) => {
            this._httpSend("/work/day")
            .then(res => resolve(res.work))
            .catch(reject)
        })
    }

    registerName(name = "") {
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${name}`, {"privatekey": this.private_key})
            .then(resolve)
            .catch(reject)
        })
    }

    transferName(name = "", recipient = "") {
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${name}/transfer`, {"privatekey": this.private_key, "address": recipient})
            .then(res => resolve(new Name(res.name)))
            .catch(reject)
        })
    }

    updateName(name = "", record) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${name}/update`, {"privatekey": this.private_key, "a": record})
            .then(res => resolve(new Name(res.name)))
            .catch(reject)
        })
    }

    makeTransaction(opts) {
        opts.type = "make_transaction"
        return new Promise((resolve, reject) => {
            this._wsSend(opts)
            .then(res => resolve(new Transaction(res.transaction)))
            .catch(reject)
        })
    }

    submitBlock(nonce, address) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "submit_block", "nonce": nonce, "address": address})
            .then(res => {
                res.success ? resolve(res) : reject(res)
            })
        })
    }
    
    subscribe(level) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "subscribe", "event": level})
            .then(resolve)
            .catch(err => reject(`Invalid event: ${level}`))
        })
    }

    unsubscribe(level) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "unsubscribe", "event": level})
            .then(resolve)
            .catch(err => reject(`Invalid event: ${level}`))
        })
    }

    depositStake(amount) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking", {"amount": amount, "privatekey": this.private_key})
            .then(res => resolve(new Stake(res.stake)))
            .catch(reject)
        })
    }

    withdrawStake(amount) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking/withdraw", {"amount": amount, "privatekey": this.private_key})
            .then(res => resolve(new Stake(res.stake)))
            .catch(reject)
        })
    }

    destroy(err) {
        if (this.running) {
            this.running = false
            this.started = false
            this.connected = false
            this.handle.close()
        }
    }
}

module.exports = Krist
