"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const request_promise_native_1 = __importDefault(require("request-promise-native"));
(async () => {
    const html = await request_promise_native_1.default("https://wiki.facepunch.com/gmod/");
    console.log(html);
})();
