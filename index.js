"use strict";
var admin = require('firebase-admin');
var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
module.exports = InferenceEngine;

/**
 * Inference Engine Construstor
 * @param {String} serviceAccount 
 * @param {String} dbURL 
 */
function InferenceEngine(serviceAccount, dbURL) {
    if(typeof(serviceAccount) == "undefined") throw new Error("Not a valid firebase service account");
    if(typeof(dbURL) == "undefined") throw new Error("No database url supplied");
    //Try to connect to the firebase database
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: dbURL
        });
    } catch(e) {
        throw new Error("Failed to initialize connection to firebase")
    }
    //Instance variable for the database.
    const _db = admin.firestore();
    //Instance variable for the knowledge base.
    this._kb = _db.doc("knowledgebase_data/knowledgebase");
    //Boolean to check if the callback from prompts has been attached.
    this._subscribedToPrompts = false;
    
}

/**
 * Tell the engine to subscribe to update from the database.
 */
InferenceEngine.prototype.subscribeToKnowledge = async function() {
    //If any other instance of this engine is running and updates the knowledge base,
    //It will update the local varibles on this instance.
    return new Promise((resolve, reject) => {
        this._kbObserver = this._kb.onSnapshot(docSnapshot => {
            this._facts = docSnapshot.data().facts;
            this._rules = docSnapshot.data().rules;
            this._synonyms = docSnapshot.data().synonyms;
            resolve();
        }, err => {
            reject();
            throw new Error(err);
        })
    })
}


/**
 * Ask the inference engine a question
 * @param {String} input A list of comma separated values.
 * @param {String} id The ID of the current conversation, for async operations.
 */
InferenceEngine.prototype.ask = async function(input, id = "") {

    //Parse the comma separeated values into an array.
    let parsed = await this.parseFacts(input, id)
    //An array of rules that are attached to the parsed facts.
    let possibleRules = {};


    for(let pFact in parsed) {
        for(let possibleRule in parsed[pFact]) {

            //Lookup each parsed fact and add every relative rule to possibleRules 
            //If the rule doesnt exist in the possibleRules, create it
            if(typeof possibleRules[parsed[pFact][possibleRule]] == "undefined") {
                if(parsed[pFact][possibleRule] === "") {
                    continue;
                }
                possibleRules[parsed[pFact][possibleRule]] = {
                    factCount: 0,
                    totalFacts: this._rules[parsed[pFact][possibleRule]].length
                };

            } 
            //And augment the current factCount that is attached to the rule to calculate certainty
            let temp = possibleRules[parsed[pFact][possibleRule]];
            temp.factCount++;
        }
    }

    //Calculate the certainty of each rule found
    for(let pRule in possibleRules) {
        let rule = possibleRules[pRule];
        rule.certainty = rule.factCount / rule.totalFacts;
    }


    //If they subscribed to the prompts
    if(this._prompt instanceof Function) {
        setTimeout(() => {
            //Prompt if they found their rule
            this._prompt({type: "select", options: ["yes", "no"], message: "Find your diagnosis?"}, id).then((response) => {
                //If they couldnt find it, ask for what rule it is.
                if(response === "no") {
                    this._prompt({type: "input", message: "What is your diagnosis?"},id).then((response) => {
                        let array = []
                        //Push all the symptoms to the given rule.
                        for(let key in parsed) {
                            array.push(key);
                        }
                        this._rules[response] = array;
                        //Relate the newly created rule to its symptoms
                        this.inferFromRule(response);
                        this.updateDatabase();
                        this._prompt(0, id);
                    })
                } else {
                    //End convo
                    this._prompt(0, id);
                }
            })
        }, 2000)
    }
    return possibleRules;
}

/**
 * Relate the symptoms to the given rule
 * @param {String} rule Name of the rule to relate
 */
InferenceEngine.prototype.inferFromRule = function(rule) {
    let r = this._rules[rule];

    for(let fact in r) {
        let f = r[fact];
        if(f.charAt(0) === "/") {
            f = f.slice(1,f.length);
        }
        f = f.split("/");
        let find = this._facts[f.shift()];
        while(f.length !== 0) {
            find = find[f.shift()];
        }
        find.push(rule);
    }
}

/**
 * Update the local knowledgebase to the online one.
 */
