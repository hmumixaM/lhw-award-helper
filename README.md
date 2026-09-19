# LHW Award Helper

**Compare award stays on LHW with inline point values, Amex MR estimates, and a sortable hotel ranking.**

English · [简体中文](README.zh-CN.md)

[Install the userscript](https://raw.githubusercontent.com/hmumixaM/lhw-award-helper/main/dist/lhw-award-helper.user.js) · [Install the bookmarklet](https://hmumixam.github.io/lhw-award-helper/dist/install.html)

LHW Award Helper adds a comparison layer to [The Leading Hotels of the World](https://www.lhw.com)
search and room-selection pages. It shows how much cash an award stay saves per
point and how many American Express Membership Rewards (MR) points the stay
would require under your configured transfer ratio.

## What it adds

- **Inline CPP badges.** See cents per LHW point beside each hotel's search result or award room rate, together with the estimated MR requirement and value per MR point.
- **A sortable ranking panel.** Compare the available awards by point value or required MR points, then click a row to jump to the matching hotel or room.
- **Background availability loading.** Load missing hotel prices in search results without scrolling through every card.
- **Enabled award-selection controls.** Inspect award options when the site's frontend disables their Select buttons because your points balance is too low.

Enabling a button only changes the browser interface. It does not add points or
bypass the server's booking checks. The helper leaves the **CONTINUE** button's
selection and duplicate-submission protections intact.

![LHW hotel search results with inline award-value badges](docs/property-search.png)

## Install

Choose either the userscript for automatic activation or the bookmarklet for
manual activation without an extension.

### Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open **[lhw-award-helper.user.js](https://raw.githubusercontent.com/hmumixaM/lhw-award-helper/main/dist/lhw-award-helper.user.js)** and confirm installation in Tampermonkey.
3. Open an LHW search or room-selection page. The helper runs automatically.

The userscript includes an update URL so Tampermonkey can check for newer
versions.

### Bookmarklet

1. Open the **[bookmarklet installation page](https://hmumixam.github.io/lhw-award-helper/dist/install.html)**.
2. Drag its bookmarklet button to your bookmarks bar.
3. On an LHW search or room-selection page, click the bookmark to activate the helper.

If your browser blocks dragging `javascript:` links, create a bookmark manually
and paste the complete contents of [dist/bookmarklet.txt](dist/bookmarklet.txt)
into its URL field. Repeated activation rescans the page without adding a second
copy of the helper.

## Read the badges

Each badge has two lines:

- **First line:** the cash value per LHW point.
- **Second line:** the MR points needed for the **entire stay**, followed by the value per MR point.

LHW's prominent points figure can be an **average per night**, so it may differ
from the helper's whole-stay MR total. Multi-night stays include an explicit
night count in the badge. Hover over a badge to see the cash-rate baseline,
award taxes, points, and calculation.

The current helper UI and the existing screenshots use some Chinese labels:
`¢/分` means cents per LHW point, and `2晚` means two nights. This README explains
the controls in English; it does not imply that the helper UI has been translated.

![LHW room-selection page with point-value badges and enabled award Select buttons](docs/select-room.png)

## Compare awards in the ranking panel

The panel starts as a compact button in the lower-right corner, showing the
best CPP currently found. Open it to see the full ranking.

![Expanded award ranking panel](docs/panel.png)

Click a column heading to sort; click it again to reverse the direction:

- **`¢/分` — LHW CPP:** highest first, with fewer required MR points breaking ties.
- **`MR` — total MR required:** lowest first, with higher LHW CPP breaking ties.
- **`¢/MR` — value per MR point:** highest first, with fewer required MR points breaking ties.

Ties use the displayed, rounded values. Two entries both shown as `7.07` are
therefore treated as equal for that column, even if their underlying values
differ slightly. Names provide a final tie-breaker for a stable order. LHW CPP
and MR CPP use the same fixed conversion ratio, although rounding can change
which entries tie in each column.

Click a row to reveal, scroll to, and highlight its hotel or room. The helper
also reveals search cards that LHW has not yet made visible. Panel expansion
and sort preferences are saved in `localStorage`.

<details>
<summary>More screenshots: compact panel and regional search</summary>

![Collapsed panel showing the best available CPP](docs/toggle.png)

![A regional hotel search ranked by award value](docs/panel-search.png)

</details>

## How CPP is calculated

```text
LHW CPP = (cash price for the stay − cash still due on the award)
          ÷ LHW points for the stay × 100

MR required = LHW points × configured MR-to-LHW ratio
MR CPP      = LHW CPP ÷ configured MR-to-LHW ratio
```

The cash due on an award is the taxes or cash component reported by the page.
CPP measures the cash avoided for each point used. For US-dollar cents per
point, select **USD** on LHW: the helper uses the amounts returned by the page
and does not perform currency conversion.

For example, using the default calculation assumption of **4 MR per 1 LHW point**:

```text
Two-night stay
Cash-rate total:         USD 410.68
Cash due on the award:   USD  87.79
LHW points:                  6,614
Estimated MR required:      26,456

LHW CPP = (410.68 − 87.79) ÷ 6,614 × 100 = 4.882 cents
MR CPP  = 4.882 ÷ 4                       = 1.220 cents
```

The ratio is configurable; use the ratio applicable to your transfer when
interpreting the MR estimate.

### Cash-rate baselines

On **`/select-room`**, the helper uses the cheapest cash rate for the **same room
type**. On **`/property-search`**, it uses the hotel's lowest cash and award
prices. Those search prices may belong to different room types, so search-page
CPP is a hotel-level estimate.

The cheapest cash rate is selected regardless of cancellation terms. A prepaid,
nonrefundable rate can therefore be the baseline for a more flexible award.
The badge tooltip identifies the rate used.

### Nightly prices versus whole-stay taxes

The search API mixes units: `AvgMinPricePerNight` and `AvgMinPointsPerNight` are
nightly averages, while `Taxes[].AmountVal` is a whole-stay amount. The helper
multiplies cash and points by the number of nights before subtracting taxes.
Skipping that adjustment understates the value of multi-night awards.

## Background price loading

LHW can provide the hotel list before loading availability for each hotel. The
helper asks the page's own store to load missing availability immediately,
without moving the scroll position. It allows up to **10 requests in flight**
and shows progress in the compact panel, such as `CPP 8.05¢ · 32/50`.

Search changes reset the loading state. Requests whose results have not arrived
after 20 seconds can be retried. Large searches can generate many availability
requests, and failed or unavailable results can leave the comparison incomplete.
Set `prefetch: false` to return to loading prices as you scroll.

## Configuration

Edit `CONFIG` near the top of [src/core.js](src/core.js), then rebuild the
distribution files. For a local-only customization, you can edit the equivalent
block in your installed userscript.

```js
const CONFIG = {
    amexRatio: 4,       // Calculation assumption: 4 MR per 1 LHW point
    good: 5.0,          // Green at or above 5 cents per LHW point
    ok: 3.0,            // Amber at or above 3 cents; gray below
    hideWarning: false, // Hide the site's "Not enough points" message when true
    panel: true,        // Show the floating ranking panel
    prefetch: true,     // Load missing search-result prices in the background
};
```

Color thresholds use **LHW CPP**, not MR CPP. With a configured ratio of 4,
`good: 8.0` and `ok: 6.0` correspond to 2.0 and 1.5 cents per MR point. These are
display thresholds you choose, rather than a recommendation to transfer points.

## Compatibility and troubleshooting

- The helper depends on LHW's Vue 2 page components and store. Changes to the site's markup or data model may require a script update.
- If badges are missing, check that the page has loaded both cash and award availability. There must be usable prices and a nonzero points amount to calculate CPP.
- Availability or booking failures are still controlled by LHW. An enabled Select button does not establish that a reservation can be completed.
- If background loading is undesirable, disable `prefetch`; inline badges and the ranking panel still work for loaded results.

## Development

```bash
npm ci
npm run build
```

[src/core.js](src/core.js) is the shared runtime source.
[scripts/build.mjs](scripts/build.mjs) produces:

- [dist/lhw-award-helper.user.js](dist/lhw-award-helper.user.js) — readable userscript.
- [dist/bookmarklet.txt](dist/bookmarklet.txt) — minified, URI-encoded bookmarklet.
- [dist/install.html](dist/install.html) — bookmarklet installation page.

## License

[MIT](LICENSE)
