# Ascended Heroes pull rates: where every number comes from

This is the working-out behind `data/pack-model.me2pt5.json`. The goal was a
simulator whose output is statistically indistinguishable from ripping real
Mega Evolution — Ascended Heroes packs, so every probability had to be sourced
rather than guessed, and the two places where the record is genuinely silent
are called out as assumptions instead of being papered over.

## The set

| | |
|---|---|
| Set | Mega Evolution — Ascended Heroes |
| Code | `me2pt5` |
| Released | 30 January 2026 |
| Size | 295 cards — 217 main set + 78 secret rares |

At 295 cards this is the largest English set ever printed. Composition, counted
directly from the card data:

| Rarity | Count | Reverse holo printing? |
|---|---:|---|
| Common | 84 | yes |
| Uncommon | 69 | yes |
| Rare | 25 | yes |
| Double Rare | 39 | no |
| Ultra Rare | 14 | no |
| Illustration Rare | 33 | no |
| Special Illustration Rare | 22 | no |
| Mega Attack Rare | 7 | no |
| Mega Hyper Rare | 2 | no |

The reverse-holo pool is therefore exactly **178 cards** — every main-set card
except the 39 Double Rares. This was not assumed; it was read off the TCGplayer
product catalogue, where a card only carries a "Reverse Holofoil" price row if
such a printing exists.

### Reverse holo styles

Ascended Heroes prints more than one reverse-holo pattern. Counting the
distinct TCGplayer products per card number:

* 106 cards: standard reverse + **Energy Symbol Pattern**
* 34 cards: **Poké Ball Pattern** + **Energy Symbol Pattern**
* 38 cards: standard reverse only

The simulator picks uniformly among the styles a given card actually has, and
prices the exact style pulled.

## Pack structure

Ascended Heroes uses the Scarlet & Violet era pack configuration, which has
been stable since March 2023:

| Slot | Contents |
|---:|---|
| 1–4 | Common, non-foil |
| 5–7 | Uncommon, non-foil |
| 8 | Reverse holo |
| 9 | Reverse holo — **unless** displaced by an Illustration Rare or Special Illustration Rare |
| 10 | The guaranteed holo: Rare or better |

Plus one Basic Energy and one Pokémon TCG Live code card, neither of which the
simulator models.

The displacement rule in slot 9 is the important one, and it is explicit in
PokéBeach's reporting of the configuration change:

> If you pull either an Illustration Rare or a Special Illustration Rare (both
> of which are Secret Rares), they will take the place of the second reverse
> holo slot.

This is why a single pack can hold both an ex **and** an Illustration Rare —
they come out of different slots.

## The published rates

TCGplayer's Authentication Center opened 2,000+ packs and published the
results; PokéBeach reported them, and EternaCards cited the same study
independently with identical figures.

| Rarity | Published |
|---|---|
| Double Rare | 1 in 5 |
| Illustration Rare | 1 in 9 |
| Ultra Rare | 1 in 21 |
| Mega Attack Rare | 1 in 29 |
| Special Illustration Rare | 1 in 70 |
| Mega Hyper Rare | 1 in 540 |

**God packs were excluded from that study.** The simulator therefore treats
these as rates *conditional on a normal pack*, which is exactly what they are.

## Why the slot model reproduces those rates

The arithmetic is the reason to believe the structure above is right, rather
than a plausible-sounding story. Split the rarities by which slot they come
from and each slot's probabilities sum to just under 1, leaving a sensible
remainder:

**Slot 9** (second reverse holo):

```
Illustration Rare          1/9   = 0.111111
Special Illustration Rare  1/70  = 0.014286
                                 ---------
                                   0.125397
plain reverse holo               = 0.874603
```

**Slot 10** (the holo slot):

```
Double Rare                1/5   = 0.200000
Ultra Rare                 1/21  = 0.047619
Mega Attack Rare           1/29  = 0.034483
Mega Hyper Rare            1/540 = 0.001852
                                 ---------
                                   0.283954
Holo Rare (the remainder)        = 0.716046
```

