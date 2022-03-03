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
    "Origin": "Krist.JS",
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
                this.handle = new Websocket(res.url, { headers: HEADERS })

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

                this._wsSend({"type": "me"})
                .then(res => {
                    if (res.address) { this.address = new Address(res.address) }
                    this.isGuest = res.isGuest
                    
                    Promise.allSettled([
                        // I'd rather not have any default subscriptions
                        this.unsubscribe("blocks"),
                        this.unsubscribe("ownStake"),
                        this.unsubscribe("ownTransactions"),
                        this.getStake()
                    ])
                    .then(res => {
                        this.running = true
                        this.emit("ready")
                    })
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

    login(opts = {}) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "login", "privatekey": opts.private_key})
            .then(res => {
                this.address = new Address(res.address)
                this.isGuest = res.isGuest
                this.private_key = opts.private_key
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

    getAddress(opts = {}) {
        if (!opts.address) { opts.address = this.address ? this.address.address : undefined }
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "address", "address": opts.address})
            .then(res => resolve(new Address(res.address)))
            .catch(reject)
        })
    }

    getRichest(opts = { top: 50 }) {
        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/rich?limit=${opts.top}`)
            .then(res => resolve(res.addresses.map(i => new Address(i))))
            .catch(reject)
        })
    }

    getTransactions(opts = {}) {
        if (!opts.address) { opts.address = this.address ? this.address.address : undefined }
        if (!opts.address) { return Promise.reject({ ok: false, error: "address_not_specified" }) }

        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/${opts.address}/transactions?excludeMined=true` + (opts.limit ? `&limit=${opts.limit}` : ""))
            .then(res => {
                delete res.ok
                res.transactions = res.transactions.map(tx => new Transaction(tx))
                resolve(res)
            })
            .catch(reject)
        })
    }

    getName(opts = {}) {
        if (!opts.name) { return Promise.reject({ ok: false, error: "name_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${opts.name}`)
            .then(res => resolve(new Name(res.name)))
            .catch(reject)
        })
    }

    getNames(opts = {}) {
        if (!opts.address) { opts.address = this.address ? this.address.address : undefined }
        if (!opts.address) { return Promise.reject({ ok: false, error: "address_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._httpSend(`/addresses/${opts.address}/names` + (opts.limit ? `?limit=${opts.limit}` : ""))
            .then(res => {
                delete res.ok
                res.names = res.names.map(name => new Name(name))
                resolve(res)
            })
            .catch(reject)
        })
    }

    getStake(opts = {}) {
        if (!opts.address) { opts.address = this.address ? this.address.address : undefined }
        if (!opts.address) { return Promise.reject({ ok: false, error: "address_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "stake", "address": opts.address})
            .then(res => {
                let stake = new Stake(res.stake)
                if (stake.owner.address === this.address.address) { this.currentStake = stake }
                resolve(stake)
            })
            .catch(reject)
        })
    }

    getStakes(opts = {}) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking" + (opts.limit ? `?limit=${opts.limit}` : ""))
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

    registerName(opts = { name: "" }) {
        if (!opts.name) { return Promise.reject({ ok: false, error: "name_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${opts.name}`, {"privatekey": this.private_key})
            .then(resolve)
            .catch(reject)
        })
    }

    transferName(opts = { name: "" }) {
        if (!opts.name) { return Promise.reject({ ok: false, error: "name_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${opts.name}/transfer`, {"privatekey": this.private_key, "address": opts.recipient})
            .then(res => resolve(new Name(res.name)))
            .catch(reject)
        })
    }

    updateName(opts = { name: "" }) {
        if (!opts.name) { return Promise.reject({ ok: false, error: "name_not_specified" }) }
        return new Promise((resolve, reject) => {
            this._httpSend(`/names/${opts.name}/update`, {"privatekey": this.private_key, "a": opts.record})
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

    submitBlock(opts = {}) {
        return new Promise((resolve, reject) => {
            this._wsSend({"type": "submit_block", "nonce": opts.nonce, "address": opts.address})
            .then(res => {
                res.success ? resolve(res) : reject(res)
            })
            .catch(reject)
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

    depositStake(opts = {}) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking", {"amount": opts.amount, "privatekey": this.private_key})
            .then(res => resolve(new Stake(res.stake)))
            .catch(reject)
        })
    }

    withdrawStake(opts = {}) {
        return new Promise((resolve, reject) => {
            this._httpSend("/staking/withdraw", {"amount": opts.amount, "privatekey": this.private_key})
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
