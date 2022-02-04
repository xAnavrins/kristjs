const { memoize, escapeRegExp, truncate, toString } = require("lodash")

const MAX_NAME_SUFFIX_LENGTH = 6
const cleanNameSuffix = memoize((nameSuffix) => escapeRegExp(truncate(toString(nameSuffix), { length: MAX_NAME_SUFFIX_LENGTH, omission: "" })))
const getNameRegex = memoize((nameSuffix, metadata) => new RegExp(`^(?:([a-z0-9-_]{1,32})@)?([a-z0-9]{1,64})(\\.${cleanNameSuffix(nameSuffix)})${metadata ? ";?" : "$"}`))

const getNameParts = (nameSuffix, name) => {
    if (!nameSuffix || !name) return

    let nameMatches = getNameRegex(nameSuffix).exec(name)
    if (!nameMatches) return undefined

    let mMetaname = nameMatches[1] || undefined
    let mName = nameMatches[2] || undefined
    let nameWithSuffix = mName ? mName + "." + nameSuffix : undefined
    let recipient = mMetaname ? mMetaname + "@" + nameWithSuffix : nameWithSuffix

    return {
        metaname: mMetaname,
        name: mName,
        nameSuffix,
        nameWithSuffix,
        recipient
    }
}

const parseCommonMeta = (nameSuffix, metadata) => {
    if (!metadata) return undefined

    let custom = {}
    let out = { custom }

    let metaParts = metadata.split(";")
    if (metaParts.length <= 0) return undefined

    let nameParts = getNameParts(nameSuffix, metaParts[0])
    if (nameParts) {
        out.metaname = nameParts.metaname
        out.name = nameParts.nameWithSuffix
        out.recipient = nameParts.metaname ? nameParts.metaname + "@" + nameParts.nameWithSuffix : nameParts.nameWithSuffix
    }

    for (let i = 0; i < metaParts.length; i++) {
        let metaPart = metaParts[i]
        let kv = metaPart.split("=", 2)

        if (i === 0 && nameParts) continue

        if (kv.length === 1) {
            custom[i.toString()] = kv[0]
        } else {
            custom[kv[0]] = kv.slice(1).join("=")
        }
    }

    let rawReturn = out.return = custom.return
    if (rawReturn) {
        let returnParts = getNameParts(nameSuffix, rawReturn)
        if (returnParts) {
            out.returnMetaname = returnParts.metaname
            out.returnName = returnParts.nameWithSuffix
            out.returnRecipient = returnParts.metaname ? returnParts.metaname + "@" + returnParts.nameWithSuffix : returnParts.nameWithSuffix
        }
    }
    return out
}

class Metadata {
    constructor(metadata, name_suffix) {
        this.metadata = metadata
        this.name_suffix = name_suffix
    }

    parse() {
        try { return parseCommonMeta(this.name_suffix, this.metadata) || {} }
        catch(err) { return {} }
    }

    toString = () => this.metadata
}

module.exports = Metadata
