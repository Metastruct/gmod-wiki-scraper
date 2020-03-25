import { Promise, promisify } from "bluebird";
import xml2js from "xml2js";
import request from "request-promise-native";
import cheerio from "cheerio";
import fs from "fs";

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

interface Func {
  // name: string;
  link: string;
  // realms: Array<Realm>;
}

// type Realm = "Server" | "Client" | "Menu" | "Shared";

async function getFunctions(): Promise<Array<Func>> {
  const html = await request(`${baseUrl}/gmod/`);
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

            if (a.hasClass("f")) {
              // is a function
              // TODO handle non-functions

              const name = justText(a);
              if (!name || name === "") {
                throw "no name";
              }

              const link = a.attr("href");

              if (!link) {
                throw "no link";
              }

              // let realms: Realm[] = [];

              // if (a.hasClass("rs")) {
              //   realms.push("Server");
              // }
              // if (a.hasClass("rc")) {
              //   realms.push("Client");
              // }
              // if (a.hasClass("rm")) {
              //   realms.push("Menu");
              // }

              functions.push({
                // name,
                link,
                // realms,
              });
            }
          });
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

async function parseFunctionPage(link: string): Promise<{}> {
  const url = `${baseUrl}${link}~edit`;
  const html = await request(url);
  const $ = cheerio.load(html);

  const code = $("#edit_value").text();

  const parsed = xml2js.parseStringPromise(code);

  return parsed;
}

async function outputDeclarations() {
  const functions = await getFunctions();

  await writeFileAsync(outFilePath, "[\n");

  let x = 0;
  let firstWrite = true;
  await Promise.map(
    functions,
    async ({ link }, _, length) => {
      x += 1;

      console.log(`[${x}/${length}] ${link}`);

      const parsed = await parseFunctionPage(link);

      let line = JSON.stringify(parsed);
      if (firstWrite) {
        firstWrite = false;
        fs.appendFileSync(outFilePath, line);
      } else {
        line = ",\n" + line;
        await appendFileAsync(outFilePath, line);
      }
    },
    { concurrency: 10 }
  );

  await appendFileAsync(outFilePath, "\n]");
}

outputDeclarations().catch((e) => {
  console.error(e);
  process.exit(1);
});
