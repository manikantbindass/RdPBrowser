const Jimp = require("jimp");
async function convert() {
  const image = await Jimp.read("app-icon.jpg");
  await image.writeAsync("app-icon-real.png");
  console.log("Converted successfully to PNG");
}
convert().catch(console.error);
