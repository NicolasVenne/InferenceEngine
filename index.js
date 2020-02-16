"use strict";
var admin = require('firebase-admin');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

module.exports = InferenceEngine;

function InferenceEngine(serviceAccount, dbURL) {
    if(typeof(serviceAccount) == "undefined") throw new Error("Not a valid firebase service account");
    if(typeof(dbURL) == "undefined") throw new Error("No database url supplied");
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: dbURL
        });
    } catch(e) {
        throw new Error("Failed to initialize connection to firebase")
    }
    const _db = admin.firestore();
    this._kb = _db.doc("knowledgebase_data/knowledgebase");
    this._facts = this._kb.collection("facts");
    this._rules = this._kb.collection("rules");
    this._jobs = [];    
    this._infering = false;
    
}

InferenceEngine.prototype.ask = async function(name) {
    let doc = getDocPath(name);
    let snapshot = null
    try {
        snapshot = await this._facts.doc(doc.shift()).get();
    } catch(e) {
        return undefined;
    }

    let find = snapshot.data();

    while(doc.length != 0) {
        find = find[doc.shift()];
    }
    if(typeof(find) === "object") {
        throw Error("Searched field does not contain single value. Please refine search.");
    }
    return find;

}
InferenceEngine.prototype.tell = async function (name, value) {
    let docPath = getDocPath(name);

    let docRef = this._facts.doc(docPath.shift())

    
 
    let result = {}
    let index = result;
    while(docPath.length != 1) {
        let val = docPath.shift()
        index[val] = {};
        index = index[val];
    }
    
    index[docPath.shift()] = value;

    
    await docRef.set(result, {merge: true});

    this._calculateWork(name);

}

InferenceEngine.prototype.assertRule = async function(name, rule) {

    let ruleContent = rule.toString(); 
    let body = ruleContent.slice(ruleContent.indexOf("{") + 1, ruleContent.lastIndexOf("}"));

    let regex = /this\.ask\(["']?(.*?)["']?\)/gm
    let relatedFact = regex.exec(body);
    let result = {};

    while(relatedFact) {
        
        result[relatedFact[1]] = {};
        result[relatedFact[1]][name] = true
        relatedFact = regex.exec(body)
    }

    this._kb.set({relations: result}, {merge: true})

    let docRef = this._rules.doc(name);
    docRef.set({body});
    
}

InferenceEngine.prototype._calculateWork = async function(fact) {
    let kbRef = await this._kb.get();
    let relations = kbRef.data().relations;
    
    if(relations[fact] !== undefined) {
        let rules = relations[fact];

        for(let rule in rules) {
            this._jobs.push(rule);
        }
    }
}
 
InferenceEngine.prototype.infer = async function() {
    this._infering = true;

    if(this._jobs.length == 0) {
        this._infering = false;
    }

    let rule = this._jobs.shift();

    if(this._infering) {
        try {
            
            let snapshot = null;
            try {
                snapshot = await this._rules.doc(rule).get();
            } catch(e) {
                return undefined;
            }
            
            let ruleFunction = new AsyncFunction("",snapshot.data().body);
            ruleFunction.call(this);

            this.infer();
        } catch(e) {
            this._infering = false;
        }
    }

    
}

function getDocPath(doc) {
    if(doc.charAt(0) !== "/") {
        doc = "/" + doc;
    }
    if(doc.split("/").length - 1 > 1) {
        let paths = doc.split("/");
        paths.shift();
        paths[0] = "/" + paths[0];
        return paths;
    } else {
        return [doc];
    }

}


