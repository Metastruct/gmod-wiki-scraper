import fs from "fs/promises";
import { mkdirSync } from "fs";
import xml2js from "xml2js";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import axios from "axios";
import axiosRetry, { exponentialDelay } from "axios-retry";

const request = axios.create();
axiosRetry(request, { retries: 100, retryDelay: exponentialDelay });

mkdirSync("dist", { recursive: true });
const outFilePath = "dist/gwiki.json";
const baseUrl = "https://wiki.facepunch.com";

const CONCURRENCY = 4;

function justText(el: cheerio.Cheerio<Element>) {
  return el.clone().children().remove().end().text().trim();
}

type Realm = "Server" | "Client" | "Menu" | "Shared";

enum GWikiType {
  Function,
  Enum,
}

interface GWikiObject {
  name: string;
  link: string;
  realms: Realm[];
  type: GWikiType;
}

// Anchor classes we scrape. All of these resolve to a wiki page whose markup
// is either a <function ...> block (functions, hooks, library fields) or an
// <enum> block — both shapes are consumed downstream (gmod-monaco). Panels
// (<panel>) and structures (<structure>) use different markup that nothing
// consumes yet, so they are intentionally left out.
const SCRAPED_CLASSES = ["f", "enum", "event", "field"] as const;

function addElementToList(
  a: cheerio.Cheerio<Element>,
  funclist: GWikiObject[],
) {
  if (!SCRAPED_CLASSES.some((c) => a.hasClass(c))) {
    return;
  }

  const name = justText(a);
  if (!name) {
    throw new Error("no name");
  }

  const link = a.attr("href");
  if (!link) {
    throw new Error("no link");
  }

  // Only `enum` pages are <enum> blocks; functions, hooks (`event`) and
  // library fields (`field`) are all <function> blocks. The precise kind
  // (hook/classfunc/libraryfield/...) is carried by the page markup itself.
  const type = a.hasClass("enum") ? GWikiType.Enum : GWikiType.Function;

  const realms: Realm[] = [];
  if (a.hasClass("rs")) realms.push("Server");
  if (a.hasClass("rc")) realms.push("Client");
  if (a.hasClass("rm")) realms.push("Menu");

  funclist.push({ name, link, realms, type });
}

async function getFunctions(): Promise<GWikiObject[]> {
  const html = (await request(`${baseUrl}/gmod/`)).data;
  const $ = cheerio.load(html);

  const n = $("#sidebar #contents .sectionheader")
    .filter((_, el) => $(el).text() === "Developer Reference")
    .next();

  assert(n.hasClass("section"));

  const objects: GWikiObject[] = [];

  // Sweep the whole section for the anchor classes we scrape rather than
  // matching category display names — the wiki renames categories (e.g.
  // "Enums" -> "Enumerations") and nests them inconsistently, which used to
  // silently drop entire content types.
  const selector = SCRAPED_CLASSES.map((c) => `a.${c}`).join(", ");
  n.find(selector).each((_, el) => {
    addElementToList($(el), objects);
  });

  assert(objects.length > 0);

  return objects;
}

function assert<T>(condition: T): Exclude<T, undefined | null | false> {
  if (
    condition == null ||
    (typeof condition === "boolean" && condition === false)
  ) {
    throw new Error("assertion failed");
  }
  return condition as Exclude<T, undefined | null | false>;
}

// xml2js.Parser holds internal SAX state and is NOT safe to reuse across
// concurrent parseStringPromise() calls — doing so cross-contaminates results.
// Keep options here and construct a fresh Parser per parse (see parseWikiPage).
const xmlParserOptions: xml2js.ParserOptions = {
  async: true,
  strict: false,
  normalizeTags: true,
  trim: true,
  attrNameProcessors: [(name: string) => name.toLowerCase()],
  attrValueProcessors: [
    (value: string) =>
      value === "yes" ? true : value === "no" ? false : value,
  ],
  valueProcessors: [
    (value: string) =>
      value === "yes" ? true : value === "no" ? false : value,
  ],
  explicitArray: false,
  mergeAttrs: true,
  charkey: "text",
};

async function parseWikiPage(link: string): Promise<any> {
  const url = `${baseUrl}${link}?format=text`;
  const response = await request(url);
  let markup: string = response.data;
  markup = markup.replace(/\r\n/g, "\n");
  // Wiki bodies contain inline <page> cross-reference links, both bare
  // (<page>Target</page>) and labelled (<page text="Label">Target</page>).
  // We have no use for the link, so flatten to the visible text — otherwise
  // xml2js parses them into nested objects that fragment the surrounding
  // description/arg text.
  markup = markup.replace(
    /<page\b([^>]*)>([\s\S]*?)<\/page>/g,
    (_m, attrs, inner) => {
      const label = attrs.match(/\btext\s*=\s*["']([^"']*)["']/);
      return label ? label[1] : inner;
    },
  );
  // <br> / <br/> are layout-only and otherwise leak in as junk `br` nodes.
  markup = markup.replace(/<br\s*\/?>/g, "\n");
  const parser = new xml2js.Parser(xmlParserOptions);
  const parsed = await parser.parseStringPromise(
    "<wrapper>" + markup + "</wrapper>",
  );
  return parsed.wrapper;
}

async function outputDeclarations() {
  const functions = await getFunctions();

  // Guard against silently publishing incomplete data if the sidebar markup
  // changes and a whole content type stops being detected.
  const enumCount = functions.filter((o) => o.type === GWikiType.Enum).length;
  const funcCount = functions.length - enumCount;
  console.log(
    `Discovered ${funcCount} function-like pages (functions/hooks/fields) and ${enumCount} enums`,
  );
  assert(enumCount > 0);
  assert(funcCount > 0);

  const total = functions.length;
  const results: string[] = [];
  let index = 0;

  async function worker() {
    while (index < functions.length) {
      const i = index++;
      const obj = functions[i];

      console.log(`[${i + 1}/${total}] ${obj.name.padEnd(25)} (${obj.link})`);

      try {
        const parsed = await parseWikiPage(obj.link);
        parsed.realms = obj.realms;
        parsed.type = GWikiType[obj.type];
        // Page path (e.g. "/gmod/Entity:SetPos", "/gmod/Enums/ACT"). Consumers
        // link straight to the wiki with it; enum pages in particular are
        // otherwise unidentifiable, since the markup never names the table.
        parsed.link = obj.link;
        results[i] = JSON.stringify(parsed);
      } catch (e) {
        console.error(`${obj.link} errored! ${e}`);
        throw e;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  await fs.writeFile(outFilePath, "[\n" + results.join(",\n") + "\n]");
}

console.log(new Date());
outputDeclarations()
  .then(() => {
    console.log(new Date());
    process.exit();
  })
  .catch((e) => {
    console.log(new Date());
    console.error(e);
    process.exit(1);
  });
