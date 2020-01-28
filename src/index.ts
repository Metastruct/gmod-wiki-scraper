import request from "request-promise-native";

(async () => {
  const html = await request("https://wiki.facepunch.com/gmod/");
  console.log(html);
})();
