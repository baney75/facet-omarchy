#!/usr/bin/env python3
"""Converts uBlock Origin Lite's declarativeNetRequest rulesets into a WebKit content rule list."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULESETS = ["easylist", "easyprivacy", "ublock-filters"]
OUTPUT = ROOT / "app/target/content-rules.json"
SUBRESOURCES = ["image", "style-sheet", "script", "font", "raw", "svg-document", "media", "ping", "fetch", "websocket"]
TYPES = {
    "image": ["image"], "stylesheet": ["style-sheet"], "script": ["script"], "font": ["font"],
    "media": ["media"], "xmlhttprequest": ["fetch"], "ping": ["ping"], "websocket": ["websocket"],
    "object": ["media"], "other": ["raw"],
}
HOST_PREFIX = r"^[a-z]+://([^/]+\.)?"


def filter_to_regex(pattern):
    """Translates a DNR urlFilter; returns None for anything WebKit's regex subset can't express."""
    out, i = "", 0
    if pattern.startswith("||"):
        out, i = HOST_PREFIX, 2
    elif pattern.startswith("|"):
        out, i = "^", 1
    end = pattern.endswith("|")
    body = pattern[i:-1] if end else pattern[i:]
    for ch in body:
        if ch == "*":
            out += ".*"
        elif ch == "^":
            out += "[^a-z0-9_.%-]"
        elif ch.isascii() and (ch.isalnum() or ch in "_-/:=&%,~@;<>'\"!#"):
            out += ch
        elif ch.isascii():
            out += "\\" + ch
        else:
            return None
    return out + ("$" if end else "")


def resource_types(cond):
    wanted = cond.get("resourceTypes")
    if not wanted:
        excluded = {t for name in cond.get("excludedResourceTypes", []) for t in TYPES.get(name, [])}
        return [t for t in SUBRESOURCES if t not in excluded]
    return sorted({t for name in wanted for t in TYPES.get(name, [])})


def convert(rule):
    action = rule["action"]["type"]
    if action not in ("block", "allow"):
        return []
    cond = rule["condition"]
    if "regexFilter" in cond or "excludedRequestDomains" in cond:
        return []
    if "initiatorDomains" in cond and "excludedInitiatorDomains" in cond:
        return []
    kinds = resource_types(cond)
    if not kinds:
        return []
    trigger = {"resource-type": kinds}
    party = {"thirdParty": "third-party", "firstParty": "first-party"}.get(cond.get("domainType"))
    if party:
        trigger["load-type"] = [party]
    if "initiatorDomains" in cond:
        trigger["if-domain"] = ["*" + d for d in cond["initiatorDomains"]]
    if "excludedInitiatorDomains" in cond:
        trigger["unless-domain"] = ["*" + d for d in cond["excludedInitiatorDomains"]]
    if "requestDomains" in cond:
        filters = [HOST_PREFIX + re.escape(d).replace(r"\-", "-") + "[/:]" for d in cond["requestDomains"]]
    else:
        converted = filter_to_regex(cond.get("urlFilter", "*"))
        filters = [converted] if converted else []
    effect = {"type": "block" if action == "block" else "ignore-previous-rules"}
    return [(action, {"trigger": {"url-filter": f, **trigger}, "action": effect}) for f in filters]


def main():
    rules = []
    for name in RULESETS:
        for rule in json.loads((ROOT / f"vendor/ubol/rulesets/main/{name}.json").read_text()):
            rules += convert(rule)
    # WebKit applies ignore-previous-rules only to rules before it, so exceptions go last.
    ordered = [r for kind, r in rules if kind == "block"] + [r for kind, r in rules if kind == "allow"]
    OUTPUT.write_text(json.dumps(ordered, separators=(",", ":")))
    print(f"{len(ordered)} rules, {OUTPUT.stat().st_size // 1024} KiB", file=sys.stderr)


main()
