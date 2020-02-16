"use strict"
var serviceAccount = require("./inferenceengine-cc273-firebase-adminsdk-2wlqq-270abd13a0.json");

var InferenceEngine = require("./index");
const prompts = require('prompts');

var cleanExit = function() { process.exit(0) };
process.on('SIGINT', cleanExit); // catch ctrl-c
process.on('SIGTERM', cleanExit); // catch kill

try {
    var engine = new InferenceEngine(serviceAccount,"https://inferenceengine-cc273.firebaseio.com");

} catch(e) {
    console.error(e);
    process.exit(1);
}

// engine.ask("/car/speed").then(console.log)W
// engine.tell("/cat/quadped", false).then(console.log);
// engine.assertRule("isCat", async function() {
//     let type = await this.ask("/cat/type");
//     let hasFur = await this.ask("/cat/hasFur");
//     if(type == "mammal" && hasFur) {
//         await this.tell("/cat/isACat", true);
//     } else {
//         await this.tell("/cat/isACat", false);
//     }
// })

// engine.assertRule("isDog", async function() {
//     let type = await this.ask("/cat/type");

//     if(type == "mammal" ) {
//         await this.tell("/cat/isACat", true);
//     }
// })
// engine.tell("/cat/type", "mammal").then(console.log);
// engine.tell("/cat/hasFur", true).then(console.log);
// engine.infer("isCat");


let run = true;

(async () => {
    while(run) {
        const response = await prompts({
            type: "select",
            name: "value",
            message: "Select what to do",
            choices: [
                {title: "Tell fact", value: "addFact"},
                {title: "Ask fact", value: "askFact"},
                {title: "Infer", value: "infer"},
                {title: "quit", value: "quit"}
            ],
            initial: 0
        })

        if(response.value == "addFact") {
            const response = await prompts({
                type: "text",
                name: "fact",
                message: "Please tell me a fact",
                validate: (value) => {
                    let regex = /(\/[a-zA-Z]+)(\/[a-zA-Z]+)+ (.+)/
                    if(!regex.test(value)) {
                        return "Invalid fact: <Fact name> value"
                    }
                    return true;
                }
            })
            let [name, ...value] = response.fact.split(" ");
            value = value.join(" ")
            value = value == "true" ? true : value;
            value = value == "false" ? false : value;

            engine.tell(name, value);
        } else if(response.value == "askFact") {
            const response = await prompts({
                type: "text",
                name: "fact",
                message: "Please ask me a fact",
                validate: (value) => {
                    let regex = /(\/[a-zA-Z]+)(\/[a-zA-Z]+)+/
                    if(!regex.test(value)) {
                        return "Invalid fact: <Fact name>"
                    }
                    return true;
                }
            })
            await engine.ask(response.fact).then(console.log)
        } else if(response.value == "infer") {
            engine.infer();
        } else if(response.value == "quit") {
            run = false;
            process.exit(0)
        }
        
        
    }
})();



