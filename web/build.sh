#!/bin/sh
# Builds site/ for hosting: wraps index.html in a full HTML document.
set -e
cd "$(dirname "$0")"
rm -rf site && mkdir -p site/vendor
{ printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n<link rel="icon" href="icon.svg"></head><body>\n'; cat index.html; printf '\n</body></html>\n'; } > site/index.html
cp app.js edibles.js guides.js keys.js sw.js manifest.webmanifest icon.svg android.html site/
cp vendor/* site/vendor/
