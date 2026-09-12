import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "addon/manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error("Package and manifest versions differ");
await mkdir(path.join(root, "dist"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  outfile: "addon/runtime.js",
  bundle: true,
  format: "iife",
  globalName: "BilingualOutlineRuntime",
  platform: "browser",
  target: ["firefox140"],
  charset: "utf8",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
});

// Explicit allowlist: never recurse over the workspace or include local data.
const members = ["bootstrap.js", "manifest.json", "icon.svg", "preferences.xhtml", "preferences.js", "runtime.js"];
const output = `zotero-bilingual-outline-${manifest.version}.xpi`;
const python = process.env.PYTHON || "python";
execFileSync(python, ["-c", `
import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
members=json.loads(sys.argv[2])
output=root/'dist'/sys.argv[3]
sources={name:root/'addon'/name for name in members}
sources['LICENSE']=root/'LICENSE'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,source in sorted(sources.items()):
        info=zipfile.ZipInfo(name,(2026,1,1,0,0,0))
        info.create_system=3
        info.external_attr=0o100644<<16
        info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,source.read_bytes(),compresslevel=9)
digest=hashlib.sha256(output.read_bytes()).hexdigest()
(root/'dist'/'SHA256SUMS').write_text(digest+'  '+output.name+'\\n',encoding='utf-8')
print(str(output))
print('SHA256 '+digest)
`, root, JSON.stringify(members), output], { cwd: root, stdio: "inherit" });
