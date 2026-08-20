#!/usr/bin/env python3
"""Port simeydotme/pokemon-cards-css onto this app's rarity vocabulary.

The upstream CSS keys every effect off Sword & Shield era `data-rarity`
strings ("rare holo v", "rare secret", ...).  Ascended Heroes has its own
rarity ladder, so rather than pretend our cards are V/VMAX cards we rewrite
the selectors to a single `data-foil` attribute that the renderer sets.

Doing it as a script (instead of hand-editing 80KB of gradients) keeps the
gradient maths byte-identical to upstream and makes the mapping auditable.

Upstream: https://github.com/simeydotme/pokemon-cards-css (MIT)
"""
import os
import re
import sys

SRC = sys.argv[1]
DST = sys.argv[2]

# Which upstream effect dresses which Ascended Heroes rarity.
#   reverse-holo   -> any card pulled in a reverse-holo slot
#   rare-holo      -> Rare (the guaranteed holo in the last slot)
#   double-rare    -> Double Rare (Pokemon ex)
#   ultra-rare     -> Ultra Rare (full-art Pokemon ex and Trainers)
#   illustration-rare / special-illustration-rare / mega-attack-rare /
#   mega-hyper-rare -> the secret-rare ladder
FILES = {
    'base.css': {
        'rare holo': 'rare-holo',
        'rare holo cosmos': 'cosmos-holo',
        '$reverse holo': 'reverse-holo',
    },
    'reverse-holo.css': {'$reverse holo': 'reverse-holo'},
    'regular-holo.css': {'rare holo': 'rare-holo'},
    'v-regular.css': {'rare holo v': 'double-rare'},
    'v-full-art.css': {'rare ultra': 'ultra-rare', 'rare holo v': 'ultra-rare'},
    'trainer-full-art.css': {'rare ultra': 'ultra-rare'},
    'trainer-gallery-holo.css': {
        'trainer gallery rare holo': 'illustration-rare',
        'rare holo': 'illustration-rare',
    },
    'trainer-gallery-secret-rare.css': {'rare secret': 'special-illustration-rare'},
    'secret-rare.css': {'rare secret': 'mega-hyper-rare'},
    'rainbow-alt.css': {
        'rare rainbow alt': 'mega-attack-rare',
        'rare holo vmax': 'mega-attack-rare',
    },
}

HEADER = """/* ---------------------------------------------------------------------------
 * {name}
 *
 * Ported from simeydotme/pokemon-cards-css (MIT) by tools/port_holo_css.py.
 * The gradients, blend modes and filters are upstream's; only the selectors
 * were rewritten from `data-rarity` to this app's `data-foil` values:
 *   {mapping}
 * ------------------------------------------------------------------------- */

"""


def port(name, mapping):
    text = open(os.path.join(SRC, name), encoding='utf-8').read()

    # 1. Rarity selectors -> data-foil.
    for rarity, foil in mapping.items():
        if rarity.startswith('$'):
            pattern = r'\[data-rarity\$=\s*"%s"\]' % re.escape(rarity[1:])
        else:
            pattern = r'\[data-rarity(?:\*)?=\s*"%s"\]' % re.escape(rarity)
        text = re.sub(pattern, '[data-foil="%s"]' % foil, text)

    # 2. The trainer-gallery flag has no meaning here - the mapping above has
    #    already folded those rules into the right foil.
    text = text.replace('[data-trainer-gallery="true"]', '')

    # 3. Upstream singles out Supporters for the full-art trainer look; in this
    #    set every Ultra Rare Trainer (Item, Tool, Stadium, Supporter) uses it.
    text = text.replace('[data-subtypes*="supporter"]', '[data-supertype="trainer"]')
    text = text.replace('[data-supertype="pokémon"]', '[data-supertype="pokemon"]')

    # 4. Repoint texture URLs at the bundled copies.
    text = re.sub(r'url\(\s*"?/img/([^")]+)"?\s*\)', r'url("../../../../assets/holo/\1")', text)

    # 5. Drop any selector that still references a set/number from the old data.
    text = re.sub(r'^\.card\[data-set=[^\n]*\n', '', text, flags=re.M)

    head = HEADER.format(
        name=name,
        mapping=', '.join(f'{k.lstrip("$")} -> {v}' for k, v in mapping.items()),
    )
    out = os.path.join(DST, name)
    open(out, 'w', encoding='utf-8').write(head + text)

    leftover = re.findall(r'\[data-rarity[^\]]*\]', text)
    return len(text), sorted(set(leftover))


os.makedirs(DST, exist_ok=True)
total = 0
for name, mapping in FILES.items():
    size, leftover = port(name, mapping)
    total += size
    flag = f'  !! unmapped: {leftover}' if leftover else ''
    print(f'  {name:<36} {size:>6}b{flag}')
print(f'ported {len(FILES)} files, {total}b total -> {DST}')