Both slots land inside 1.0 with a plausible leftover, and no rarity has to be
double-counted or split across slots to make it work. A wrong structure would
show up immediately as a sum over 1 or a nonsensical remainder.

## God packs

Ascended Heroes has god packs — a pack where all ten cards are hits.

* **Contents:** 3 Mega Attack Rares + 7 Special Illustration Rares (PokéBeach).
* **Rate:** roughly 1 in 950–1,000 packs. This figure is a *community estimate*,
  not a measured one — the TCGplayer study excluded god packs, so nobody has
  published a rigorous number. The model uses 1/1000 and labels it
  `"confidence": "estimated"`.

Because god packs sit on top of the normal-pack rates, the *overall* rate of
Mega Attack Rares and Special Illustration Rares across all packs is very
slightly higher than the published figures. That is correct behaviour, and the
test suite asserts it explicitly.

## Assumptions

Two things are not settled by any source. Both are recorded in the model file
with instructions for changing them.

### 1. Which slot Mega Attack Rares come from

No source states it. The model puts them in the holo slot (slot 10) on the
reasoning that a Mega Attack Rare is a full-art Mega Pokémon ex — a member of
the ultra-rare family — whereas slot 9 is documented as being taken by the
*illustration*-style secrets.

**This does not affect any published rate.** The per-pack probability of
pulling a Mega Attack Rare is 1/29 either way. The only difference is the joint
distribution: as modelled, a Mega Attack Rare and a Double Rare cannot appear
in the same pack. To flip it, move the `MEGA_ATTACK_RARE` entry from
`slots[hit].outcomes` to `slots[rh2].upgrades` — no code change required.

### 2. The god pack rate

Community-estimated, as described above. Affects ~0.1% of packs. Edit
`godPack.rate`, or set `godPack.enabled: false` to turn them off.

## Verification

`npm test` opens **1,000,000 packs** and checks the observed rates against the
published ones, with tolerances scaled to each rarity's sampling error. It also
asserts the structural invariants: ten cards a pack, no duplicate card within a
pack, reverse slots only drawing cards that have a reverse printing, the holo
slot never being a reverse, and the full 295-card set being reachable.

Latest run:

```
Double Rare:                1 in 5.0    (published 1 in 5)
Illustration Rare:          1 in 9.0    (published 1 in 9)
Ultra Rare:                 1 in 20.9   (published 1 in 21)
Mega Attack Rare:           1 in 28.8   (published 1 in 29)
Special Illustration Rare:  1 in 69.7   (published 1 in 70)
Mega Hyper Rare:            1 in 535.1  (published 1 in 540)
```

The **Odds** screen in the app runs the same check live against 200,000 packs.

## Sources

* [PokéBeach — "Ascended Heroes" pull rates finally determined](https://www.pokebeach.com/2026/02/ascended-heroes-pull-rates-finally-determined-better-than-usual) — the TCGplayer study
* [EternaCards — Ascended Heroes pull rates revealed after 2,000+ packs opened](https://eternacards.co.uk/blogs/trading-card-game-news/ascended-heroes-pull-rates-revealed-after-2-000-packs-opened) — independent citation of the same data
* [PokéBeach — Scarlet & Violet booster pack configuration revealed](https://www.pokebeach.com/2023/03/scarlet-violet-booster-pack-configuration-finally-revealed-major-exciting-changes) — the slot layout and the reverse-holo displacement rule
* [PokéBeach — "Ascended Heroes" set guide](https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more) — god pack contents, reverse holo styles, set size
* [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) — card list and rarities
* [tcgcsv.com](https://tcgcsv.com/) — daily TCGplayer price and printing mirror

A note on sourcing: several sites rank highly for "Ascended Heroes pull rates"
with numbers that contradict each other and the TCGplayer study (one gives Mega
Attack Rares as 1 in 300, another as 1 in 40). Those were discarded. The rates
used here are the ones that two independent outlets attribute to the same
2,000+ pack study, and that the slot arithmetic above independently corroborates.
