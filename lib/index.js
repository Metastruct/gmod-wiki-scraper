"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const request_promise_native_1 = __importDefault(require("request-promise-native"));
const cheerio_1 = __importDefault(require("cheerio"));
const baseUrl = "https://wiki.facepunch.com";
function justText(el) {
    return el
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim();
}
async function getFunctions() {
    const html = await request_promise_native_1.default(`${baseUrl}/gmod/`);
    const $ = cheerio_1.default.load(html);
    const n = $("#sidebar #contents .sectionheader")
        .filter((_, el) => {
        return $(el).text() === "Developer Reference";
    })
        .next();
    assert(n.hasClass("section"));
    const functions = [];
    n.children("details.level1").each((_, el) => {
        // big categories
        const n = $(el);
        // const bigCategory = justText(n.children("summary").children("div"));
        n.children("ul")
            .children("li")
            .each((_, el) => {
            // categories
            const n = $(el);
            const level2 = n.children("details.level2");
            // const category = justText(level2.children("summary").children("div"));
            level2
                .children("ul")
                .children("li")
                .each((_, el) => {
                // functions
                const n = $(el);
                const a = n.children("a");
                // is a function?
                assert(a.hasClass("f"));
                const name = justText(a);
                if (!name || name === "") {
                    throw "no name";
                }
                const link = a.attr("href");
                if (!link) {
                    throw "no link";
                }
                let realms = [];
                if (a.hasClass("rs")) {
                    realms.push("Server");
                }
                if (a.hasClass("rc")) {
                    realms.push("Client");
                }
                if (a.hasClass("rm")) {
                    realms.push("Menu");
                }
                functions.push({
                    name,
                    link,
                    realms,
                });
            });
        });
    });
    return functions;
}
function assert(condition) {
    if (condition == null ||
        (typeof condition === "string" && condition === "") ||
        (typeof condition === "boolean" && condition === false)) {
        throw new Error(`assertion failed`);
    }
    else {
        return condition;
    }
}
exports.assert = assert;
function parseRealm(realm) {
    if (realm === "Server" ||
        realm === "Client" ||
        realm === "Menu" ||
        realm === "Shared"
    // realm === "Client and Menu" ||
    // realm === "Shared and Menu"
    ) {
        return realm;
    }
    else {
        throw new Error(`${realm} not a Realm`);
    }
}
// <function name="Add" parent="Angle" type="classfunc">
// 	<description>Adds the values of the argument angle to the orignal angle. This functions the same as angle1 + angle2 without creating a new angle object, skipping object construction and garbage collection.</description>
// 	<realm>Shared</realm>
// 	<args>
// 		<arg name="angle" type="Angle">The angle to add.</arg>
// 	</args>
// </function>
function parseXml(xml) {
    const func = xml("function");
    const name = assert(func.attr("name"));
    const parent = assert(func.attr("parent"));
    const type = assert(func.attr("type"));
    const description = assert(func.children("description").text());
    const realm = parseRealm(assert(func.children("realm").text()));
    const args = [];
    return {
        name,
        parent,
        type,
        description,
        realm,
        args,
    };
}
async function outputDeclarations() {
    const functions = await getFunctions();
    for (const func of functions) {
        const { name, link } = func;
        const url = `${baseUrl}${link}~edit`;
        console.log(name, url);
        const html = await request_promise_native_1.default(url);
        const $ = cheerio_1.default.load(html);
        const code = $("#edit").text();
        const $xml = cheerio_1.default.load(code);
        const parsed = parseXml($xml);
        console.log(parsed);
    }
}
outputDeclarations();
