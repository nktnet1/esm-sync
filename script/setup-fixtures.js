"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const setup_acorn_js_1 = __importDefault(require("./setup-acorn.js"));
const setup_test262_js_1 = __importDefault(require("./setup-test262.js"));
const setup_native_addon_js_1 = __importDefault(require("./setup-native-addon.js"));
const tasks = {
    acorn: setup_acorn_js_1.default,
    test262: setup_test262_js_1.default,
    native: setup_native_addon_js_1.default
};
const requested = process.argv.slice(2);
// A native compiler is required only for test runs, not for builds or publishing.
const fixtures = requested.length ? requested : ["acorn", "test262"];
Promise.all(fixtures.map((fixture) => __awaiter(void 0, void 0, void 0, function* () {
    if (!Object.hasOwn(tasks, fixture)) {
        throw new Error(`Unknown fixture: ${fixture}`);
    }
    return tasks[fixture]();
}))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
