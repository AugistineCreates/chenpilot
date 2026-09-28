const { execFileSync } = require("child_process");

function gitLsFiles(args) {
  return execFileSync("git", ["ls-files", ...args], {
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

describe("repository source inventory", () => {
  it("does not track contract target output", () => {
    expect(gitLsFiles(["contracts/target/*"])).toEqual([]);
  });

  it("does not track emitted JavaScript next to TypeScript source", () => {
    const trackedTs = new Set(gitLsFiles(["*.ts"]).map((file) => file.replace(/\.ts$/, ".js")));
    const generatedJs = gitLsFiles(["*.js"]).filter((file) => trackedTs.has(file));

    expect(generatedJs).toEqual([]);
  });
});
