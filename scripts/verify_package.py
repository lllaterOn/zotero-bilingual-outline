"""Read-only validation of the distributable XPI, without installing Zotero."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest_source = json.loads((ROOT / "addon/manifest.json").read_text(encoding="utf-8"))
filename = f"zotero-bilingual-outline-{manifest_source['version']}.xpi"
target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "dist" / filename
allowed = {"bootstrap.js", "manifest.json", "icon.svg", "preferences.xhtml", "preferences.js", "runtime.js", "LICENSE"}

with zipfile.ZipFile(target) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)), "Duplicate archive members"
    assert set(names) == allowed, f"Unexpected/missing resources: {set(names) ^ allowed}"
    assert names == sorted(names), "Archive is not sorted"
    assert archive.testzip() is None, "ZIP CRC failure"
    for member in archive.infolist():
        name = member.filename
        assert not PurePosixPath(name).is_absolute() and ".." not in PurePosixPath(name).parts
        assert "\\" not in name and ":" not in name and not member.is_dir(), "Unsafe archive member"
        assert member.date_time == (2026, 1, 1, 0, 0, 0), "Non-deterministic timestamp"
        assert member.file_size > 0, f"Empty member {name}"
        text = archive.read(name).decode("utf-8")
        assert not re.search(r"(?:[A-Za-z]:[\\/](?:Users|Program Files)[\\/]|/Users/|/home/)", text), f"Local path in {name}"
        assert not re.search(r"\bsk-[A-Za-z0-9_-]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text), f"Possible credential in {name}"
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest == manifest_source, "Manifest differs from source"
    assert manifest["manifest_version"] == 2
    assert manifest["version"] == json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"] and manifest["name"] == "Bilingual Outline"
    app = manifest["applications"]["zotero"]
    assert app["id"] == "bilingual-outline@lllateron"
    assert app["strict_min_version"] == "10.0.1" and app["strict_max_version"] == "10.0.*"
    assert manifest["applications"]["gecko"]["id"] == app["id"]
    assert app.get("update_url"), "Zotero requires applications.zotero.update_url"
    # Zotero XPIDatabase.isUsableAddon requires a secure update URL as well.
    assert app["update_url"].startswith("https://"), "Zotero rejects non-HTTPS updates"
    assert app["update_url"] == "https://raw.githubusercontent.com/lllaterOn/zotero-bilingual-outline/main/updates.json"
    for icon in manifest["icons"].values():
        assert icon in allowed
    runtime = archive.read("runtime.js").decode("utf-8")
    bootstrap = archive.read("bootstrap.js").decode("utf-8")
    assert "BilingualOutlineRuntime" in runtime and "startup" in runtime and "shutdown" in runtime
    assert "runtime.js" in bootstrap and "BilingualOutlineRuntime.startup" in bootstrap
    assert "sourceMappingURL" not in runtime, "Source map must not ship"

digest = hashlib.sha256(target.read_bytes()).hexdigest()
checksum_file = target.parent / "SHA256SUMS"
assert checksum_file.read_text(encoding="utf-8").strip() == f"{digest}  {target.name}", "Checksum mismatch"
print(f"Verified {target.name}: {len(allowed)} allowed files, manifest, paths, CRC, SHA256 {digest}")
