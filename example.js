const Krist = require("./")

let krist = new Krist({
    url: "https://krist.ceriat.net", // If omitted, defaults to krist.ceriat.net
    private_key: "myprivkey"         // If omitted, will log as a guest
})

krist.connect()
    .then(hello => {
        if (krist.isGuest) {
            console.log(`Logged in as a guest`)
        } else {
            console.log(`Logged in as ${krist.address}`)
        }

        krist.subscribe("blocks")
        krist.subscribe("transactions")

        krist.on("block", block => {
            console.log(`BK: ${block.height}; ${block.value}KST ⇒ ${block.miner}; Work ${block.difficulty} ⇒ ${krist.currentWork}`)
        })

        krist.on("transaction", tx => {
            if (tx.type !== "mined") {
                let parsedMeta = tx.metadata.parse()
                let returnRecipient = parsedMeta.returnRecipient
                let recipient = parsedMeta.recipient
                console.log(`TX: ${tx.id}; ${returnRecipient ? `${returnRecipient} (${tx.from})` : tx.from} ⇒ ${tx.value}KST ⇒ ${recipient ? `${recipient} (${tx.to})` : tx.to}; ${tx.metadata}`)
            }
        })
    })
    .catch(console.error)
