#!/usr/bin/env python3
"""Build the card database the app ships with.

Joins three sources:
  * PokemonTCG/pokemon-tcg-data  -> card list, rarities, subtypes, artists
  * tcgcsv.com                   -> TCGplayer printings and market prices
  * (image files are fetched separately by tools/fetch_images.py)

Writes data/cards.me2pt5.json and data/prices.json.
"""
import collections
import json
import os
import sys
import urllib.request

SET_ID = "me2pt5"
TCG_CATEGORY = 3          # Pokemon
TCG_GROUP = 24541         # ME: Ascended Heroes
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

CARDS_URL = f"https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/{SET_ID}.json"
PRODUCTS_URL = f"https://tcgcsv.com/tcgplayer/{TCG_CATEGORY}/{TCG_GROUP}/products"
PRICES_URL = f"https://tcgcsv.com/tcgplayer/{TCG_CATEGORY}/{TCG_GROUP}/prices"

# Which holo renderer style each rarity uses.  Keys match the CSS in
# assets/holo/cards/*.css (ported from simeydotme/pokemon-cards-css).
FOIL_BY_RARITY = {
    "Common": "none",
    "Uncommon": "none",
    "Rare": "rare-holo",
    "Double Rare": "double-rare",
    "Ultra Rare": "ultra-rare",
    "Illustration Rare": "illustration-rare",
    "Special Illustration Rare": "special-illustration-rare",
    "MEGA_ATTACK_RARE": "mega-attack-rare",
    "Mega Hyper Rare": "mega-hyper-rare",
}

# Display names; the raw data uses a screaming-snake value for one rarity.
RARITY_LABEL = {"MEGA_ATTACK_RARE": "Mega Attack Rare"}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "pokerevolutionpacks/1.0"})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise SystemExit(f"failed to fetch {url}: {last}")


def extended(product):
    return {e["name"]: e.get("value") for e in product.get("extendedData", [])}


def variant_of(name):
    """Ascended Heroes prints up to three reverse-holo patterns per card."""
    if "(Poke Ball)" in name:
        return "pokeball"
    if "(Energy Symbol Pattern)" in name:
        return "energy"
    return "base"


def main():
    print("fetching card list ...")
    cards = get_json(CARDS_URL)
    print(f"  {len(cards)} cards")

    print("fetching TCGplayer products + prices ...")
    products = get_json(PRODUCTS_URL)["results"]
    price_rows = get_json(PRICES_URL)["results"]
    print(f"  {len(products)} products, {len(price_rows)} price rows")

    prices_by_product = collections.defaultdict(dict)
    for row in price_rows:
        prices_by_product[row["productId"]][row["subTypeName"]] = row

    # number -> {variant: product}
    products_by_number = collections.defaultdict(dict)
    for p in products:
        ext = extended(p)
        if "Number" not in ext:
            continue  # sealed product, not a card
        num = str(int(ext["Number"].split("/")[0]))
        products_by_number[num][variant_of(p["name"])] = p

    def money(row):
        if not row:
            return None
        out = {
            "market": row.get("marketPrice"),
            "low": row.get("lowPrice"),
            "mid": row.get("midPrice"),
            "high": row.get("highPrice"),
        }
        return out if out["market"] is not None else out

    out_cards = []
    price_book = {}
    reverse_counts = collections.Counter()

    for c in cards:
        num = c["number"]
        rarity = c.get("rarity") or "Common"
        variants = products_by_number.get(num, {})

        # Work out which printings actually exist for this card.
        printings = {}
        reverse_styles = []
        tcg_url = None
        for vname, prod in variants.items():
            subs = prices_by_product.get(prod["productId"], {})
            if vname == "base":
                tcg_url = prod.get("url")
                if "Normal" in subs:
                    printings["normal"] = money(subs["Normal"])
                if "Holofoil" in subs:
                    printings["holo"] = money(subs["Holofoil"])
                if "Reverse Holofoil" in subs:
                    printings["reverse"] = money(subs["Reverse Holofoil"])
                    reverse_styles.append("standard")
            else:
                if "Reverse Holofoil" in subs:
                    printings[f"reverse_{vname}"] = money(subs["Reverse Holofoil"])
                    reverse_styles.append(vname)

        # Cards with no non-foil printing (every secret rare) are holo by default.
        if "normal" not in printings and "holo" not in printings and printings:
            pass

        reverse_styles.sort()
        if reverse_styles:
            reverse_counts[rarity] += 1

        out_cards.append({
            "n": int(num),
            "id": c["id"],
            "name": c["name"],
            "rarity": rarity,
            "rarityLabel": RARITY_LABEL.get(rarity, rarity),
            "supertype": c.get("supertype"),
            "subtypes": c.get("subtypes") or [],
            "types": c.get("types") or [],
            "hp": c.get("hp"),
            "artist": c.get("artist"),
            "flavorText": c.get("flavorText"),
            "foil": FOIL_BY_RARITY.get(rarity, "none"),
            "reverseStyles": reverse_styles,
            "image": f"cards/{num}.webp",
            "tcgplayerUrl": tcg_url,
        })

        for printing, p in printings.items():
            price_book[f"{num}|{printing}"] = p

    out_cards.sort(key=lambda c: c["n"])

    by_rarity = collections.Counter(c["rarity"] for c in out_cards)
    print("\nrarity breakdown:")
    for k, v in by_rarity.most_common():
        print(f"  {v:4d}  {k}   (reverse-holo printings: {reverse_counts[k]})")

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, f"cards.{SET_ID}.json"), "w") as f:
        json.dump({
            "setId": SET_ID,
            "setName": "Ascended Heroes",
            "printedTotal": 217,
            "total": len(out_cards),
            "cards": out_cards,
        }, f, separators=(",", ":"))

    with open(os.path.join(DATA, "prices.json"), "w") as f:
        json.dump({
            "source": "TCGplayer via tcgcsv.com",
            "updatedAt": None,
            "currency": "USD",
            "prices": price_book,
        }, f, separators=(",", ":"))

    print(f"\nwrote {len(out_cards)} cards and {len(price_book)} price entries")
    missing = [c["n"] for c in out_cards if not any(
        k.startswith(f"{c['n']}|") for k in price_book)]
    if missing:
        print(f"WARNING: {len(missing)} cards have no price data: {missing[:20]}")


if __name__ == "__main__":
    sys.exit(main())
