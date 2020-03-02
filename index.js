"use strict";
var admin = require('firebase-admin');
var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
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
    this._subscribedToPrompts = false;
    this._jobs = [];    
    this._infering = false;
    
}

InferenceEngine.prototype.subscribeToKnowledge = async function() {
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

// left leg hurts, red skin
// ['/body/skin/red','/body/skin/purple']

InferenceEngine.prototype.ask = async function(input, id = "") {

    let parsed = await this.parseFacts(input, id)

    let possibleRules = {};


    for(let pFact in parsed) {
        for(let possibleRule in parsed[pFact]) {

            if(typeof possibleRules[parsed[pFact][possibleRule]] == "undefined") {
                possibleRules[parsed[pFact][possibleRule]] = {
                    factCount: 0,
                    totalFacts: this._rules[parsed[pFact][possibleRule]].length
                };

            } 
            let temp = possibleRules[parsed[pFact][possibleRule]];
            temp.factCount++;
        }
    }

    for(let pRule in possibleRules) {
        let rule = possibleRules[pRule];
        rule.certainty = rule.factCount / rule.totalFacts;
    }



    
    
    return possibleRules;


}


InferenceEngine.prototype.parseFacts = async function(input, id) {
    let unparsedFacts = input.split(",");
    let parsedFacts = [];

    for(let index in unparsedFacts) {
        let unparsedFact = unparsedFacts[index];
        let complexFact = unparsedFact.split(" ");

        //Search all facts if part of input fact is contained in it
        var result = {result: []};
        searchFacts(this._facts, complexFact.pop(), result);

        while(complexFact.length != 0 && result.result.length == 0) {
            searchFacts(this._facts, complexFact.pop(), result);
        }

        

        if(result.result.length == 0) {
            //Check for synonyms 

            let synonyms = checkSynonyms(this._synonyms, unparsedFact);

            if(synonyms.length != 0) {
                searchFacts(this._facts, synonyms.pop(), result);
            } else {
                while(result.result.length == 0) {
                    let msg = await this._prompt(`I don't understand: ${unparsedFacts[index]}`, id);
                    if(msg == 0) {
                        break;
                    }
                    synonyms = checkSynonyms(this._synonyms, msg);
                    searchFacts(this._facts, synonyms.pop(), result);
                }
                if(result.result.length == 0) {
                    continue;
                } 
            }
        }

        result = result.result;

        let badResults = [];
        while(complexFact.length != 0) {
            let complex = complexFact.pop();

            for(let fact in result) {
                if(!result[fact].includes(complex)) {
                    badResults.push(result[fact]);
                }
            }
        }

        let goodFacts = arrayDiff(result, badResults);

        if(goodFacts.length == 0) {
            //no good facts, prompt from upper directory of bad results.
        }


        //End array here has facts that were found
        parsedFacts.push(...goodFacts)
    }

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

function checkSynonyms(synonyms, input) {
    let output = [];
    let breakOut = false;
    let check = input.split(' ');
    while(check.length != 0) {
        let checkVal = check.pop();
        for(let key in synonyms) {
            for(let syn in synonyms[key]) {
                if(checkVal == synonyms[key][syn] || checkVal == key) {
                    output.push(key);
                    breakOut = true;
                    break;
                }
            }
            if(breakOut) {
                breakOut = false;
                break;
            }
        }
    }
    return output;
}

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

function searchFacts(facts, complex, result) {
    let current = "";

    searchFactsRec(facts, complex, current, result);
}

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

InferenceEngine.prototype.tell = async function (name, value) {
    

}

InferenceEngine.prototype.subscribeToPrompts = async function (prompt) {
    if(prompt instanceof AsyncFunction) {
        this.subscribeToPrompts = true;
        this._prompt = prompt;
    }
    
}

InferenceEngine.prototype.assertRule = async function(name, rule) {

    
    
}


 
InferenceEngine.prototype.infer = async function() {
    // this._infering = true;

    // if(this._jobs.length == 0) {
    //     this._infering = false;
    // }

    // let rule = this._jobs.shift();

    // if(this._infering) {
    //     try {
            
    //         let snapshot = null;
    //         try {
    //             snapshot = await this._rules.doc(rule).get();
    //         } catch(e) {
    //             return undefined;
    //         }
            
    //         let ruleFunction = new AsyncFunction("",snapshot.data().body);
    //         ruleFunction.call(this);

    //         this.infer();
    //     } catch(e) {
    //         this._infering = false;
    //     }
    // }

    
}

// function getDocPath(doc) {
//     if(doc.charAt(0) !== "/") {
//         doc = "/" + doc;
//     }
//     if(doc.split("/").length - 1 > 1) {
//         let paths = doc.split("/");
//         paths.shift();
//         paths[0] = "/" + paths[0];
//         return paths;
//     } else {
//         return [doc];
//     }

// }


