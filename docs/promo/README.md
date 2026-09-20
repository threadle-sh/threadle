# promo clip

`threadle-promo.mp4` — 59s guided tour of the live app (1600x900, h264).

## regenerate

```sh
# 1. start a threadle server on port 4599 (the tour's target)
pnpm --filter threadle dev -- --port 4599 --no-open

# 2. record (needs playwright's chromium)
node docs/promo/tour.mjs        # writes rec/<hash>.webm next to the script

# 3. cut to mp4
ffmpeg -y -i docs/promo/rec/*.webm -c:v libx264 -preset slow -crf 20 \
  -pix_fmt yuv420p -movflags +faststart docs/promo/threadle-promo.mp4
```

Scenes, captions and pacing live in `tour.mjs`; the title cards are
`intro.html` / `outro.html`. The tour references real local session data —
graph ids in the script may need updating on another machine.