InferenceEngine.prototype.updateDatabase = function() {
    this._kb.update({facts: this._facts, rules: this._rules});
}

/**
 * Parse the comma seperated facts into an array.
 * @param {String} input List of comma seperated facts.
 * @param {String} id The current id of the convo
 */
InferenceEngine.prototype.parseFacts = async function(input, id) {
    //Make array from comma seperated facts
    let unparsedFacts = input.split(",");
    let parsedFacts = [];

    //Loop through all the input facts
    for(let index in unparsedFacts) {
        let unparsedFact = unparsedFacts[index];
        //Fact could be more then one word e.g skin red
        //Split it into individual words
        let complexFact = unparsedFact.split(" ");

        //Search all facts if part of input fact is contained in it
        var result = {result: []};
        searchFacts(this._facts, complexFact.pop(), result);

        //If there is more then one word, search again if there was no results for the first word.
        while(complexFact.length != 0 && result.result.length == 0) {
            searchFacts(this._facts, complexFact.pop(), result);
        }


        result = result.result;

        //Searching can return more than one value,
        //e.g searching for red skin,
        //it will search for "skin" and return cold skin and red skin.
        //But we only want red skin therefore we take out the bad results.
        let badResults = [];
        while(complexFact.length != 0) {
            let complex = complexFact.pop();

            for(let fact in result) {
                if(!result[fact].includes(complex)) {
                    badResults.push(result[fact]);
                }
            }
        }

        //Get the array difference of all the search facts and the bad results
        //Will give you the good Facts
        let goodFacts = arrayDiff(result, badResults);

        if(goodFacts.length == 0) {
            throw new Error("Could not find fact");
        }


        //End array here has facts that were found
        parsedFacts.push(...goodFacts)
    }

    //Attach allt he parsedFacts to an output array to return
    let output = {};
    for(let parsedFact in parsedFacts) {
        let scan = parsedFacts[parsedFact].split("/");
        scan.shift();
        let find = this._facts;
        while(scan.length != 0) {
            find = find[scan.shift()];
        }
        output[parsedFacts[parsedFact]] = find;
    }
    return output;
}


/**
 * Get the subset difference of a1 - a2
 * @param {Array} a1 The main array
 * @param {Array} a2 The array to substract from a1
 */
function arrayDiff (a1, a2) {

    var a = [], diff = [];

    for (var i = 0; i < a1.length; i++) {
        a[a1[i]] = true;
    }

    for (var i = 0; i < a2.length; i++) {
        if (a[a2[i]]) {
            delete a[a2[i]];
        } else {
            a[a2[i]] = true;
        }
    }

    for (var k in a) {
        diff.push(k);
    }

    return diff;
}

/**
 * A recursive function to search a tree for facts
 * @param {Array} facts list of all facts
 * @param {String} complex the search keyword
 * @param {Array} result the output
 */
function searchFacts(facts, complex, result) {
    let current = "";

    searchFactsRec(facts, complex, current, result);
}

/**
 * The recursive function that is called from search facts
 * @param {*} facts list of all facts passed from searchFacts
 * @param {*} complex the search keyword passed from searchFacts
 * @param {*} current the current level in the tree
 * @param {*} result the output passed from searchFacts
 */
function searchFactsRec(facts, complex, current, result) {
    for(let n in facts) {
        if(n == complex) {
            if(typeof facts[n] === "object" && !Array.isArray(facts[n])) {
                for(let v in facts[n]) {
                    if(facts[n][v] instanceof Array) {
                        result.result.push(current + "/" + n + "/" + v);
                    }
                }
            } else {
                result.result.push(current + "/" + n);
            }
        }
        if(typeof facts[n] === "object" && !Array.isArray(facts[n])) {
            searchFactsRec(facts[n], complex, current + "/" + n, result);
        }
    }
}

/**
 * Listen for when the engine needs additional information and will call
 * the prompt function passed in
 * @param {Function} prompt The callback function to call for prompts
 *                          This function requires a message object and optional id.
 */
InferenceEngine.prototype.subscribeToPrompts = async function (prompt) {
    if(prompt instanceof AsyncFunction) {
        this.subscribeToPrompts = true;
        this._prompt = prompt;
    }
    
}




 



