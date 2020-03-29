import fs from "fs";
import { Promise, promisify } from "bluebird";
import xml2js from "xml2js";
import cheerio from "cheerio";
import axios from "axios";
import axiosRetry, { exponentialDelay } from "axios-retry";

const request = axios.create();
axiosRetry(request, { retries: 100, retryDelay: exponentialDelay });

const writeFileAsync = promisify(fs.writeFile);
const appendFileAsync = promisify(fs.appendFile);

fs.mkdirSync("dist", { recursive: true });
const outFilePath = "dist/functions.json";
const baseUrl = "https://wiki.facepunch.com";

function justText(el: Cheerio) {
  return el
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();
}

type Realm = "Server" | "Client" | "Menu" | "Shared";
interface Func {
  name: string;
  link: string;
  realms: Array<Realm>;
}


function addFunctionToList(el: Cheerio, funclist: Func[]) : any {
  const a = el.children("a");
  if(!a.hasClass("f")) {
    return;
  }
  const name = justText(a);
  if (!name || name === "") {
    throw "no name";
  }

  const link = a.attr("href");

  if (!link) {
    throw "no link";
  }

  let realms: Realm[] = [];

  if (a.hasClass("rs")) {
    realms.push("Server");
  }
  if (a.hasClass("rc")) {
    realms.push("Client");
  }
  if (a.hasClass("rm")) {
    realms.push("Menu");
  }

  funclist.push({
    name,
    link,
    realms,
  })
}

async function getFunctions(): Promise<Array<Func>> {
  const html = (await request(`${baseUrl}/gmod/`)).data;
  const $ = cheerio.load(html);

  const n = $("#sidebar #contents .sectionheader")
    .filter((_, el) => {
      return $(el).text() === "Developer Reference";
    })
    .next();

  assert(n.hasClass("section"));

  const functions: Func[] = [];

  n.children("details.level1").each((_, el) => {
    // big categories

    const n = $(el);
    const bigCategory = justText(n.children("summary").children("div"));

    n.children("ul")
      .children("li")
      .each((_, el) => {
        // categories

        const n = $(el);
        if(bigCategory === "Globals") {
          addFunctionToList(n, functions);
        } else {

          const level2 = n.children("details.level2");
  
          level2
            .children("ul")
            .children("li")
            .each((_, el) => {
              addFunctionToList($(el), functions);
            });
        }
    });
  });

  return functions;
}

type Diff<T, U> = T extends U ? never : T; // Remove types from T that are assignable to U

export function assert<T>(condition: T): Diff<T, undefined> {
  if (
    condition == null ||
    (typeof condition === "boolean" && condition === false)
  ) {
    throw new Error(`assertion failed`);
  } else {
    return condition as Diff<T, undefined>;
  }
}

const xmlParser = new xml2js.Parser({
  async: true,

  // wiki markup can contain < and & in bodies :(
  strict: false,

  // lowercase tags
  normalizeTags: true,

  // trim text bodies
  trim: true,

  attrNameProcessors: [(name) => name.toLowerCase()],
  attrValueProcessors: [
    (value) => (value === "yes" ? true : value === "no" ? false : value),
  ],

  valueProcessors: [
    (value) => (value === "yes" ? true : value === "no" ? false : value),
  ],

  // don't make array if only 1 item
  explicitArray: false,

  mergeAttrs: true,

  charkey: "text",
});
async function parseFunctionPage(link: string): Promise<any> {
  const url = `${baseUrl}${link}?format=text`;
  const markup = (await request(url)).data;

  const parsed = await xmlParser.parseStringPromise(
    "<wrapper>" + markup.replace(/\r\n/g, "\n") + "</wrapper>"
  );

  return parsed.wrapper;
}

async function outputDeclarations() {
  const functions = await getFunctions();

  await writeFileAsync(outFilePath, "[\n");

  let x = 0;
  let firstWrite = true;
  await Promise.map(
    functions,
    async (func : Func, _, length) => {
      x += 1;

      console.log(`[${x}/${length}] ${func.name.padEnd(25, ' ')} (${func.link})`);

      const parsed = await parseFunctionPage(func.link).catch((e) => {
        console.error(`${func.link} errored! ${e}`);
        throw e;
      });

      parsed.realms = func.realms;

      let line = JSON.stringify(parsed);
      if (firstWrite) {
        firstWrite = false;
        fs.appendFileSync(outFilePath, line);
      } else {
        line = ",\n" + line;
        await appendFileAsync(outFilePath, line);
      }
    },
    { concurrency: 4 }
  );

  await appendFileAsync(outFilePath, "\n]");
}

if (false || !true) {
  function testFunction(f: any) {
    assert(f.function);
  }

  async function test() {
    for (const link of [
      "/gmod/DLabel:SetDisabled",
      "/gmod/DModelPanel:SetEntity",
      "/gmod/DModelPanel:SetFOV",
    ]) {
      await parseFunctionPage(link).then((f) => {
        testFunction(f);
        console.log(
          require("util").inspect(f, false, null, true /* enable colors */)
        );
      });
    }
  }

  // const functions = JSON.parse(fs.readFileSync(outFilePath).toString());
  // functions.forEach(testFunction);
  test().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log(new Date());
  outputDeclarations().catch((e) => {
    console.log(new Date());
    console.error(e);
    process.exit(1);
  });
}
