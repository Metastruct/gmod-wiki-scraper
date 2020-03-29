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
const outFilePath = "dist/gwiki.json";
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
enum GWikiType {
  Function,
  Enum,
};
interface GWikiObject {
  name: string;
  link: string;
  realms: Array<Realm>;
  type: GWikiType;
}

function addElementToList(el: Cheerio, funclist: GWikiObject[]) : any {
  const a = el.children("a");
  // The rest are structs and shareds. No real use for them rn
  if(!a.hasClass("f") && !a.hasClass("enum")) {
    return;
  }
  const name = justText(a);
  if (!name || name === "") {
    throw "no name";
  }

  const link = a.attr("href");
  const type = a.hasClass("f") ? GWikiType.Function : GWikiType.Enum;

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
    type,
  })
}

async function getFunctions(): Promise<Array<GWikiObject>> {
  const html = (await request(`${baseUrl}/gmod/`)).data;
  const $ = cheerio.load(html);

  const n = $("#sidebar #contents .sectionheader")
    .filter((_, el) => {
      return $(el).text() === "Developer Reference";
    })
    .next();

  assert(n.hasClass("section"));

  const objects: GWikiObject[] = [];

  n.children("details.level1").each((_, el) => {
    // big categories

    const n = $(el);
    const bigCategory = justText(n.children("summary").children("div"));

    n.children("ul")
      .children("li")
      .each((_, el) => {
        // categories
        const n = $(el);
        if(bigCategory === "Globals" || bigCategory === "Enums") {
          addElementToList(n, objects);
        } else {

          const level2 = n.children("details.level2");
  
          level2
            .children("ul")
            .children("li")
            .each((_, el) => {
              addElementToList($(el), objects);
            });
        }
    });
  });

  return objects;
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
async function parseWikiPage(link: string): Promise<any> {
  const url = `${baseUrl}${link}?format=text`;
  let markup = (await request(url)).data;
  markup = markup.replace(/\r\n/g, "\n");
  // Enum pages have weird "Used in <page>ENTITY:IsGay</page>." stuff
  // Since we dont have any use for it just replace with text
  markup = markup.replace(/<page>(.*?)<\/page>/g, "$1");
  const parsed = await xmlParser.parseStringPromise(
    "<wrapper>" + markup + "</wrapper>"
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
    async (obj : GWikiObject, _, length) => {
      x += 1;

      console.log(`[${x}/${length}] ${obj.name.padEnd(25, ' ')} (${obj.link})`);
      const parsed = await parseWikiPage(obj.link).catch((e) => {
        console.error(`${obj.link} errored! ${e}`);
        throw e;
      });

      parsed.realms = obj.realms;
      parsed.type = GWikiType[obj.type];

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
      await parseWikiPage(link).then((f) => {
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
