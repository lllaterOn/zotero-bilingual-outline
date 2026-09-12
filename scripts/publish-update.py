"""Validate downloaded release assets against tagged source, then record update."""
import hashlib, json, pathlib, re, subprocess, sys, zipfile
tag, assets_arg, source_arg = sys.argv[1:]
assert re.fullmatch(r"v\d+\.\d+\.\d+", tag), "Invalid release tag"
assets, source = pathlib.Path(assets_arg).resolve(), pathlib.Path(source_arg).resolve()
manifest = json.loads((source / "addon/manifest.json").read_text())
version = manifest["version"]
assert tag == "v" + version
xpi = assets / ("zotero-bilingual-outline-" + version + ".xpi")
subprocess.run([sys.executable, str(source / "scripts/verify_package.py"), str(xpi)], check=True)
digest = hashlib.sha256(xpi.read_bytes()).hexdigest()
app = manifest["applications"]["zotero"]
path = pathlib.Path("updates.json")
data = json.loads(path.read_text())
entries = data["addons"][app["id"]]["updates"]
entry = {"version": version,
 "update_link": "https://github.com/lllaterOn/zotero-bilingual-outline/releases/download/" + tag + "/" + xpi.name,
 "update_hash": "sha256:" + digest,
 "applications": {"zotero": {k: app[k] for k in ("strict_min_version", "strict_max_version")}}}
existing = next((e for e in entries if e["version"] == version), None)
assert existing is None or existing == entry, "Published version metadata cannot be replaced"
if existing is None:
 entries.append(entry)
entries.sort(key=lambda e: tuple(map(int, e["version"].split("."))), reverse=True)
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("Verified release and recorded", tag)
