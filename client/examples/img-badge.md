# Badge with no JavaScript

The badge route returns an SVG and never increments a counter, so it is safe to
embed anywhere, including a README.

Markdown:

```markdown
![views](https://tallywick-xxxx.deno.dev/v1/badge/example-site/home.svg?label=views)
```

HTML:

```html
<img alt="views" src="https://tallywick-xxxx.deno.dev/v1/badge/example-site/home.svg?label=views&abbrev=1" />
```

Query parameters:

| Name | Default | Notes |
|---|---|---|
| `label` | `views` | Left text |
| `color` | `#4c1` | Right side colour, a name or a hex value |
| `labelColor` | `#555` | Left side colour |
| `style` | `flat` | `flat`, `flat-square`, `plastic`, `for-the-badge` |
| `abbrev` | off | `abbrev=1` renders `1234` as `1.2k` |

Because the badge does not count, pair it with a real page hit if you want the
number to move. A common pattern is a `mountTallywick` call on the page plus the
badge in the README, both pointed at the same counter.
